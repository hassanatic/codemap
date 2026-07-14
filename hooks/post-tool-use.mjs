#!/usr/bin/env node
// Claude Code PostToolUse hook. Streams every tool call to the codemap
// server so the graph lights up while the agent works. Never blocks the
// agent: any failure exits 0 silently.

const PORT = process.env.CODEMAP_PORT ?? "4400";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

try {
  const payload = JSON.parse(raw);
  await fetch(`http://localhost:${PORT}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(2000),
  });
} catch {
  // codemap server not running, that is fine
}
process.exit(0);
