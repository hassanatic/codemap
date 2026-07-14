# codemap

A living knowledge graph of your codebase. Coding agents read it as memory over MCP. You watch it as live telemetry while the agent works. Both of you use it as a prompting surface: click a node, type a directive, the agent gets it with full context.

Status: under active development. See [PLAN.md](PLAN.md) for the roadmap.

## Why

- Agents burn tens of thousands of tokens re-exploring your repo every session. codemap serves the architecture in one tool call.
- Agent output is a wall of scrolling text. codemap shows you what the agent is actually touching, on a map of your code.
- Telling an agent where to work is imprecise in words. Pointing at a node is not.

## Packages

- `packages/shared`: types and graph store format
- `packages/indexer`: repo scanner, graph builder, community detection, summaries
- `packages/mcp`: MCP server exposing the graph to any agent
- `packages/server`: realtime sync server (Yjs) plus hook event endpoint
- `packages/web`: the live graph UI
