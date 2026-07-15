import { useState } from "react";
import { useSession } from "./useSession";
import { GraphView } from "./GraphView";
import { Sidebar } from "./Sidebar";
import { EventFeed } from "./EventFeed";

export default function App() {
  const { graph, events, prompts, connected, sendPrompt } = useSession();
  const [selected, setSelected] = useState<string>();

  return (
    <div className="app">
      <header>
        <h1>
          codemap
          <span className={`conn ${connected ? "on" : "off"}`}>
            {connected ? "live" : "connecting"}
          </span>
        </h1>
        {graph && (
          <span className="muted">
            {graph.root.split("/").pop()} · {graph.stats.files} files ·{" "}
            {graph.communities.length} modules · indexed{" "}
            {new Date(graph.indexedAt).toLocaleTimeString([], { hour12: false })}
          </span>
        )}
      </header>
      {!graph ? (
        <div className="empty">
          <p>Waiting for a graph. Point codemap at a repo:</p>
          <pre>codemap up /path/to/repo</pre>
        </div>
      ) : graph.stats.files === 0 ? (
        <div className="empty">
          <p>
            No indexable files found in <strong>{graph.root}</strong>.
          </p>
          <p>
            codemap maps source code, markdown, and config files; this
            directory has none it recognizes.
          </p>
        </div>
      ) : (
        <main>
          <Sidebar
            graph={graph}
            selected={selected}
            prompts={prompts}
            onSelect={setSelected}
            onSendPrompt={sendPrompt}
          />
          <GraphView
            graph={graph}
            events={events.filter((e) => e.repo === graph.root)}
            selected={selected}
            onSelect={setSelected}
          />
          <EventFeed
            events={events.filter((e) => e.repo === graph.root)}
            onSelect={setSelected}
          />
        </main>
      )}
    </div>
  );
}
