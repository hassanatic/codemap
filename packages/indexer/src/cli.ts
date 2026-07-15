#!/usr/bin/env node
import { resolve } from "node:path";
import { indexRepo, loadGraph, saveGraph } from "./index.js";

const [, , command, ...rest] = process.argv;

function usage(): never {
  console.log(`codemap - living knowledge graph for your codebase

usage:
  codemap index <path> [--summaries]   index a repo into <path>/.codemap/graph.json
`);
  process.exit(1);
}

async function main() {
  if (command !== "index") usage();
  const pathArg = rest.find((a) => !a.startsWith("--"));
  if (!pathArg) usage();
  const repoRoot = resolve(pathArg);
  const withSummaries = rest.includes("--summaries");

  const previous = loadGraph(repoRoot);
  console.log(`indexing ${repoRoot}${previous ? " (incremental)" : ""} ...`);
  const started = Date.now();
  const graph = indexRepo(repoRoot, { previous });

  if (withSummaries) {
    const { summarizeGraph } = await import("./summarize.js");
    await summarizeGraph(repoRoot, graph);
  }

  const out = saveGraph(repoRoot, graph);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (graph.stats.files === 0) {
    console.log(
      `warning: no indexable files found in ${repoRoot}. codemap maps source ` +
        `code, markdown, and config files; this directory has none it recognizes.`
    );
  } else {
    console.log(
      `indexed ${graph.stats.files} files, ${graph.stats.edges} imports, ` +
        `${graph.communities.length} communities in ${secs}s`
    );
  }
  console.log(`graph written to ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
