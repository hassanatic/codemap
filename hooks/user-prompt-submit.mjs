#!/usr/bin/env node
// Claude Code UserPromptSubmit hook. Picks up directives the user attached
// to graph nodes in the codemap UI and injects them as additional context,
// each bundled with what the graph knows about that file. Never blocks the
// agent: any failure exits 0 silently.

const PORT = process.env.CODEMAP_PORT ?? "4400";

try {
  const res = await fetch(`http://localhost:${PORT}/prompts/pending`, {
    signal: AbortSignal.timeout(2000),
  });
  const { prompts } = await res.json();
  if (Array.isArray(prompts) && prompts.length > 0) {
    const blocks = prompts.map(
      (p) =>
        `### Directive on ${p.nodeId}\n${p.text}\n\nWhat the code graph knows about this file:\n${p.context}`
    );
    const additionalContext =
      `The user attached ${prompts.length === 1 ? "a directive" : "directives"} to specific files ` +
      `on the codemap graph. Address ${prompts.length === 1 ? "it" : "them"} as part of this turn:\n\n` +
      blocks.join("\n\n");
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext,
        },
      })
    );
  }
} catch {
  // codemap server not running, that is fine
}
process.exit(0);
