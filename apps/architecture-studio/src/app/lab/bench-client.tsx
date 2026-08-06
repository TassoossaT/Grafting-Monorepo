"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "next/link";
import {
  Button,
  Card,
  Text,
  createCanvas,
  type CanvasEntityReference,
  type CanvasHandle,
} from "@grafting/ui";
import {
  BENCH_CANVAS_VIEWS,
  BENCH_ELEMENT_NODE_VIEW,
  colorForDataType,
  presentBenchEdge,
  toCanvasEdge,
  toCanvasNode,
  type BenchNodeStatus,
} from "../../bench/bench-composition.ts";
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
} from "../../bench/bench-graph.ts";
import {
  disposeEvaluation,
  requestEvaluation,
  type EvaluationPreview,
} from "../../bench/evaluation-client.ts";
import { requestEvaluationOrder } from "../../bench/evaluation-order-client.ts";
import { buildEvaluationPlan } from "../../bench/evaluation-plan.ts";
import { resolveNodeStatuses, resolvePreviewTarget } from "../../bench/evaluation-status.ts";
import { diffNodeStatuses } from "../../bench/node-refresh.ts";
import type { BenchParamValue } from "../../bench/node-kind.ts";
import { findNodeKind, nodeKindsByCategory } from "../../bench/registry.ts";
import ParameterPanel from "./parameter-panel.tsx";
import PreviewPanel from "./preview-panel.tsx";

const REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  "type-mismatch": "Those ports carry different value kinds.",
  "input-occupied": "That input already receives a value.",
  "unknown-port": "One of those ports is no longer declared.",
};

const VIEWPORT_KIND_ID = "output.viewport";

// Parameters are edited by typing and dragging, so a pass is scheduled rather
// than fired per keystroke. Long enough to swallow a burst of edits, short
// enough that the render still feels attached to the control.
const EVALUATION_DEBOUNCE_MS = 160;

const EMPTY_STATUSES: Readonly<Record<string, BenchNodeStatus>> = Object.freeze({});

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
  // Selection follows the graph through a ref for the same reason: the canvas
  // callbacks below are registered once and would otherwise read a stale value.
  const selectionRef = useRef<CanvasEntityReference | null>(null);
  const [graph, setGraph] = useState<BenchGraph>(EMPTY_BENCH_GRAPH);
  const [selection, setSelection] = useState<CanvasEntityReference | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Readonly<Record<string, BenchNodeStatus>>>(EMPTY_STATUSES);
  const [preview, setPreview] = useState<EvaluationPreview | null>(null);
  const [runSummary, setRunSummary] = useState<string | null>(null);

  const commit = useCallback((next: BenchGraph) => {
    graphRef.current = next;
    setGraph(next);
  }, []);

  const rememberSelection = useCallback((next: CanvasEntityReference | null) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);

  // Evaluation only ever previews a node, so it reads the narrowed form.
  const selectedNodeId = selection?.kind === "node" ? selection.id : null;

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
        zoom: { modifiers: [], factor: 1.08, minScale: 0.3, maxScale: 2.4 },
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
        onDisconnected: (edgeId) => {
          commit(removeBenchEdge(graphRef.current, edgeId));
          const selected = selectionRef.current;
          if (selected?.kind === "edge" && selected.id === edgeId) rememberSelection(null);
        },
        onNodeMoved: (nodeId, x, y) => commit(moveBenchNode(graphRef.current, nodeId, { x, y })),
      },
      onActivate: rememberSelection,
    });

    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
      disposeEvaluation();
    };
  }, [commit, rememberSelection]);

  // One evaluation pass per settled edit: Rust orders the graph, the plan gives
  // every step a content hash, and the worker runs only what that hash says is
  // new. A pass superseded by a newer edit drops its result on the floor.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const current = graphRef.current;
        if (current.nodes.length === 0) {
          setStatuses(EMPTY_STATUSES);
          setPreview(null);
          setRunSummary(null);
          return;
        }

        try {
          const ordering = await requestEvaluationOrder({
            nodes: current.nodes.map((node) => node.id),
            edges: current.edges.map((edge) => ({
              id: edge.id,
              source: edge.source.nodeId,
              target: edge.target.nodeId,
            })),
          });
          if (cancelled) return;

          if (ordering.outcome === "cyclic") {
            setStatuses(resolveNodeStatuses({ steps: [], skipped: [], hashes: {} }, null, ordering.blocked));
            setPreview(null);
            setRunSummary(null);
            setNotice(`A cycle blocks ${ordering.blocked.length} element(s); break it to evaluate.`);
            return;
          }

          const plan = buildEvaluationPlan(current, ordering.order);
          const viewportNodeIds = current.nodes
            .filter((node) => node.kindId === VIEWPORT_KIND_ID)
            .map((node) => node.id);
          const target = resolvePreviewTarget(viewportNodeIds, selectedNodeId);

          const outcome = await requestEvaluation({
            plan,
            previewNodeIds: target === null ? [] : [target],
          });
          if (cancelled) return;

          setStatuses(resolveNodeStatuses(plan, outcome));
          setPreview(target === null ? null : (outcome.previews[target] ?? null));
          setRunSummary(`${outcome.evaluated.length} evaluated, ${outcome.reused.length} cached`);
          const firstFailure = Object.values(outcome.failures)[0];
          setNotice(firstFailure ?? null);
        } catch (error) {
          if (cancelled) return;
          setNotice(error instanceof Error ? error.message : String(error));
        }
      })();
    }, EVALUATION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [graph, selectedNodeId]);

  // Badges live on the node itself, so the surface has to be told when a pass
  // changes them. Only nodes whose badge actually moved are touched.
  const renderedStatuses = useRef<Readonly<Record<string, BenchNodeStatus>>>(EMPTY_STATUSES);
  useEffect(() => {
    const handle = handleRef.current;
    if (handle === null) return;
    const { changed, next } = diffNodeStatuses(graph.nodes, statuses, renderedStatuses.current);
    for (const entry of changed) handle.updateNode(toCanvasNode(entry.node, entry.status));
    renderedStatuses.current = next;
  }, [graph, statuses]);

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
      const nextSelection = Object.freeze({ kind: "node" as const, id: result.nodeId });
      rememberSelection(nextSelection);
      handleRef.current?.setSelection(nextSelection);
      setNotice(null);
    },
    [commit, rememberSelection],
  );

  const duplicateSelected = useCallback(() => {
    const selected = selectionRef.current;
    if (selected?.kind !== "node") return;
    const result = duplicateBenchNode(graphRef.current, selected.id);
    commit(result.graph);
    const copy = result.graph.nodes.find((candidate) => candidate.id === result.nodeId);
    if (copy !== undefined) handleRef.current?.addNode(toCanvasNode(copy));
    const nextSelection = Object.freeze({ kind: "node" as const, id: result.nodeId });
    rememberSelection(nextSelection);
    handleRef.current?.setSelection(nextSelection);
  }, [commit, rememberSelection]);

  const removeSelected = useCallback(() => {
    const selected = selectionRef.current;
    if (selected === null) return;
    if (selected.kind === "node") {
      const result = removeBenchNode(graphRef.current, selected.id);
      commit(result.graph);
      // The canvas removes attached edges with the node, so only the node itself
      // is reported here; asking it to remove them again would throw.
      handleRef.current?.removeNode(selected.id);
    } else {
      commit(removeBenchEdge(graphRef.current, selected.id));
      handleRef.current?.removeEdge(selected.id);
    }
    rememberSelection(null);
  }, [commit, rememberSelection]);

  const handleCanvasKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      // A parameter field can hold focus inside the surface; deleting the node
      // out from under someone editing a number would be its own bug.
      const target = event.target;
      if (target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      event.preventDefault();
      removeSelected();
    },
    [removeSelected],
  );

  const changeParam = useCallback(
    (paramId: string, raw: BenchParamValue) => {
      const selected = selectionRef.current;
      if (selected?.kind !== "node") return;
      const next = setBenchParam(graphRef.current, selected.id, paramId, raw);
      commit(next);
      const node = next.nodes.find((candidate) => candidate.id === selected.id);
      if (node !== undefined) {
        handleRef.current?.updateNode(toCanvasNode(node, statuses[selected.id] ?? "idle"));
      }
    },
    [commit, statuses],
  );

  const selectedNode =
    selectedNodeId === null ? null : (graph.nodes.find((node) => node.id === selectedNodeId) ?? null);
  const selectedEdge =
    selection?.kind === "edge" ? (graph.edges.find((edge) => edge.id === selection.id) ?? null) : null;
  const selectedKind = selectedNode === null ? null : findNodeKind(selectedNode.kindId);
  const previewTarget = resolvePreviewTarget(
    graph.nodes.filter((node) => node.kindId === VIEWPORT_KIND_ID).map((node) => node.id),
    selectedNodeId,
  );
  const previewNode = graph.nodes.find((node) => node.id === previewTarget) ?? null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "190px 1fr 300px", gap: 12, padding: 12, height: "calc(100vh - 96px)" }}>
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 24, flexWrap: "wrap" }}>
          <Text content={`${graph.nodes.length} elements, ${graph.edges.length} connections`} tone="muted" />
          {runSummary === null ? null : <Text content={runSummary} tone="muted" />}
          {notice === null ? null : <Text content={notice} tone="danger" />}
          <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <Button label="Zoom out" onClick={() => handleRef.current?.zoomBy(1 / 1.2)} />
            <Button label="Zoom in" onClick={() => handleRef.current?.zoomBy(1.2)} />
            <Button label="100%" onClick={() => handleRef.current?.resetZoom()} />
            <Button label="Fit" onClick={() => handleRef.current?.center()} />
            {selection === null ? null : <Button label="Delete selected" onClick={removeSelected} />}
            <Link href="/lab/trials">Standalone trials &rarr;</Link>
          </span>
        </div>
        <Text
          content="Wheel: zoom · drag empty space: pan · drag an output port to an input port: connect · Delete: remove selection"
          tone="muted"
        />
        <div
          ref={containerRef}
          aria-label="Editable dataflow canvas"
          tabIndex={0}
          onPointerDown={() => containerRef.current?.focus({ preventScroll: true })}
          onKeyDown={handleCanvasKeyDown}
          style={{ flex: 1, minHeight: 0, border: "1px solid #e2e8f0", borderRadius: 8, outlineOffset: 2 }}
        />
      </div>

      <aside style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
        <div style={{ height: 260, flexShrink: 0 }}>
          <PreviewPanel
            preview={preview}
            label={previewNode === null ? null : findNodeKind(previewNode.kindId).title}
          />
        </div>
        <div style={{ overflowY: "auto", minHeight: 0 }}>
          {selectedEdge !== null ? (
            <Card ariaLabel="Selected connection">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Text content="Connection selected" strong />
                <Text
                  content={`${selectedEdge.source.nodeId}:${selectedEdge.source.portId} → ${selectedEdge.target.nodeId}:${selectedEdge.target.portId}`}
                  tone="muted"
                />
                <Button label="Delete connection" onClick={removeSelected} />
              </div>
            </Card>
          ) : selectedNode === null || selectedKind === null ? (
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
        </div>
      </aside>
    </div>
  );
}
