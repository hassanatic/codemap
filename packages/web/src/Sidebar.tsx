import { useState } from "react";
import type { CodeGraph, NodePrompt } from "@codemap/shared";
import { communityColor } from "./GraphView";

interface Props {
  graph: CodeGraph;
  selected: string | undefined;
  prompts: NodePrompt[];
  onSelect: (nodeId: string) => void;
  onSendPrompt: (nodeId: string, text: string) => void;
}

export function Sidebar({ graph, selected, prompts, onSelect, onSendPrompt }: Props) {
  const [draft, setDraft] = useState("");
  const node = graph.nodes.find((n) => n.id === selected);

  if (!node) {
    return (
      <div className="sidebar">
        <div className="panel">
          <h2>Repository</h2>
          <p className="muted">{graph.root}</p>
          <p>
            {graph.stats.files} files, {graph.stats.edges} imports,{" "}
            {graph.stats.totalLoc.toLocaleString()} lines
          </p>
          <h2>Modules</h2>
          {graph.communities.map((c) => (
            <div key={c.id} className="module-row">
              <span className="dot" style={{ background: communityColor(c.id) }} />
              <div>
                <strong>{c.label}</strong>
                <span className="muted"> {c.members.length} files</span>
                {c.summary && <p className="summary">{c.summary}</p>}
              </div>
            </div>
          ))}
          <p className="muted hint">Click a node to inspect it and prompt the agent there.</p>
        </div>
      </div>
    );
  }

  const imports = graph.edges.filter((e) => e.source === node.id).map((e) => e.target);
  const importers = graph.edges.filter((e) => e.target === node.id).map((e) => e.source);
  const community = graph.communities.find((c) => c.id === node.community);
  const nodePrompts = prompts.filter((p) => p.nodeId === node.id);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSendPrompt(node.id, text);
    setDraft("");
  };

  return (
    <div className="sidebar">
      <div className="panel">
        <h2>
          <span className="dot" style={{ background: communityColor(node.community) }} />
          {node.id}
        </h2>
        <p className="muted">
          {community?.label} · {node.loc} lines · {node.degree} connections
          {node.godNode ? " · god node" : ""}
        </p>
        {node.summary && <p className="summary">{node.summary}</p>}
        {node.exports.length > 0 && (
          <p className="muted">exports: {node.exports.join(", ")}</p>
        )}

        <div className="prompt-box">
          <h3>Prompt the agent here</h3>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            placeholder={`Directive for ${node.label}, e.g. "parameterize these queries"`}
            rows={3}
          />
          <button onClick={send} disabled={!draft.trim()}>
            Queue for agent
          </button>
          {nodePrompts.map((p) => (
            <div key={p.id} className={`prompt-item ${p.status}`}>
              <span className="status">{p.status}</span> {p.text}
            </div>
          ))}
        </div>

        {importers.length > 0 && (
          <>
            <h3>Imported by ({importers.length})</h3>
            <ul className="file-list">
              {importers.map((f) => (
                <li key={f} onClick={() => onSelect(f)}>{f}</li>
              ))}
            </ul>
          </>
        )}
        {imports.length > 0 && (
          <>
            <h3>Imports ({imports.length})</h3>
            <ul className="file-list">
              {imports.map((f) => (
                <li key={f} onClick={() => onSelect(f)}>{f}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
