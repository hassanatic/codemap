#!/usr/bin/env node
// One command to point codemap at a repo: indexes it if needed, then runs
// the live server and the web UI together. Ctrl+C stops both.
//
//   npm run up -- /path/to/repo [--summaries]

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const codemapRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const withSummaries = process.argv.includes("--summaries");
const repoArg = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (!repoArg) {
  console.error("usage: npm run up -- /path/to/repo [--summaries]");
  process.exit(1);
}
const repo = resolve(repoArg);
if (!existsSync(repo)) {
  console.error(`no such directory: ${repo}`);
  process.exit(1);
}

const graphPath = join(repo, ".codemap", "graph.json");
if (!existsSync(graphPath) || withSummaries) {
  const args = [join(codemapRoot, "packages/indexer/dist/cli.js"), "index", repo];
  if (withSummaries) args.push("--summaries");
  const result = spawnSync("node", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const children = [];
function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  const tag = (line) => `[${name}] ${line}`;
  const forward = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) out(tag(line));
    });
  };
  forward(child.stdout, console.log);
  forward(child.stderr, console.error);
  child.on("exit", (code) => {
    console.log(tag(`exited (${code ?? "signal"})`));
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("server", "node", [join(codemapRoot, "packages/server/dist/index.js"), repo]);
run("web", "npm", ["run", "dev", "-w", "@codemap/web"], { cwd: codemapRoot });

console.log(`codemap up for ${repo}`);
console.log("  ui: http://localhost:4401");
