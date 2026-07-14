# Setting up codemap for a repo

Four pieces: index the repo, run the live server, open the UI, connect your agent.

## 1. Index

```bash
npm install && npm run build     # once, in the codemap repo
node packages/indexer/dist/cli.js index /path/to/your/repo --summaries
```

`--summaries` uses the `claude` CLI (your existing login) to write one-paragraph
summaries for each module and each highly connected file. Skip the flag for a
fast structure-only index. Re-running is incremental: unchanged files keep
their summaries.

## 2. Live server

```bash
node packages/server/dist/index.js /path/to/your/repo
```

Serves the Yjs session on `ws://localhost:4400`, accepts hook events on
`POST /events`, and re-indexes automatically when files change.

## 3. UI

```bash
npm run dev -w @codemap/web
```

Open http://localhost:4401. You get the force graph colored by module,
a node panel with summaries and dependencies, and the live activity feed.

## 4. Connect a Claude Code session

Add to `.claude/settings.json` (or `settings.local.json`) in the repo you are
working on, with `CODEMAP` replaced by the absolute path to this repo:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "node CODEMAP/hooks/post-tool-use.mjs" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node CODEMAP/hooks/user-prompt-submit.mjs" }
        ]
      }
    ]
  }
}
```

The PostToolUse hook streams the agent's tool calls to the graph, so you can
watch nodes light up as it reads and edits files. The UserPromptSubmit hook
delivers any directives you attached to nodes in the UI, bundled with that
file's summary, exports, and dependency lists.

## 5. Agent memory over MCP

Register the codemap MCP server so any session starts with the architecture
in one tool call instead of exploring from scratch:

```bash
claude mcp add codemap -- node CODEMAP/packages/mcp/dist/index.js
```

The server finds `.codemap/graph.json` by walking up from the working
directory, or set `CODEMAP_ROOT=/path/to/your/repo` explicitly. Tools:

- `get_overview`: modules, summaries, key files, stats
- `node_context`: one file in depth
- `search_nodes`: locate a concept
- `impact_of`: transitive dependents of a file before you change it
