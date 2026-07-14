# codemap development plan

## What this is

A living knowledge graph of your codebase with three uses built on one artifact:

1. **Memory**: coding agents connect over MCP and get the architecture of a repo in a couple thousand tokens instead of burning tens of thousands exploring it from scratch every session.
2. **Telemetry**: humans watch the same graph in the browser while an agent works. Nodes light up as the agent reads and edits files, so you can see what it is doing instead of scrolling a wall of text.
3. **Steering**: you click a node and type a directive right there. The prompt reaches the agent bundled with the context of that node (its files, neighbors, summary), so pointing at the map replaces describing locations in words.

## Why these three belong together

They are the same data structure. The graph the agent reads for memory is the graph you watch for telemetry and the graph you prompt through. Keeping it fresh (incremental re-indexing on file change) is the core engineering work; everything else is a view on top of it.

## Architecture

Monorepo with npm workspaces:

- `packages/shared`: types and the graph store format. No heavy dependencies.
- `packages/indexer`: scans a repo, parses JS/TS with ts-morph, builds file nodes and import edges with graphology, detects communities with Louvain, ranks god nodes by centrality, optionally generates LLM summaries by shelling out to the `claude` CLI (reuses existing login, no API keys). Persists to `.codemap/graph.json` in the target repo with per-file content hashes for incremental re-indexing.
- `packages/mcp`: stdio MCP server exposing `get_overview`, `node_context`, `search_nodes`, `impact_of`. Reads the graph store. Works with any MCP client, not just Claude Code.
- `packages/server`: WebSocket sync server (Yjs). Holds the live session doc: graph state, agent events, pending node prompts. Also an HTTP endpoint that Claude Code hooks POST tool events to, and a file watcher that triggers incremental re-index so the map never lies.
- `packages/web`: React + Vite + sigma.js. Force-directed graph colored by community, node side panel, event timeline, prompt composer on node click.

## Steering mechanics, honestly

MCP is request/response, so a server cannot push a message into a running session. Two delivery routes:

- **Attach mode (v1)**: Claude Code hooks. PostToolUse streams telemetry out; UserPromptSubmit injects queued node directives as additional context at the agent's next step. Delivery is "next opportunity," not instant, which is acceptable.
- **Hosted mode (v2)**: codemap spawns the session itself through the Claude Agent SDK, which allows true mid-run message injection and a structured event stream.

## Phases

- **Phase 0**: repo, GitHub, scaffold, shared types.
- **Phase 1**: indexer core. Parse, graph, communities, god nodes, incremental hashing. Verified against a real repo.
- **Phase 2**: LLM summaries behind a `--summaries` flag so plain indexing stays fast and free.
- **Phase 3**: MCP server. Verified from a real Claude Code session, with a note of tokens used for an architecture question with and without codemap.
- **Phase 4**: sync server + web UI rendering the real graph, live updates on file change.
- **Phase 5**: telemetry through hooks, nodes lighting up live.
- **Phase 6**: node-anchored prompting end to end.
- **Phase 7**: README, demo GIF, token benchmark numbers.

## Scope guards for v1

- JS/TS only. Other languages later.
- Nodes are files. Function-level nodes are v2.
- GitHub URL import is v3. Local repos first.
- No auth, no multi-tenant. Localhost tool first, product later.

## Conventions

- Plain commit messages describing the change. No co-author trailers.
- Human english in all docs. No em dashes.
