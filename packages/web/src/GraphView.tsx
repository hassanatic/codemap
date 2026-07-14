import { useEffect, useRef } from "react";
import Graph from "graphology";
import { circular } from "graphology-layout";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import type { AgentEvent, CodeGraph } from "@codemap/shared";

export const PALETTE = [
  "#58a6ff", "#3fb950", "#d29922", "#f778ba", "#a371f7",
  "#ff7b72", "#39c5cf", "#e3b341", "#7ee787", "#ffa657",
];

export function communityColor(community: number): string {
  return PALETTE[community % PALETTE.length];
}

const HOT_MS = 4000;
const HOT_COLOR = "#ffffff";

interface Props {
  graph: CodeGraph;
  events: AgentEvent[];
  selected: string | undefined;
  onSelect: (nodeId: string | undefined) => void;
}

export function GraphView({ graph, events, selected, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma>();
  // node id -> timestamp of last agent touch, drives the pulse effect
  const hotRef = useRef(new Map<string, number>());
  const selectedRef = useRef<string | undefined>(selected);

  // build / rebuild the rendered graph when the data changes
  useEffect(() => {
    if (!containerRef.current) return;
    const g = new Graph();
    for (const node of graph.nodes) {
      g.addNode(node.id, {
        label: node.label,
        size: Math.min(18, 4 + Math.sqrt(node.degree) * 2 + (node.godNode ? 3 : 0)),
        color: communityColor(node.community),
        community: node.community,
      });
    }
    for (const edge of graph.edges) {
      if (g.hasNode(edge.source) && g.hasNode(edge.target) && !g.hasEdge(edge.source, edge.target)) {
        g.addEdge(edge.source, edge.target, { size: 0.6 });
      }
    }
    circular.assign(g);
    if (g.order > 2) {
      forceAtlas2.assign(g, {
        iterations: 300,
        settings: { ...forceAtlas2.inferSettings(g), gravity: 0.6 },
      });
    }

    const renderer = new Sigma(g, containerRef.current, {
      labelColor: { color: "#8b949e" },
      labelSize: 11,
      defaultEdgeColor: "#21262d",
      renderEdgeLabels: false,
      nodeReducer: (node, data) => {
        const res = { ...data };
        const hotAt = hotRef.current.get(node);
        const isHot = hotAt !== undefined && Date.now() - hotAt < HOT_MS;
        if (isHot) {
          res.color = HOT_COLOR;
          res.size = (data.size as number) + 3;
          res.zIndex = 2;
        }
        if (selectedRef.current === node) {
          res.highlighted = true;
          res.size = (data.size as number) + 2;
        }
        return res;
      },
      edgeReducer: (_edge, data) => ({ ...data, color: "#21262d" }),
    });
    renderer.on("clickNode", ({ node }) => onSelect(node));
    renderer.on("clickStage", () => onSelect(undefined));
    sigmaRef.current = renderer;
    return () => {
      renderer.kill();
      sigmaRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // keep selection highlight in sync without rebuilding
  useEffect(() => {
    selectedRef.current = selected;
    sigmaRef.current?.refresh();
  }, [selected]);

  // pulse nodes the agent touched
  useEffect(() => {
    const latest = events[events.length - 1];
    if (!latest?.file) return;
    hotRef.current.set(latest.file, latest.ts);
    sigmaRef.current?.refresh();
    const timer = setTimeout(() => sigmaRef.current?.refresh(), HOT_MS + 100);
    return () => clearTimeout(timer);
  }, [events]);

  return <div ref={containerRef} className="graph-canvas" />;
}
