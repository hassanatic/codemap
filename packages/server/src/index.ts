#!/usr/bin/env node
// codemap live server. One instance serves one repo.
//
// It does three jobs:
// 1. Yjs sync host: browsers connect over WebSocket and share the session doc
//    (graph snapshot, agent events, node prompts). Same engine as syncboard.
// 2. Hook inbox: Claude Code hooks POST tool events to /events, and the
//    UserPromptSubmit hook GETs /prompts/pending to pick up node directives.
// 3. Map keeper: a file watcher re-indexes the repo on change so the graph
//    never lies about the code.

import http from "node:http";
import { relative, resolve, isAbsolute } from "node:path";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import chokidar from "chokidar";
import { setupWSConnection, getYDoc } from "y-websocket/bin/utils";
import { indexRepo, loadGraph, saveGraph } from "@codemap/indexer";
import {
  AgentEvent,
  NodePrompt,
  classifyTool,
  CodeGraph,
} from "@codemap/shared";

const PORT = Number(process.env.PORT || 4400);
const ROOM = "codemap";
const repoArg = process.argv[2] || process.env.CODEMAP_REPO;
if (!repoArg) {
  console.error("usage: codemap-server <repo-path>   (an indexed repo)");
  process.exit(1);
}
const repoRoot = resolve(repoArg);

let graph: CodeGraph | undefined = loadGraph(repoRoot);
if (!graph) {
  console.log(`no graph found in ${repoRoot}, indexing now ...`);
  graph = indexRepo(repoRoot);
  saveGraph(repoRoot, graph);
}

const doc: Y.Doc = getYDoc(ROOM);
const yGraph = doc.getMap<unknown>("graph");
const yEvents = doc.getArray<AgentEvent>("events");
const yPrompts = doc.getMap<NodePrompt>("prompts");

function publishGraph(g: CodeGraph) {
  graph = g;
  yGraph.set("data", JSON.parse(JSON.stringify(g)));
}
publishGraph(graph);

function pushEvent(event: AgentEvent) {
  doc.transact(() => {
    yEvents.push([event]);
    if (yEvents.length > 500) yEvents.delete(0, yEvents.length - 500);
  });
}

function toRepoRelative(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const abs = isAbsolute(p) ? p : resolve(repoRoot, p);
  const rel = relative(repoRoot, abs);
  return rel.startsWith("..") ? undefined : rel;
}

let eventCounter = 0;

/** Map a Claude Code hook payload to an AgentEvent. */
function eventFromHook(body: any): AgentEvent | undefined {
  const tool: string = body.tool_name ?? "unknown";
  const input = body.tool_input ?? {};
  const kind = classifyTool(tool);
  const file = toRepoRelative(input.file_path ?? input.notebook_path);
  let detail: string;
  if (file) detail = `${tool} ${file}`;
  else if (tool === "Bash") detail = `$ ${String(input.command ?? "").slice(0, 120)}`;
  else if (input.pattern) detail = `${tool} "${input.pattern}"`;
  else detail = tool;
  return {
    id: `e${Date.now()}-${eventCounter++}`,
    ts: Date.now(),
    kind,
    tool,
    file,
    detail,
    sessionId: body.session_id,
  };
}

/** Pending node prompts, marked delivered, each bundled with node context. */
function drainPrompts(): Array<NodePrompt & { context: string }> {
  const pending: NodePrompt[] = [];
  yPrompts.forEach((p) => {
    if (p.status === "pending") pending.push(p);
  });
  const out = pending
    .sort((a, b) => a.ts - b.ts)
    .map((p) => {
      yPrompts.set(p.id, { ...p, status: "delivered" as const });
      const node = graph?.nodes.find((n) => n.id === p.nodeId);
      const importers =
        graph?.edges.filter((e) => e.target === p.nodeId).map((e) => e.source) ?? [];
      const imports =
        graph?.edges.filter((e) => e.source === p.nodeId).map((e) => e.target) ?? [];
      const context = [
        `File: ${p.nodeId}`,
        node?.summary ? `Summary: ${node.summary}` : undefined,
        node?.exports.length ? `Exports: ${node.exports.join(", ")}` : undefined,
        imports.length ? `Imports: ${imports.join(", ")}` : undefined,
        importers.length ? `Imported by: ${importers.join(", ")}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");
      return { ...p, context };
    });
  return out;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => res(data));
    req.on("error", rej);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "POST" && url.pathname === "/events") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const event = eventFromHook(body);
      if (event) pushEvent(event);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("{}");
    }
    if (req.method === "GET" && url.pathname === "/prompts/pending") {
      const prompts = drainPrompts();
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ prompts }));
    }
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({ ok: true, repo: repoRoot, files: graph?.stats.files ?? 0 })
      );
    }
    res.writeHead(404).end("not found");
  } catch (err) {
    res.writeHead(400).end(String(err));
  }
});

const wss = new WebSocketServer({ server });
wss.on("connection", (conn, req) => setupWSConnection(conn, req, { gc: true }));

// Watch the repo and keep the map honest. Debounced, incremental.
let reindexTimer: NodeJS.Timeout | undefined;
const watcher = chokidar.watch(repoRoot, {
  ignored: [/node_modules/, /\.git/, /dist/, /\.codemap/, /\.next/, /build/],
  ignoreInitial: true,
  persistent: true,
});
watcher.on("all", (_evt, path) => {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) return;
  clearTimeout(reindexTimer);
  reindexTimer = setTimeout(() => {
    try {
      const started = Date.now();
      const next = indexRepo(repoRoot, { previous: graph });
      saveGraph(repoRoot, next);
      publishGraph(next);
      console.log(
        `re-indexed after change (${((Date.now() - started) / 1000).toFixed(1)}s, ${next.stats.files} files)`
      );
    } catch (err) {
      console.error("re-index failed:", err);
    }
  }, 800);
});

server.listen(PORT, () => {
  console.log(`codemap server for ${repoRoot}`);
  console.log(`  ws:     ws://localhost:${PORT} (room "${ROOM}")`);
  console.log(`  events: POST http://localhost:${PORT}/events`);
  console.log(`  health: http://localhost:${PORT}/health`);
});
