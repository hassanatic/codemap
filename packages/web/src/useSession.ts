import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { AgentEvent, CodeGraph, NodePrompt } from "@codemap/shared";

const SERVER = import.meta.env.VITE_CODEMAP_SERVER ?? "ws://localhost:4400";
const ROOM = "codemap";

export interface Session {
  graph: CodeGraph | undefined;
  events: AgentEvent[];
  prompts: NodePrompt[];
  connected: boolean;
  sendPrompt: (nodeId: string, text: string) => void;
}

export function useSession(): Session {
  const [graph, setGraph] = useState<CodeGraph>();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [prompts, setPrompts] = useState<NodePrompt[]>([]);
  const [connected, setConnected] = useState(false);
  const docRef = useRef<Y.Doc>();

  useEffect(() => {
    // created inside the effect so StrictMode's double mount gets a fresh
    // provider instead of a destroyed one
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(SERVER, ROOM, doc);
    docRef.current = doc;

    const yGraph = doc.getMap<unknown>("graph");
    const yEvents = doc.getArray<AgentEvent>("events");
    const yPrompts = doc.getMap<NodePrompt>("prompts");

    const readGraph = () => setGraph(yGraph.get("data") as CodeGraph | undefined);
    const readEvents = () => setEvents(yEvents.toArray());
    const readPrompts = () => {
      const list: NodePrompt[] = [];
      yPrompts.forEach((p) => list.push(p));
      setPrompts(list.sort((a, b) => b.ts - a.ts));
    };
    yGraph.observe(readGraph);
    yEvents.observe(readEvents);
    yPrompts.observe(readPrompts);
    const onStatus = ({ status }: { status: string }) =>
      setConnected(status === "connected");
    provider.on("status", onStatus);
    provider.on("sync", () => {
      readGraph();
      readEvents();
      readPrompts();
    });

    return () => {
      provider.destroy();
      doc.destroy();
      docRef.current = undefined;
    };
  }, []);

  const sendPrompt = (nodeId: string, text: string) => {
    const doc = docRef.current;
    if (!doc) return;
    const id = `p${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const prompt: NodePrompt = { id, ts: Date.now(), nodeId, text, status: "pending" };
    doc.getMap<NodePrompt>("prompts").set(id, prompt);
  };

  return { graph, events, prompts, connected, sendPrompt };
}
