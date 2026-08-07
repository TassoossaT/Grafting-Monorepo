import { createHeightfieldCanvas, mountEntitySummary, type EntitySummaryProps, type HeightfieldCanvas } from "@grafting/ui";
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
import {
  allInputPorts,
  portCapacity,
  type BenchNodeKind,
  type BenchParamSpec,
  type BenchParamValue,
  type BenchParamValues,
} from "./node-kind.ts";
import { BENCH_DATA_TYPES, findNodeKind } from "./registry.ts";

// The bench's own concrete composition, kept separate from the Graph IR
// explorer's `canvas-composition.ts` so laboratory vocabulary never reaches the
// read-only explorer (this app's AGENTS.md). Colors, port treatment, and
// interaction policy are product decisions the generic canvas never makes.

/** View identifiers this surface registers with the canvas. */
export const BENCH_CANVAS_VIEWS = Object.freeze({
  node: Object.freeze({
    element: "bench.element",
    control: "bench.control",
    viewport: "bench.viewport",
  }),
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
export function describeParams(
  kind: BenchNodeKind,
  params: BenchParamValues,
  drivenParams: readonly string[] = [],
): readonly string[] {
  return kind.params.map((spec) => {
    if (drivenParams.includes(spec.id)) return `${spec.label} ← wired`;
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
    ports: readonly BenchNodeKind["inputs"][number][],
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
          radius: 6,
          // Direction is readable at a glance without spending the colour that
          // already carries the value kind: an input is hollow, waiting to be
          // filled; an output is solid, already holding something.
          fill: side === "input" ? "#ffffff" : colorForDataType(port.dataType),
          stroke: colorForDataType(port.dataType),
          strokeWidth: side === "input" ? 3 : 2,
          label: port.label,
          labelColor: "#475569",
          labelFontSize: 9,
        }),
      }),
    );
  return Object.freeze([...build([...allInputPorts(kind)], "input"), ...build([...kind.outputs], "output")]);
}

/**
 * Sizes a node so every port has room.
 *
 * Ports are spread evenly down a side, so a node with many parameters needs
 * more height or they collide. The width is fixed: it is the label column that
 * has to stay readable, not the port column.
 *
 * @param kind - Element declaration.
 * @returns Rendered width and height in CSS pixels.
 */
export function benchNodeSize(kind: BenchNodeKind): { readonly width: number; readonly height: number } {
  const sides = Math.max(allInputPorts(kind).length, kind.outputs.length);
  const isViewport = kind.outputs.length === 0 && kind.inputs.length > 0;
  const base = isViewport ? 176 : BENCH_NODE_SIZE.height;
  return Object.freeze({
    width: isViewport ? 208 : BENCH_NODE_SIZE.width,
    height: Math.max(base, 34 + sides * 24),
  });
}

/**
 * Projects one authored node into canvas presentation data.
 *
 * @param node - Placed element instance.
 * @param status - What the last evaluation pass did with it.
 * @returns Canvas node carrying this surface's own view data.
 */
export function viewForKind(kind: BenchNodeKind): string {
  if (kind.category === "Controls") return BENCH_CANVAS_VIEWS.node.control;
  if (kind.outputs.length === 0) return BENCH_CANVAS_VIEWS.node.viewport;
  return BENCH_CANVAS_VIEWS.node.element;
}

/** Extra data a node view needs beyond the element's own declaration. */
export interface BenchNodeExtras {
  /** What the last evaluation pass did with the node. */
  readonly status?: BenchNodeStatus;
  /** Result to render, for a node whose view draws one. */
  readonly preview?: { readonly width: number; readonly height: number; readonly values: Float32Array } | null;
  /** Receives an edited value, for a node whose view is itself a control. */
  readonly onParamChange?: (paramId: string, raw: BenchParamValue) => void;
  /** Parameter ports currently fed by a connection, whose typed value is overridden. */
  readonly drivenParams?: readonly string[];
}

export function toCanvasNode(node: BenchNode, extras: BenchNodeExtras = {}): CanvasNode {
  const kind = findNodeKind(node.kindId);
  const natural = benchNodeSize(kind);
  const size = { width: node.width ?? natural.width, height: node.height ?? natural.height };
  return Object.freeze({
    id: node.id,
    view: viewForKind(kind),
    x: node.x,
    y: node.y,
    width: size.width,
    height: size.height,
    ports: benchPorts(kind),
    data: Object.freeze({
      title: kind.title,
      summary: kind.category,
      tags: describeParams(kind, node.params, extras.drivenParams ?? []),
      status: extras.status ?? "idle",
      params: kind.params,
      values: node.params,
      preview: extras.preview ?? null,
      onParamChange: extras.onParamChange,
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


const shell = (title: string): { root: HTMLElement; body: HTMLElement } => {
  const root = document.createElement("div");
  root.style.cssText =
    "width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:4px;" +
    "background:#ffffff;border:2px solid #6366f1;border-radius:10px;padding:8px;overflow:hidden";
  const heading = document.createElement("strong");
  heading.textContent = title;
  heading.style.cssText = "font-size:12px;color:#1e293b";
  const body = document.createElement("div");
  body.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:column;gap:4px";
  root.append(heading, body);
  return { root, body };
};

/**
 * Node view that renders its own input.
 *
 * A viewport exists to be looked at, so it draws the value that reaches it
 * rather than describing it. Without this, seeing what a filter did meant
 * reading a panel somewhere else, which is why a filter could look like it was
 * doing nothing at all.
 */
export const BENCH_VIEWPORT_NODE_VIEW: CanvasNodeViewDefinition = Object.freeze({
  id: BENCH_CANVAS_VIEWS.node.viewport,
  defaultWidth: 208,
  defaultHeight: 176,
  mount: (host: HTMLElement, initial: CanvasNodeRenderContext) => {
    let context = initial;
    const data = context.node.data as { readonly title: string; readonly preview: { width: number; height: number; values: Float32Array } | null };
    const { root, body } = shell(data.title);
    const surface = document.createElement("div");
    surface.style.cssText = "flex:1;min-height:0;border-radius:6px;overflow:hidden;background:#0f172a";
    const empty = document.createElement("span");
    empty.style.cssText = "font-size:10px;color:#94a3b8;padding:4px";
    body.append(surface, empty);
    host.append(root);

    let canvas: HeightfieldCanvas | null = null;
    let shape = "";
    let latest: { width: number; height: number; values: Float32Array } | null = null;
    let box = "";
    const apply = (next: CanvasNodeRenderContext) => {
      const value = (next.node.data as { readonly preview: { width: number; height: number; values: Float32Array } | null }).preview;
      if (value === null) {
        canvas?.dispose();
        canvas = null;
        shape = "";
        empty.textContent = "Connect something to see it.";
        return;
      }
      empty.textContent = "";
      latest = value;
      const nextShape = `${value.width}x${value.height}`;
      // The heightfield fixes both its grid and its pixel size when created, so
      // a changed grid *or* a resized node justifies rebuilding it; anything
      // else would restart the camera on every parameter tweak.
      const nextBox = `${Math.round(surface.clientWidth)}x${Math.round(surface.clientHeight)}`;
      if (canvas === null || shape !== nextShape || box !== nextBox) {
        box = nextBox;
        canvas?.dispose();
        canvas = createHeightfieldCanvas(surface, { width: value.width, height: value.height, values: value.values });
        shape = nextShape;
      } else {
        canvas.update(value.values);
      }
    };
    apply(context);

    // Growing the node has to grow the render, or enlarging a viewport to see
    // it better would leave the same small picture in a bigger frame. Rebuilds
    // are coalesced to one per frame so a drag does not thrash the renderer.
    let scheduled = 0;
    const observer = new ResizeObserver(() => {
      if (latest === null || scheduled !== 0) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        apply(context);
      });
    });
    observer.observe(surface);

    return Object.freeze({
      update: (next: CanvasNodeRenderContext) => {
        context = next;
        apply(next);
      },
      dispose: () => {
        observer.disconnect();
        if (scheduled !== 0) cancelAnimationFrame(scheduled);
        canvas?.dispose();
        canvas = null;
        root.remove();
      },
    });
  },
});

/**
 * Node view that is itself a control.
 *
 * The element's own parameter is edited on the node, so a value can be dialled
 * where it is wired rather than only in a side panel. Pointer events are kept
 * from bubbling, or grabbing a slider would drag the node instead.
 */
export const BENCH_CONTROL_NODE_VIEW: CanvasNodeViewDefinition = Object.freeze({
  id: BENCH_CANVAS_VIEWS.node.control,
  defaultWidth: BENCH_NODE_SIZE.width,
  defaultHeight: BENCH_NODE_SIZE.height,
  mount: (host: HTMLElement, context: CanvasNodeRenderContext) => {
    type ControlData = {
      readonly title: string;
      readonly params: readonly BenchParamSpec[];
      readonly values: BenchParamValues;
      readonly onParamChange?: (paramId: string, raw: BenchParamValue) => void;
    };
    let data = context.node.data as ControlData;
    const { root, body } = shell(data.title);
    const fields = new Map<string, HTMLInputElement | HTMLSelectElement>();

    for (const spec of data.params) {
      const field =
        spec.kind === "enum"
          ? Object.assign(document.createElement("select"), {})
          : Object.assign(document.createElement("input"), { type: spec.kind === "boolean" ? "checkbox" : "number" });
      field.style.cssText = "width:100%;box-sizing:border-box;padding:2px 6px;font-size:12px";
      if (spec.kind === "enum" && field instanceof HTMLSelectElement) {
        for (const option of spec.options) {
          field.append(new Option(option.label, option.value));
        }
      }
      // Without this the surface treats the press as the start of a node drag
      // and the control never receives it.
      field.addEventListener("pointerdown", (event) => event.stopPropagation());
      field.addEventListener("input", () => {
        const raw = field instanceof HTMLInputElement && field.type === "checkbox" ? field.checked : field.value;
        data.onParamChange?.(spec.id, raw as BenchParamValue);
      });
      const label = document.createElement("label");
      label.textContent = spec.label;
      label.style.cssText = "font-size:10px;color:#64748b";
      body.append(label, field);
      fields.set(spec.id, field);
    }
    host.append(root);

    const apply = (next: CanvasNodeRenderContext) => {
      data = next.node.data as ControlData;
      for (const [id, field] of fields) {
        const value = data.values[id];
        if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = value === true;
        else if (document.activeElement !== field) field.value = String(value ?? "");
      }
    };
    apply(context);

    return Object.freeze({ update: apply, dispose: () => root.remove() });
  },
});
