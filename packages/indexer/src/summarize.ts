import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CodeGraph } from "@codemap/shared";

const exec = promisify(execFile);
const MODEL = "claude-haiku-4-5";
const CONCURRENCY = 4;

// Summaries go through the claude CLI on purpose: it reuses the user's
// existing login, so codemap never handles API keys.

async function claudeAvailable(): Promise<boolean> {
  try {
    await exec("claude", ["--version"], { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

async function ask(prompt: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec(
      "claude",
      ["-p", prompt, "--model", MODEL],
      { timeout: 120000, maxBuffer: 1024 * 1024 }
    );
    const text = stdout.trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

async function pool<T>(items: T[], worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

function excerpt(repoRoot: string, file: string, maxChars: number): string {
  try {
    return readFileSync(join(repoRoot, file), "utf8").slice(0, maxChars);
  } catch {
    return "";
  }
}

export async function summarizeGraph(repoRoot: string, graph: CodeGraph): Promise<void> {
  if (!(await claudeAvailable())) {
    console.log("claude CLI not found, skipping summaries");
    return;
  }

  const godNodes = graph.nodes.filter((n) => n.godNode && !n.summary);
  const communities = graph.communities.filter((c) => !c.summary && c.members.length >= 2);
  const total = godNodes.length + communities.length;
  if (total === 0) {
    console.log("summaries are up to date");
    return;
  }
  console.log(`generating ${godNodes.length} file and ${communities.length} community summaries ...`);

  let done = 0;
  const tick = () => {
    done += 1;
    if (done % 5 === 0 || done === total) console.log(`  ${done}/${total}`);
  };

  await pool(godNodes, async (node) => {
    const content = excerpt(repoRoot, node.id, 6000);
    const answer = await ask(
      `Summarize this source file for a coding agent that has never seen the repo. ` +
        `One paragraph, at most 60 words. State what it does and what depends on it conceptually. ` +
        `No preamble.\n\nFile: ${node.id}\nExports: ${node.exports.join(", ") || "none"}\n\n${content}`
    );
    if (answer) node.summary = answer;
    tick();
  });

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  await pool(communities, async (community) => {
    const fileList = community.members
      .map((m) => {
        const n = nodeById.get(m);
        return `${m}${n && n.exports.length ? ` (exports: ${n.exports.slice(0, 8).join(", ")})` : ""}`;
      })
      .join("\n");
    const keyFile = community.members
      .map((m) => nodeById.get(m)!)
      .sort((a, b) => b.degree - a.degree)[0];
    const answer = await ask(
      `These files form one module of a codebase. Reply with exactly two lines:\n` +
        `LABEL: a 2 to 4 word name for this module\n` +
        `SUMMARY: one paragraph, at most 80 words, on what this module does and how its files relate\n\n` +
        `Files:\n${fileList}\n\nExcerpt of the most connected file (${keyFile.id}):\n` +
        excerpt(repoRoot, keyFile.id, 3000)
    );
    if (answer) {
      const labelMatch = answer.match(/LABEL:\s*(.+)/i);
      const summaryMatch = answer.match(/SUMMARY:\s*([\s\S]+)/i);
      if (labelMatch) community.label = labelMatch[1].trim();
      community.summary = (summaryMatch ? summaryMatch[1] : answer).trim();
    }
    tick();
  });
}
