// Language-aware edge extraction. JS/TS gets the TypeScript compiler for
// precise module resolution (see index.ts); everything here is lightweight
// pattern matching plus filesystem resolution, which is the right tradeoff
// for a map: near-precise edges for the languages we know, best-effort
// edges for the rest, and every file is a node regardless.

import { dirname, join, normalize } from "node:path";

export interface RepoFiles {
  /** every indexed repo-relative path */
  all: Set<string>;
  /** lowercased basename without extension -> repo-relative paths */
  byBasename: Map<string, string[]>;
}

export function buildRepoFiles(paths: string[]): RepoFiles {
  const all = new Set(paths);
  const byBasename = new Map<string, string[]>();
  for (const p of paths) {
    const base = (p.split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase();
    if (!base) continue;
    const list = byBasename.get(base) ?? [];
    list.push(p);
    byBasename.set(base, list);
  }
  return { all, byBasename };
}

function exists(files: RepoFiles, candidate: string): string | undefined {
  const norm = normalize(candidate).replace(/\\/g, "/");
  if (norm.startsWith("..")) return undefined;
  return files.all.has(norm) ? norm : undefined;
}

/** Resolve a token against candidate paths, first match wins. */
function firstHit(files: RepoFiles, candidates: string[]): string | undefined {
  for (const c of candidates) {
    const hit = exists(files, c);
    if (hit) return hit;
  }
  return undefined;
}

/** A basename lookup that only trusts unique matches, to avoid wiring every
 * `import utils` to an arbitrary one of five utils files. */
function uniqueBasename(files: RepoFiles, name: string): string | undefined {
  const list = files.byBasename.get(name.toLowerCase());
  return list && list.length === 1 ? list[0] : undefined;
}

export function pythonEdges(rel: string, content: string, files: RepoFiles): string[] {
  const out = new Set<string>();
  const dir = dirname(rel);
  const roots = ["", "src/"];

  const resolveAbsolute = (mod: string): string | undefined => {
    const path = mod.replace(/\./g, "/");
    const candidates: string[] = [];
    for (const root of roots) {
      candidates.push(`${root}${path}.py`, `${root}${path}/__init__.py`);
    }
    return firstHit(files, candidates) ?? uniqueBasename(files, mod.split(".").pop() ?? "");
  };

  const resolveRelative = (mod: string): string | undefined => {
    const dots = (mod.match(/^\.+/) ?? ["."])[0].length;
    const rest = mod.slice(dots).replace(/\./g, "/");
    let base = dir;
    for (let i = 1; i < dots; i++) base = dirname(base);
    if (!rest) return undefined;
    return firstHit(files, [join(base, `${rest}.py`), join(base, rest, "__init__.py")]);
  };

  for (const m of content.matchAll(/^[ \t]*(?:from[ \t]+([.\w]+)[ \t]+import|import[ \t]+([\w.,\s]+))/gm)) {
    if (m[1]) {
      const hit = m[1].startsWith(".") ? resolveRelative(m[1]) : resolveAbsolute(m[1]);
      if (hit) out.add(hit);
    } else if (m[2]) {
      for (const mod of m[2].split(",")) {
        const clean = mod.trim().split(/[ \t]+as[ \t]+/)[0].trim();
        if (!clean) continue;
        const hit = resolveAbsolute(clean);
        if (hit) out.add(hit);
      }
    }
  }
  return [...out].filter((t) => t !== rel);
}

export function markdownEdges(rel: string, content: string, files: RepoFiles): string[] {
  const out = new Set<string>();
  const dir = dirname(rel);

  // standard links: [text](path), skipping urls and pure anchors
  for (const m of content.matchAll(/\[[^\]]*\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)) {
    const target = decodeURIComponent(m[1]);
    if (/^(?:[a-z]+:)?\/\//i.test(target) || target.startsWith("mailto:")) continue;
    const candidates = [
      join(dir, target),
      join(dir, `${target}.md`),
      join(dir, target, "README.md"),
      target,
      `${target}.md`,
      join(target, "README.md"),
    ];
    const hit = firstHit(files, candidates);
    if (hit) out.add(hit);
  }

  // wiki links: [[name]] or [[name|label]], matched by basename
  for (const m of content.matchAll(/\[\[([^\]|#]+)/g)) {
    const name = m[1].trim().replace(/\s+/g, "-");
    const hit = uniqueBasename(files, name) ?? uniqueBasename(files, m[1].trim());
    if (hit) out.add(hit);
  }
  return [...out].filter((t) => t !== rel);
}

export function dartEdges(rel: string, content: string, files: RepoFiles): string[] {
  const out = new Set<string>();
  const dir = dirname(rel);
  for (const m of content.matchAll(/^[ \t]*(?:import|export|part)[ \t]+['"]([^'"]+)['"]/gm)) {
    const target = m[1];
    if (target.startsWith("dart:")) continue;
    let hit: string | undefined;
    if (target.startsWith("package:")) {
      // package:app/foo/bar.dart -> some .../lib/foo/bar.dart in this repo
      const rest = target.slice(target.indexOf("/") + 1);
      const suffix = `lib/${rest}`;
      const matches = [...files.all].filter((f) => f.endsWith(suffix));
      if (matches.length >= 1) hit = matches.sort((a, b) => a.length - b.length)[0];
    } else {
      hit = firstHit(files, [join(dir, target)]);
    }
    if (hit) out.add(hit);
  }
  return [...out].filter((t) => t !== rel);
}

/** Best-effort for every other language: look at import-like statements,
 * resolve quoted paths, fall back to unique basenames. */
export function genericEdges(rel: string, content: string, files: RepoFiles): string[] {
  const out = new Set<string>();
  const dir = dirname(rel);
  const exts = ["", ".go", ".rs", ".java", ".kt", ".swift", ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cs", ".lua", ".sh", ".sql", ".r", ".scala", ".vue", ".svelte"];

  for (const m of content.matchAll(
    /(?:^|\s)(?:import|include|require|require_relative|use|source|mod|load)\b[ \t(]*['"<]([^'"<>\n)]+)['">]/gm
  )) {
    const target = m[1].trim();
    if (/^(?:[a-z]+:)?\/\//i.test(target)) continue;
    if (target.includes("/") || target.includes(".")) {
      const candidates: string[] = [];
      for (const ext of exts) {
        candidates.push(join(dir, target + ext), target + ext);
      }
      const hit = firstHit(files, candidates);
      if (hit) {
        out.add(hit);
        continue;
      }
    }
    const base = (target.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
    if (base.length >= 3) {
      const hit = uniqueBasename(files, base);
      if (hit) out.add(hit);
    }
  }
  return [...out].filter((t) => t !== rel);
}

export function extractExports(lang: string, content: string): string[] {
  const out: string[] = [];
  if (lang === "py") {
    for (const m of content.matchAll(/^(?:def|class)[ \t]+(\w+)/gm)) out.push(m[1]);
  } else if (lang === "dart") {
    for (const m of content.matchAll(/^(?:abstract[ \t]+)?(?:class|enum|mixin|extension)[ \t]+(\w+)/gm)) out.push(m[1]);
  } else if (lang === "md" || lang === "mdx") {
    for (const m of content.matchAll(/^#{1,2}[ \t]+(.+)$/gm)) out.push(m[1].trim());
  } else if (lang === "go") {
    for (const m of content.matchAll(/^func[ \t]+(?:\([^)]*\)[ \t]*)?([A-Z]\w*)/gm)) out.push(m[1]);
  } else if (lang === "rs") {
    for (const m of content.matchAll(/^pub[ \t]+(?:fn|struct|enum|trait|mod)[ \t]+(\w+)/gm)) out.push(m[1]);
  }
  return out.slice(0, 30);
}
