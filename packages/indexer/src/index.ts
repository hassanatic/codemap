import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, dirname, basename, extname } from "node:path";
import fg from "fast-glob";
import { Project } from "ts-morph";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import {
  CodeGraph,
  Community,
  FileNode,
  ImportEdge,
  GRAPH_DIR,
  GRAPH_FILE,
} from "@codemap/shared";

const SOURCE_GLOBS = ["**/*.{ts,tsx,js,jsx,mjs,cjs}"];
const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/.git/**",
  "**/*.d.ts",
  "**/*.min.js",
];

export interface IndexOptions {
  /** carry summaries over from a previous graph when file hashes match */
  previous?: CodeGraph;
}

export function loadGraph(repoRoot: string): CodeGraph | undefined {
  const p = join(repoRoot, GRAPH_DIR, GRAPH_FILE);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CodeGraph;
  } catch {
    return undefined;
  }
}

export function saveGraph(repoRoot: string, graph: CodeGraph): string {
  const dir = join(repoRoot, GRAPH_DIR);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, GRAPH_FILE);
  writeFileSync(p, JSON.stringify(graph, null, 2));
  return p;
}

function sha1(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

/** Label a community by the deepest directory shared by most of its members. */
function communityLabel(members: string[]): string {
  const counts = new Map<string, number>();
  for (const m of members) {
    const dir = dirname(m);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
    // credit parent dirs too, at lower weight, so "src/auth" beats "src"
    const parts = dir.split("/");
    for (let i = parts.length - 1; i > 0; i--) {
      const parent = parts.slice(0, i).join("/");
      counts.set(parent, (counts.get(parent) ?? 0) + 0.4);
    }
  }
  let best = ".";
  let bestScore = -1;
  for (const [dir, score] of counts) {
    const depthBonus = dir === "." ? 0 : dir.split("/").length * 0.6;
    if (score + depthBonus > bestScore) {
      bestScore = score + depthBonus;
      best = dir;
    }
  }
  return best === "." ? "root" : best;
}

export function indexRepo(repoRoot: string, opts: IndexOptions = {}): CodeGraph {
  const files = fg.sync(SOURCE_GLOBS, {
    cwd: repoRoot,
    ignore: IGNORE,
    absolute: true,
    followSymbolicLinks: false,
  });

  const project = new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      skipLibCheck: true,
      resolveJsonModule: true,
    },
  });
  project.addSourceFilesAtPaths(files);

  const graph = new Graph({ type: "directed", multi: false, allowSelfLoops: false });
  const nodesByPath = new Map<string, FileNode>();
  const prevByPath = new Map<string, FileNode>();
  for (const n of opts.previous?.nodes ?? []) prevByPath.set(n.id, n);

  for (const sf of project.getSourceFiles()) {
    const abs = sf.getFilePath();
    const rel = relative(repoRoot, abs);
    if (rel.startsWith("..")) continue;
    const content = sf.getFullText();
    const hash = sha1(content);
    const prev = prevByPath.get(rel);
    let exports: string[] = [];
    try {
      exports = sf.getExportSymbols().map((s) => s.getName()).slice(0, 30);
    } catch {
      // export resolution can throw on odd files, not worth failing the index
    }
    const node: FileNode = {
      id: rel,
      label: basename(rel),
      lang: extname(rel).slice(1),
      loc: content.split("\n").length,
      hash,
      community: 0,
      degree: 0,
      godNode: false,
      exports,
      summary: prev && prev.hash === hash ? prev.summary : undefined,
    };
    nodesByPath.set(rel, node);
    graph.addNode(rel);
  }

  const edges: ImportEdge[] = [];
  for (const sf of project.getSourceFiles()) {
    const fromRel = relative(repoRoot, sf.getFilePath());
    if (!nodesByPath.has(fromRel)) continue;
    const targets = new Set<string>();
    for (const imp of sf.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (target) targets.add(relative(repoRoot, target.getFilePath()));
    }
    for (const exp of sf.getExportDeclarations()) {
      const target = exp.getModuleSpecifierSourceFile();
      if (target) targets.add(relative(repoRoot, target.getFilePath()));
    }
    for (const toRel of targets) {
      if (toRel === fromRel || !nodesByPath.has(toRel)) continue;
      if (!graph.hasEdge(fromRel, toRel)) {
        graph.addEdge(fromRel, toRel);
        edges.push({ source: fromRel, target: toRel });
      }
    }
  }

  // communities: louvain needs an undirected view and at least one edge
  if (graph.order > 0 && graph.size > 0) {
    const undirected = new Graph({ type: "undirected", multi: false });
    graph.forEachNode((n) => undirected.addNode(n));
    graph.forEachEdge((_e, _a, s, t) => {
      if (!undirected.hasEdge(s, t)) undirected.addEdge(s, t);
    });
    const assignments = louvain(undirected);
    for (const [node, comm] of Object.entries(assignments)) {
      nodesByPath.get(node)!.community = comm as number;
    }
  }

  // degree and god nodes
  const degrees: Array<[string, number]> = [];
  graph.forEachNode((n) => {
    const d = graph.degree(n);
    nodesByPath.get(n)!.degree = d;
    degrees.push([n, d]);
  });
  degrees.sort((a, b) => b[1] - a[1]);
  const godCount = Math.min(15, Math.max(3, Math.floor(degrees.length * 0.05)));
  for (const [n, d] of degrees.slice(0, godCount)) {
    if (d >= 3) nodesByPath.get(n)!.godNode = true;
  }

  // communities list with labels, carrying over summaries when membership is stable
  const byCommunity = new Map<number, string[]>();
  for (const node of nodesByPath.values()) {
    const list = byCommunity.get(node.community) ?? [];
    list.push(node.id);
    byCommunity.set(node.community, list);
  }
  const prevCommunities = opts.previous?.communities ?? [];
  const communities: Community[] = [...byCommunity.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id, members]) => {
      members.sort();
      const prev = prevCommunities.find(
        (c) =>
          c.members.length === members.length &&
          c.members.every((m, i) => m === members[i])
      );
      return {
        id,
        label: communityLabel(members),
        members,
        summary: prev?.summary,
      };
    });

  const nodes = [...nodesByPath.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    version: 1,
    root: repoRoot,
    indexedAt: new Date().toISOString(),
    nodes,
    edges,
    communities,
    stats: {
      files: nodes.length,
      edges: edges.length,
      totalLoc: nodes.reduce((sum, n) => sum + n.loc, 0),
    },
  };
}
