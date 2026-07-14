import type { AgentEvent } from "@codemap/shared";

const KIND_ICON: Record<string, string> = {
  read: "R",
  edit: "E",
  write: "W",
  bash: "$",
  search: "?",
  other: "·",
};

interface Props {
  events: AgentEvent[];
  onSelect: (file: string) => void;
}

export function EventFeed({ events, onSelect }: Props) {
  const recent = [...events].reverse().slice(0, 80);
  return (
    <div className="event-feed">
      <h3>Agent activity</h3>
      {recent.length === 0 && (
        <p className="muted">
          No events yet. Connect a Claude Code session with the codemap hook and its
          tool calls will stream here.
        </p>
      )}
      {recent.map((e) => (
        <div
          key={e.id}
          className={`event kind-${e.kind} ${e.file ? "clickable" : ""}`}
          onClick={() => e.file && onSelect(e.file)}
        >
          <span className="event-icon">{KIND_ICON[e.kind] ?? "·"}</span>
          <span className="event-detail">{e.detail}</span>
          <span className="event-time">
            {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
          </span>
        </div>
      ))}
    </div>
  );
}
