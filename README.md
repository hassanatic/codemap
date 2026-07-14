# codemap

A living knowledge graph of your codebase, shared by you and your coding agent.

Agents read it as **memory** over MCP: one tool call returns the architecture of a repo instead of a fresh exploration every session. You watch it as **telemetry**: a live map where nodes light up as the agent reads and edits files. Both of you use it as a **prompting surface**: click a file's node, type a directive, and the agent receives it bundled with everything the graph knows about that file.

![codemap watching a real agent session](docs/screenshot.png)

The screenshot above is codemap watching a live Claude Code session work on a 170 file repo: the selected node's summary and dependents on the left, the agent's activity streaming on the right, touched nodes flashing on the map.

## Why

Working with coding agents today has three problems that are really one problem: neither of you can see the shape of the codebase.

1. **Agents re-explore constantly.** Every new session greps and reads its way to the same understanding the last session had, then forgets it.
2. **Agent output is a wall of text.** You cannot glance at it and know what part of your system the agent is touching.
3. **Steering is imprecise.** Telling an agent where to work means describing locations in prose.

codemap builds one artifact, a code graph with import edges, detected modules, and LLM summaries, and gives it three faces: MCP tools for the agent, a live map for you, and node-anchored directives connecting the two.

## How it works

```
indexer  ──►  .codemap/graph.json  ──►  mcp server  ──►  any MCP agent
                     │
                     ▼
              live server (Yjs) ◄── PostToolUse hook (agent telemetry in)
                     │          ──► UserPromptSubmit hook (directives out)
                     ▼
                  web ui
```

- **indexer**: parses JS/TS with ts-morph, builds file nodes and import edges, finds modules with Louvain community detection, flags the most connected files as god nodes, and generates summaries through the `claude` CLI so it reuses your existing login. Re-indexing is incremental by content hash, and the live server re-indexes automatically on file change so the map never lies.
- **mcp server**: `get_overview`, `node_context`, `search_nodes`, and `impact_of` (transitive dependents of a file, the thing grep cannot tell you). Works with any MCP client.
- **live server**: a Yjs sync host, the same CRDT engine as [syncboard](https://github.com/hassanatic/syncboard). The graph, the agent event stream, and pending directives are one shared document, so every open browser sees the same live state.
- **web ui**: sigma.js force graph colored by module, node inspector with summaries and dependency lists, live activity feed, and a prompt composer on every node.

## Numbers from a real repo

Measured on a 170 file TypeScript monorepo with Claude Code running `claude-haiku-4-5` headless:

- `get_overview` returns the full architecture briefing, all 75 modules with summaries plus the most connected files, in one tool call of about 4,300 tokens.
- The same orientation without codemap took the agent 17 tool-use turns of grepping and file reading.
- Asked which files depend on the central enum hub, the codemap-assisted run answered from `impact_of` with the exact transitive dependent list. The unassisted run had to rediscover it by reading files, and that knowledge evaporates when the session ends.

An honest note: on small repos, raw token cost is similar either way, because exploration is cheap when there is little to explore. The win is orientation speed, dependency precision, and the fact that the graph persists across sessions while an agent's exploration does not. The gap grows with repo size.

## Quick start

```bash
npm install && npm run build

# 1. index your repo (summaries need the claude CLI)
node packages/indexer/dist/cli.js index /path/to/repo --summaries

# 2. live server
node packages/server/dist/index.js /path/to/repo

# 3. ui
npm run dev -w @codemap/web    # http://localhost:4401

# 4. agent memory for any Claude Code session
claude mcp add codemap -- node $(pwd)/packages/mcp/dist/index.js
```

To stream a session's activity onto the map and deliver node directives, add the two hooks from [docs/setup.md](docs/setup.md).

## Scope and roadmap

v1 is deliberately narrow: JS/TS repos, file-level nodes, localhost. Next, roughly in order:

- function-level nodes and call edges
- hosted agent sessions through the Claude Agent SDK for instant mid-run steering instead of next-prompt delivery
- more languages via tree-sitter
- paste a GitHub URL to explore any repo

## License

MIT
