"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Text, createCanvas, type CanvasHandle } from "@grafting/ui";
import {
  BENCH_CANVAS_VIEWS,
  BENCH_ELEMENT_NODE_VIEW,
  colorForDataType,
  presentBenchEdge,
  toCanvasEdge,
  toCanvasNode,
} from "../../../bench/bench-composition.ts";
import {
  EMPTY_BENCH_GRAPH,
  addBenchEdge,
  addBenchNode,
  duplicateBenchNode,
  moveBenchNode,
  removeBenchEdge,
  removeBenchNode,
  setBenchParam,
  type BenchGraph,
} from "../../../bench/bench-graph.ts";
import type { BenchParamValue } from "../../../bench/node-kind.ts";
import { findNodeKind, nodeKindsByCategory } from "../../../bench/registry.ts";
import ParameterPanel from "./parameter-panel.tsx";

const REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  "type-mismatch": "Those ports carry different value kinds.",
  "input-occupied": "That input already receives a value.",
  "unknown-port": "One of those ports is no longer declared.",
};

/**
 * The dataflow node bench.
 *
 * React holds the authored graph and the canvas renders it. Each edit updates
 * both in the same handler rather than diffing one against the other, so an
 * action that the graph rejects never reaches the surface, and the surface
 * never holds a node the graph does not know about.
 */
export default function BenchClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CanvasHandle | null>(null);
  // Canvas callbacks are registered once, so they read the graph through a ref
  // instead of closing over a state value that would be stale by the time a
  // user draws their second connection.
  const graphRef = useRef<BenchGraph>(EMPTY_BENCH_GRAPH);
  const [graph, setGraph] = useState<BenchGraph>(EMPTY_BENCH_GRAPH);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const commit = useCallback((next: BenchGraph) => {
    graphRef.current = next;
    setGraph(next);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || handleRef.current !== null) return;

    handleRef.current = createCanvas(container, [], [], {
      nodeViews: [BENCH_ELEMENT_NODE_VIEW],
      edgeViews: [{ id: BENCH_CANVAS_VIEWS.edge.value, present: presentBenchEdge }],
      surface: {
        backgroundColor: "#f8fafc",
        grid: { kind: "dot", size: 16, color: "#cbd5e1", thickness: 1 },
      },
      interaction: {
        panning: true,
        movableNodes: true,
        clickThreshold: 4,
        zoom: { modifiers: ["control", "meta"], factor: 1.08, minScale: 0.3, maxScale: 2.4 },
        selectOnActivate: true,
      },
      editing: {
        connectable: true,
        removableEdges: true,
        onConnectRequest: (request) => {
          const result = addBenchEdge(graphRef.current, request.source, request.target);
          if (result.refusal !== undefined) {
            setNotice(REFUSAL_MESSAGES[result.refusal] ?? "That connection is not allowed.");
            return { accepted: false, reason: result.refusal };
          }
          commit(result.graph);
          setNotice(null);
          return { accepted: true, edge: toCanvasEdge(result.edge, result.graph) };
        },
        onDisconnected: (edgeId) => commit(removeBenchEdge(graphRef.current, edgeId)),
        onNodeMoved: (nodeId, x, y) => commit(moveBenchNode(graphRef.current, nodeId, { x, y })),
      },
      onActivate: (entity) => setSelectedNodeId(entity.kind === "node" ? entity.id : null),
    });

    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [commit]);

  const placeNode = useCallback(
    (kindId: string) => {
      const placed = graphRef.current.nodes.length;
      const result = addBenchNode(graphRef.current, kindId, {
        x: 40 + (placed % 3) * 260,
        y: 40 + Math.floor(placed / 3) * 150,
      });
      commit(result.graph);
      const node = result.graph.nodes.find((candidate) => candidate.id === result.nodeId);
      if (node !== undefined) handleRef.current?.addNode(toCanvasNode(node));
      setSelectedNodeId(result.nodeId);
      setNotice(null);
    },
    [commit],
  );

  const duplicateSelected = useCallback(() => {
    if (selectedNodeId === null) return;
    const result = duplicateBenchNode(graphRef.current, selectedNodeId);
    commit(result.graph);
    const copy = result.graph.nodes.find((candidate) => candidate.id === result.nodeId);
    if (copy !== undefined) handleRef.current?.addNode(toCanvasNode(copy));
    setSelectedNodeId(result.nodeId);
  }, [commit, selectedNodeId]);

  const removeSelected = useCallback(() => {
    if (selectedNodeId === null) return;
    const result = removeBenchNode(graphRef.current, selectedNodeId);
    commit(result.graph);
    // The canvas removes attached edges with the node, so only the node itself
    // is reported here; asking it to remove them again would throw.
    handleRef.current?.removeNode(selectedNodeId);
    setSelectedNodeId(null);
  }, [commit, selectedNodeId]);

  const changeParam = useCallback(
    (paramId: string, raw: BenchParamValue) => {
      if (selectedNodeId === null) return;
      const next = setBenchParam(graphRef.current, selectedNodeId, paramId, raw);
      commit(next);
      const node = next.nodes.find((candidate) => candidate.id === selectedNodeId);
      if (node !== undefined) handleRef.current?.updateNode(toCanvasNode(node));
    },
    [commit, selectedNodeId],
  );

  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedKind = selectedNode === null ? null : findNodeKind(selectedNode.kindId);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 260px", gap: 12, padding: 12, height: "calc(100vh - 96px)" }}>
      <aside style={{ overflowY: "auto" }}>
        <Text content="Elements" strong />
        {nodeKindsByCategory().map((group) => (
          <div key={group.category} style={{ marginTop: 10 }}>
            <Text content={group.category} tone="muted" />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
              {group.kinds.map((kind) => (
                <Button key={kind.id} label={`+ ${kind.title}`} onClick={() => placeNode(kind.id)} />
              ))}
            </div>
          </div>
        ))}
      </aside>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 24 }}>
          <Text content={`${graph.nodes.length} elements, ${graph.edges.length} connections`} tone="muted" />
          {notice === null ? null : <Text content={notice} tone="danger" />}
        </div>
        <div ref={containerRef} style={{ flex: 1, minHeight: 0, border: "1px solid #e2e8f0", borderRadius: 8 }} />
      </div>

      <aside style={{ overflowY: "auto" }}>
        {selectedNode === null || selectedKind === null ? (
          <Text content="Select an element to edit its parameters." tone="muted" />
        ) : (
          <Card ariaLabel={`${selectedKind.title} parameters`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <Text content={selectedKind.title} strong />
                <Text content={selectedKind.description} tone="muted" />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Button label="Duplicate" onClick={duplicateSelected} />
                <Button label="Delete" onClick={removeSelected} />
              </div>
              <ParameterPanel
                specs={selectedKind.params}
                values={selectedNode.params}
                onChange={changeParam}
              />
              <div>
                <Text content="Ports" strong />
                {[...selectedKind.inputs, ...selectedKind.outputs].map((port) => (
                  <div key={`${port.id}:${port.dataType}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: colorForDataType(port.dataType),
                        display: "inline-block",
                      }}
                    />
                    <Text content={`${port.label} · ${port.dataType}`} tone="muted" />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}
      </aside>
    </div>
  );
}
