// Core graph store format. This is the single artifact everything reads:
// the indexer writes it, the MCP server serves it, the web UI renders it.

export interface FileNode {
  /** repo-relative path, also the node id */
  id: string;
  /** basename for display */
  label: string;
  /** language, e.g. "ts" | "tsx" | "js" | "jsx" */
  lang: string;
  /** lines of code */
  loc: number;
  /** sha1 of file content at index time, drives incremental re-index */
  hash: string;
  /** community id assigned by Louvain */
  community: number;
  /** in-degree + out-degree, used for sizing and god node ranking */
  degree: number;
  /** true for the most central nodes in the graph */
  godNode: boolean;
  /** names exported from this file */
  exports: string[];
  /** LLM-generated one-paragraph summary, present when indexed with --summaries */
  summary?: string;
}

export interface ImportEdge {
  /** importing file id */
  source: string;
  /** imported file id */
  target: string;
}

export interface Community {
  id: number;
  /** short human name, LLM-generated or derived from common path prefix */
  label: string;
  /** node ids in this community */
  members: string[];
  /** LLM-generated summary of what this part of the codebase does */
  summary?: string;
}

export interface CodeGraph {
  version: 1;
  /** absolute path of the indexed repo */
  root: string;
  /** ISO timestamp of last index */
  indexedAt: string;
  nodes: FileNode[];
  edges: ImportEdge[];
  communities: Community[];
  stats: {
    files: number;
    edges: number;
    totalLoc: number;
  };
}

// Live session events. Hooks and the hosted agent bridge both emit these,
// the sync server appends them to the session doc, the UI renders them.

export type AgentEventKind =
  | "read"
  | "edit"
  | "write"
  | "bash"
  | "search"
  | "other";

export interface AgentEvent {
  id: string;
  ts: number;
  kind: AgentEventKind;
  /** tool name as reported by the agent harness */
  tool: string;
  /** repo-relative file path when the event concerns a file */
  file?: string;
  /** one-line human description */
  detail: string;
  /** session identifier from the harness */
  sessionId?: string;
  /** absolute repo root this event belongs to; the UI filters on it so
   * events from a previous repo's session never leak into another map */
  repo?: string;
}

// A directive the user attached to a node in the UI. Delivered to the agent
// at its next step, bundled with node context.

export interface NodePrompt {
  id: string;
  ts: number;
  /** node id the user clicked */
  nodeId: string;
  /** what the user typed */
  text: string;
  /** delivered | pending */
  status: "pending" | "delivered";
}

export const GRAPH_DIR = ".codemap";
export const GRAPH_FILE = "graph.json";
export const HASHES_FILE = "hashes.json";

export function classifyTool(tool: string): AgentEventKind {
  const t = tool.toLowerCase();
  if (t === "read" || t === "notebookread") return "read";
  if (t === "edit" || t === "multiedit" || t === "notebookedit") return "edit";
  if (t === "write") return "write";
  if (t === "bash") return "bash";
  if (t === "grep" || t === "glob" || t === "websearch") return "search";
  return "other";
}
