#!/usr/bin/env node
// The codemap CLI. `codemap up` inside any repo does the whole setup:
// index the repo, wire the Claude Code hooks, ignore .codemap/, register
// the MCP server, then serve the live map.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const codemapRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const command = argv[0];
const flags = argv.filter((a) => a.startsWith("--"));
const positional = argv.slice(1).filter((a) => !a.startsWith("--"));

function usage() {
  console.log(`codemap - a living knowledge graph of your codebase

usage:
  codemap up [path] [--summaries]     set up everything for a repo and serve the live map
                                      (path defaults to the current directory)
  codemap index <path> [--summaries]  index only, no server
  codemap help

codemap up is idempotent: run it again any time, it only changes what is missing.`);
}

function indexRepo(repo, withSummaries, force) {
  const graphPath = join(repo, ".codemap", "graph.json");
  if (existsSync(graphPath) && !force && !withSummaries) return;
  const args = [join(codemapRoot, "packages/indexer/dist/cli.js"), "index", repo];
  if (withSummaries) args.push("--summaries");
  const result = spawnSync("node", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Merge our two hooks into the repo's .claude/settings.local.json without
// touching anything else in the file.
function ensureHooks(repo) {
  const settingsPath = join(repo, ".claude", "settings.local.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      console.log(`! could not parse ${settingsPath}, leaving it alone`);
      console.log("  add the hooks manually, see docs/setup.md");
      return;
    }
  }
  const hooks = (settings.hooks ??= {});
  let changed = false;

  const wants = [
    {
      event: "PostToolUse",
      entry: {
        matcher: "*",
        hooks: [
          { type: "command", command: `node ${join(codemapRoot, "hooks/post-tool-use.mjs")}` },
        ],
      },
      marker: "hooks/post-tool-use.mjs",
    },
    {
      event: "UserPromptSubmit",
      entry: {
        hooks: [
          { type: "command", command: `node ${join(codemapRoot, "hooks/user-prompt-submit.mjs")}` },
        ],
      },
      marker: "hooks/user-prompt-submit.mjs",
    },
  ];
  for (const { event, entry, marker } of wants) {
    const list = (hooks[event] ??= []);
    if (!JSON.stringify(list).includes(marker)) {
      list.push(entry);
      changed = true;
    }
  }
  if (changed) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    console.log(`+ hooks wired in ${settingsPath}`);
  } else {
    console.log("= hooks already wired");
  }
}

function ensureGitignore(repo) {
  if (!existsSync(join(repo, ".git"))) return;
  const path = join(repo, ".gitignore");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (/^\.codemap\/?$/m.test(current)) {
    console.log("= .codemap/ already gitignored");
    return;
  }
  appendFileSync(path, (current && !current.endsWith("\n") ? "\n" : "") + ".codemap/\n");
  console.log("+ added .codemap/ to .gitignore");
}

function ensureMcp() {
  const probe = spawnSync("claude", ["--version"], { timeout: 15000 });
  if (probe.status !== 0) {
    console.log("! claude CLI not found, skipping MCP registration");
    return;
  }
  const existing = spawnSync("claude", ["mcp", "get", "codemap"], { timeout: 20000 });
  if (existing.status === 0) {
    console.log("= codemap MCP server already registered");
    return;
  }
  const mcpPath = join(codemapRoot, "packages/mcp/dist/index.js");
  const add = spawnSync(
    "claude",
    ["mcp", "add", "--scope", "user", "codemap", "--", "node", mcpPath],
    { timeout: 30000 }
  );
  console.log(
    add.status === 0
      ? "+ registered codemap MCP server (user scope, all your projects)"
      : "! MCP registration failed, run manually: claude mcp add --scope user codemap -- node " + mcpPath
  );
}

function serve(repo) {
  const children = [];
  let shuttingDown = false;
  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) child.kill("SIGTERM");
    setTimeout(() => process.exit(code), 300);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  const run = (name, cmd, args, opts = {}) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    const forward = (stream, out) => {
      let buf = "";
      stream.on("data", (chunk) => {
        buf += chunk;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) out(`[${name}] ${line}`);
      });
    };
    forward(child.stdout, console.log);
    forward(child.stderr, console.error);
    child.on("exit", (code) => {
      console.log(`[${name}] exited (${code ?? "signal"})`);
      shutdown(code ?? 0);
    });
    children.push(child);
  };

  run("server", "node", [join(codemapRoot, "packages/server/dist/index.js"), repo]);
  run("web", "npm", ["run", "dev", "-w", "@codemap/web"], { cwd: codemapRoot });
  console.log(`codemap up for ${repo}`);
  console.log("  ui: http://localhost:4401");
}

if (command === "index") {
  const repo = positional[0] ? resolve(positional[0]) : undefined;
  if (!repo || !existsSync(repo)) {
    usage();
    process.exit(1);
  }
  indexRepo(repo, flags.includes("--summaries"), true);
} else if (command === "up") {
  const repo = resolve(positional[0] ?? process.cwd());
  if (!existsSync(repo)) {
    console.error(`no such directory: ${repo}`);
    process.exit(1);
  }
  indexRepo(repo, flags.includes("--summaries"), false);
  ensureHooks(repo);
  ensureGitignore(repo);
  ensureMcp();
  serve(repo);
} else {
  usage();
  process.exit(command === "help" || command === undefined ? 0 : 1);
}
