import { mountEntitySummary, type EntitySummaryProps } from "@grafting/ui";
import type {
  CanvasEdge,
  CanvasEdgePresentation,
  CanvasNode,
  CanvasNodeRenderContext,
  CanvasNodeViewDefinition,
  CanvasPortDefinition,
  UiStatus,
} from "@grafting/ui";
import type { BenchEdge, BenchGraph, BenchNode } from "./bench-graph.ts";
import { portCapacity, type BenchNodeKind, type BenchParamValues } from "./node-kind.ts";
import { BENCH_DATA_TYPES, findNodeKind } from "./registry.ts";

// The bench's own concrete composition, kept separate from the Graph IR
// explorer's `canvas-composition.ts` so laboratory vocabulary never reaches the
// read-only explorer (this app's AGENTS.md). Colors, port treatment, and
// interaction policy are product decisions the generic canvas never makes.

/** View identifiers this surface registers with the canvas. */
export const BENCH_CANVAS_VIEWS = Object.freeze({
  node: Object.freeze({ element: "bench.element" }),
  edge: Object.freeze({ value: "bench.value" }),
});

/** Rendered size of one element node. */
export const BENCH_NODE_SIZE = Object.freeze({ width: 208, height: 96 });

/** Product-owned color per value kind, so a user reads compatibility at a glance. */
const DATA_TYPE_COLORS: Readonly<Record<string, string>> = Object.freeze({
  [BENCH_DATA_TYPES.heightmap]: "#0ea5e9",
  [BENCH_DATA_TYPES.levels]: "#f59e0b",
  [BENCH_DATA_TYPES.any]: "#64748b",
});

const FALLBACK_COLOR = "#94a3b8";

/**
 * Resolves the color a value kind is drawn in.
 *
 * @param dataType - Opaque value kind declared by a port.
 * @returns A CSS color; unregistered kinds stay neutral rather than throwing,
 * since a missing color is a cosmetic gap, not a broken graph.
 */
export function colorForDataType(dataType: string): string {
  return DATA_TYPE_COLORS[dataType] ?? FALLBACK_COLOR;
}

/** What the last evaluation pass did with one node. */
export type BenchNodeStatus = "idle" | "evaluated" | "reused" | "waiting" | "failed";

const STATUS_PRESENTATION: Readonly<
  Record<BenchNodeStatus, { readonly status: UiStatus; readonly label: string } | undefined>
> = Object.freeze({
  idle: undefined,
  evaluated: Object.freeze({ status: "success" as const, label: "Evaluated" }),
  // Reusing a cached result is the intended outcome of an unrelated edit, not
  // a lesser one, so it reads as information rather than as a warning.
  reused: Object.freeze({ status: "info" as const, label: "Cached" }),
  waiting: Object.freeze({ status: "warning" as const, label: "Waiting for input" }),
  failed: Object.freeze({ status: "error" as const, label: "Failed" }),
});

/** Opaque node data this surface hands to its own node view. */
interface BenchNodeViewData {
  readonly title: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly status: BenchNodeStatus;
}

const readBenchNodeViewData = (value: unknown): BenchNodeViewData => {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Partial<BenchNodeViewData>).title !== "string" ||
    typeof (value as Partial<BenchNodeViewData>).summary !== "string" ||
    typeof (value as Partial<BenchNodeViewData>).status !== "string" ||
    !Array.isArray((value as Partial<BenchNodeViewData>).tags)
  ) {
    throw new Error("Bench node view received invalid data");
  }
  return value as BenchNodeViewData;
};

/**
 * Renders a node's parameters as short chips.
 *
 * @param kind - Element declaration supplying labels and order.
 * @param params - This instance's values.
 * @returns One `label value` chip per parameter.
 */
export function describeParams(kind: BenchNodeKind, params: BenchParamValues): readonly string[] {
  return kind.params.map((spec) => {
    const value = params[spec.id];
    if (spec.kind === "enum") {
      const option = spec.options.find((candidate) => candidate.value === value);
      return `${spec.label} ${option?.label ?? String(value)}`;
    }
    return `${spec.label} ${String(value)}`;
  });
}

const portPosition = (index: number, total: number, side: "left" | "right") =>
  Object.freeze({ x: side === "left" ? 0 : 1, y: (index + 1) / (total + 1) });

/**
 * Projects an element's declared ports into canvas ports.
 *
 * @param kind - Element declaration.
 * @returns Inputs on the left edge and outputs on the right, evenly spread.
 */
export function benchPorts(kind: BenchNodeKind): readonly CanvasPortDefinition[] {
  const build = (
    ports: BenchNodeKind["inputs"],
    side: "input" | "output",
  ): readonly CanvasPortDefinition[] =>
    ports.map((port, index) =>
      Object.freeze({
        id: port.id,
        position: portPosition(index, ports.length, side === "input" ? "left" : "right"),
        direction: side === "input" ? ("in" as const) : ("out" as const),
        dataType: port.dataType,
        capacity: portCapacity(port, side),
        magnet: true,
        presentation: Object.freeze({
          radius: 7,
          fill: colorForDataType(port.dataType),
          stroke: "#ffffff",
          strokeWidth: 2,
          label: port.label,
          labelColor: "#475569",
          labelFontSize: 9,
        }),
      }),
    );
  return Object.freeze([...build(kind.inputs, "input"), ...build(kind.outputs, "output")]);
}

/**
 * Projects one authored node into canvas presentation data.
 *
 * @param node - Placed element instance.
 * @param status - What the last evaluation pass did with it.
 * @returns Canvas node carrying this surface's own view data.
 */
export function toCanvasNode(node: BenchNode, status: BenchNodeStatus = "idle"): CanvasNode {
  const kind = findNodeKind(node.kindId);
  return Object.freeze({
    id: node.id,
    view: BENCH_CANVAS_VIEWS.node.element,
    x: node.x,
    y: node.y,
    ports: benchPorts(kind),
    data: Object.freeze({
      title: kind.title,
      summary: kind.category,
      tags: describeParams(kind, node.params),
      status,
    }),
  });
}

/**
 * Projects one authored connection into canvas presentation data.
 *
 * @param edge - Authored connection.
 * @param graph - Graph the connection belongs to, used to read its value kind.
 * @returns Canvas edge carrying the value kind it transports.
 */
export function toCanvasEdge(edge: BenchEdge, graph: BenchGraph): CanvasEdge {
  const sourceNode = graph.nodes.find((node) => node.id === edge.source.nodeId);
  const dataType =
    sourceNode === undefined
      ? undefined
      : findNodeKind(sourceNode.kindId).outputs.find((port) => port.id === edge.source.portId)?.dataType;
  return Object.freeze({
    id: edge.id,
    view: BENCH_CANVAS_VIEWS.edge.value,
    source: Object.freeze({ nodeId: edge.source.nodeId, portId: edge.source.portId }),
    target: Object.freeze({ nodeId: edge.target.nodeId, portId: edge.target.portId }),
    data: Object.freeze({ dataType: dataType ?? "" }),
  });
}

const toEntitySummaryProps = (context: CanvasNodeRenderContext): EntitySummaryProps => {
  const data = readBenchNodeViewData(context.node.data);
  const statusPresentation = STATUS_PRESENTATION[data.status];
  return Object.freeze({
    title: data.title,
    description: data.summary,
    status: statusPresentation?.status,
    statusLabel: statusPresentation?.label,
    ariaLabel: `${data.title} (${data.summary})`,
    accentColor: "#6366f1",
    backgroundColor: "#ffffff",
    selectedColor: "#2563eb",
    borderWidth: 2,
    borderRadius: 10,
    bodyPadding: 10,
    contentGap: 6,
    fillContainer: true,
    interactive: true,
    selected: context.selected,
    tags: data.tags,
  });
};

/** Node view mounting a Grafting UI component as the element's full boundary. */
export const BENCH_ELEMENT_NODE_VIEW: CanvasNodeViewDefinition = Object.freeze({
  id: BENCH_CANVAS_VIEWS.node.element,
  defaultWidth: BENCH_NODE_SIZE.width,
  defaultHeight: BENCH_NODE_SIZE.height,
  mount: (host: HTMLElement, context: CanvasNodeRenderContext) => {
    const mounted = mountEntitySummary(host, toEntitySummaryProps(context));
    return Object.freeze({
      update: (next: CanvasNodeRenderContext) => mounted.update(toEntitySummaryProps(next)),
      dispose: () => mounted.dispose(),
    });
  },
});

/**
 * Draws a connection in the color of the value it carries.
 *
 * @param context - Edge and its selection state.
 * @returns This surface's edge treatment.
 */
export function presentBenchEdge(context: {
  readonly edge: CanvasEdge;
  readonly selected: boolean;
}): CanvasEdgePresentation {
  const data = context.edge.data as { readonly dataType?: string } | undefined;
  const color = context.selected ? "#2563eb" : colorForDataType(data?.dataType ?? "");
  return Object.freeze({
    connector: Object.freeze({ kind: "smooth" as const, direction: "horizontal" as const }),
    zIndex: 1,
    hitAreaWidth: 16,
    line: Object.freeze({
      color,
      width: context.selected ? 3 : 2,
      targetMarker: Object.freeze({ kind: "block" as const, width: 8, height: 6, fill: color, stroke: color }),
    }),
  });
}
