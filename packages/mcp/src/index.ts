#!/usr/bin/env node
// MCP server that serves a repo's codemap graph as agent memory.
// One get_overview call replaces the exploratory grepping an agent
// normally does at the start of every session.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CodeGraph, FileNode } from "@codemap/shared";
import { GRAPH_DIR, GRAPH_FILE } from "@codemap/shared";

function findGraphPath(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, GRAPH_DIR, GRAPH_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function loadGraph(): CodeGraph {
  const start = process.env.CODEMAP_ROOT ?? process.cwd();
  const path = findGraphPath(start);
  if (!path) {
    throw new Error(
      `No codemap graph found from ${start}. Run "codemap index <repo>" first, ` +
        `or set CODEMAP_ROOT to the indexed repo.`
    );
  }
  // Re-read on every call so a watcher re-index is picked up without restart.
  return JSON.parse(readFileSync(path, "utf8")) as CodeGraph;
}

function nodeLine(n: FileNode): string {
  const parts = [`${n.id} (${n.loc} loc, ${n.degree} connections)`];
  if (n.exports.length) parts.push(`exports: ${n.exports.slice(0, 10).join(", ")}`);
  if (n.summary) parts.push(n.summary);
  return parts.join("\n  ");
}

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

const server = new McpServer({ name: "codemap", version: "0.1.0" });

server.tool(
  "get_overview",
  "Get the architecture of this repository in one call: modules, what they do, " +
    "the most important files, and stats. Call this FIRST in a new session instead " +
    "of exploring the repo with grep and file reads.",
  {},
  async () => {
    const g = loadGraph();
    const lines: string[] = [];
    lines.push(
      `Repository: ${g.root}`,
      `Indexed: ${g.indexedAt}`,
      `${g.stats.files} source files, ${g.stats.edges} import relationships, ${g.stats.totalLoc} lines`,
      ``,
      `## Modules (import communities)`
    );
    for (const c of g.communities) {
      lines.push(``, `### ${c.label} (${c.members.length} files)`);
      if (c.summary) lines.push(c.summary);
      const key = c.members
        .map((m) => g.nodes.find((n) => n.id === m)!)
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 6)
        .map((n) => n.id);
      lines.push(`Key files: ${key.join(", ")}`);
    }
    const gods = g.nodes.filter((n) => n.godNode);
    if (gods.length) {
      lines.push(``, `## Most connected files (change these carefully)`);
      for (const n of gods) lines.push(``, `- ${nodeLine(n)}`);
    }
    lines.push(
      ``,
      `Use node_context for details on one file, impact_of before changing a file, search_nodes to locate a concept.`
    );
    return text(lines.join("\n"));
  }
);

server.tool(
  "node_context",
  "Everything the graph knows about one file: summary, exports, what it imports, " +
    "what imports it, and which module it belongs to. Use before working on a file.",
  { path: z.string().describe("repo-relative file path") },
  async ({ path }) => {
    const g = loadGraph();
    const node = g.nodes.find((n) => n.id === path);
    if (!node) {
      const close = g.nodes.filter((n) => n.id.includes(path)).slice(0, 5);
      return text(
        `No node "${path}". ${close.length ? "Did you mean: " + close.map((n) => n.id).join(", ") : "Try search_nodes."}`
      );
    }
    const imports = g.edges.filter((e) => e.source === path).map((e) => e.target);
    const importers = g.edges.filter((e) => e.target === path).map((e) => e.source);
    const community = g.communities.find((c) => c.id === node.community);
    const lines = [
      nodeLine(node),
      ``,
      `Module: ${community?.label ?? "unknown"}`,
      `Imports (${imports.length}): ${imports.join(", ") || "nothing internal"}`,
      `Imported by (${importers.length}): ${importers.join(", ") || "nothing, this is a leaf or entry point"}`,
    ];
    if (node.godNode)
      lines.push(``, `Warning: this is one of the most connected files in the repo. Check impact_of before editing.`);
    return text(lines.join("\n"));
  }
);

server.tool(
  "search_nodes",
  "Find files by name, export, or summary content. Cheaper than grep for locating " +
    "where a concept lives.",
  { query: z.string().describe("word or phrase to look for") },
  async ({ query }) => {
    const g = loadGraph();
    const q = query.toLowerCase();
    const scored = g.nodes
      .map((n) => {
        let score = 0;
        if (n.id.toLowerCase().includes(q)) score += 3;
        if (n.exports.some((e) => e.toLowerCase().includes(q))) score += 2;
        if (n.summary?.toLowerCase().includes(q)) score += 1;
        return { n, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.n.degree - a.n.degree)
      .slice(0, 10);
    if (!scored.length) return text(`Nothing in the graph matches "${query}".`);
    return text(scored.map((r) => `- ${nodeLine(r.n)}`).join("\n"));
  }
);

server.tool(
  "impact_of",
  "What could break if this file changes: every file that depends on it, directly " +
    "or transitively. Use before edits to central files.",
  {
    path: z.string().describe("repo-relative file path"),
    depth: z.number().int().min(1).max(10).default(4).describe("how many import hops to follow"),
  },
  async ({ path, depth }) => {
    const g = loadGraph();
    if (!g.nodes.some((n) => n.id === path)) return text(`No node "${path}". Try search_nodes.`);
    const importersOf = new Map<string, string[]>();
    for (const e of g.edges) {
      const list = importersOf.get(e.target) ?? [];
      list.push(e.source);
      importersOf.set(e.target, list);
    }
    const seen = new Map<string, number>();
    let frontier = [path];
    for (let d = 1; d <= depth && frontier.length; d++) {
      const next: string[] = [];
      for (const f of frontier) {
        for (const importer of importersOf.get(f) ?? []) {
          if (importer === path || seen.has(importer)) continue;
          seen.set(importer, d);
          next.push(importer);
        }
      }
      frontier = next;
    }
    if (!seen.size) return text(`Nothing imports ${path}. Changes stay local.`);
    const byDepth = [...seen.entries()].sort((a, b) => a[1] - b[1]);
    return text(
      `${seen.size} files depend on ${path}:\n` +
        byDepth.map(([f, d]) => `- ${f} (${d} hop${d > 1 ? "s" : ""} away)`).join("\n")
    );
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
