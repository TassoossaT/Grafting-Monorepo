import { mountEntitySummary, type EntitySummaryProps } from "@grafting/ui";
import type {
  CanvasEdgePresentation,
  CanvasEdgeRenderContext,
  CanvasNodeRenderContext,
  CanvasNodeViewDefinition,
  CanvasPortDefinition,
  ReadOnlyCanvasOptions,
} from "@grafting/x6-canvas";
import {
  ARCHITECTURE_CANVAS_VIEWS,
  ARCHITECTURE_NODE_SIZE,
  readArchitectureEdgeViewData,
  readArchitectureNodeViewData,
  type ArchitectureEdgeTreatment,
  type ArchitectureNodeTreatment,
} from "./canvas-views.ts";

const NODE_PALETTE: Readonly<
  Record<ArchitectureNodeTreatment, { readonly accent: string; readonly background: string }>
> = Object.freeze({
  project: Object.freeze({ accent: "#4f46e5", background: "#e3edff" }),
  target: Object.freeze({ accent: "#15803d", background: "#e7f7ee" }),
  other: Object.freeze({ accent: "#7c3aed", background: "#f2edff" }),
});

const EDGE_PALETTE: Readonly<
  Record<ArchitectureEdgeTreatment, { readonly color: string; readonly label: string }>
> = Object.freeze({
  hierarchy: Object.freeze({ color: "#94a3b8", label: "#475569" }),
  dependency: Object.freeze({ color: "#6366f1", label: "#4338ca" }),
  reference: Object.freeze({ color: "#8b5cf6", label: "#6d28d9" }),
});

const CARDINAL_PORTS: readonly CanvasPortDefinition[] = Object.freeze(
  (["top", "right", "bottom", "left"] as const).map((position) =>
    Object.freeze({
      id: position,
      position,
      presentation: Object.freeze({
        radius: 3.2,
        fill: "#ffffff",
        stroke: "#94a3b8",
        strokeWidth: 1.2,
        opacity: 0.9,
      }),
    }),
  ),
);

const toEntitySummaryProps = (context: CanvasNodeRenderContext): EntitySummaryProps => {
  const data = readArchitectureNodeViewData(context.node.data);
  const palette = NODE_PALETTE[data.treatment];
  return Object.freeze({
    title: data.title,
    description: data.description,
    ariaLabel: `${data.title} (${data.description})`,
    className: "architecture-node-card",
    accentColor: palette.accent,
    backgroundColor: palette.background,
    selectedColor: "#2563eb",
    borderWidth: 3,
    borderRadius: 8,
    bodyPadding: 12,
    contentGap: 10,
    fillContainer: true,
    interactive: true,
    selected: context.selected,
    tags: data.tags,
  });
};

const ENTITY_SUMMARY_NODE_VIEW: CanvasNodeViewDefinition = Object.freeze({
  id: ARCHITECTURE_CANVAS_VIEWS.node.entitySummary,
  defaultWidth: ARCHITECTURE_NODE_SIZE.width,
  defaultHeight: ARCHITECTURE_NODE_SIZE.height,
  ports: CARDINAL_PORTS,
  mount: (host: HTMLElement, context: CanvasNodeRenderContext) => {
    const mounted = mountEntitySummary(host, toEntitySummaryProps(context));
    return Object.freeze({
      update: (next: CanvasNodeRenderContext) => mounted.update(toEntitySummaryProps(next)),
      dispose: () => mounted.dispose(),
    });
  },
});

/** Product-owned edge projection, including curves, arrows, labels, and selection effects. */
export function presentArchitectureEdge(
  context: CanvasEdgeRenderContext,
): CanvasEdgePresentation {
  const data = readArchitectureEdgeViewData(context.edge.data);
  const palette = EDGE_PALETTE[data.treatment];
  const color = context.selected ? "#2563eb" : palette.color;
  const hierarchy = data.treatment === "hierarchy";
  const dependency = data.treatment === "dependency";
  return Object.freeze({
    connector: Object.freeze({
      kind: "smooth" as const,
      ...(dependency
        ? { direction: "horizontal" as const }
        : hierarchy
          ? { direction: "vertical" as const }
          : {}),
    }),
    zIndex: 1,
    hitAreaWidth: 16,
    line: Object.freeze({
      color,
      width: context.selected ? 3 : dependency ? 2.2 : hierarchy ? 1.6 : 1.8,
      dash: hierarchy ? "5 6" : data.treatment === "reference" ? "2 5" : undefined,
      className: `architecture-edge architecture-edge--${data.treatment}`,
      attributes: context.selected
        ? Object.freeze({ filter: "drop-shadow(0 0 3px rgba(37, 99, 235, 0.45))" })
        : undefined,
      targetMarker: Object.freeze({
        kind: "block" as const,
        width: hierarchy ? 7 : 9,
        height: hierarchy ? 5 : 7,
        fill: color,
        stroke: color,
      }),
    }),
    labels:
      data.label === undefined
        ? Object.freeze([])
        : Object.freeze([
            Object.freeze({
              text: data.label,
              color: palette.label,
              fontSize: 9.5,
              fontWeight: 700,
              backgroundColor: "#ffffff",
              borderColor: color,
              borderRadius: 8,
            }),
          ]),
  });
}

/** Complete product-owned composition consumed by the generic canvas package. */
export const ARCHITECTURE_CANVAS_COMPOSITION: ReadOnlyCanvasOptions = Object.freeze({
  nodeViews: Object.freeze([ENTITY_SUMMARY_NODE_VIEW]),
  edgeViews: Object.freeze([
    Object.freeze({
      id: ARCHITECTURE_CANVAS_VIEWS.edge.relation,
      present: presentArchitectureEdge,
    }),
  ]),
  surface: Object.freeze({
    backgroundColor: "#f8fafc",
    grid: Object.freeze({ kind: "dot", size: 16, color: "#cbd5e1", thickness: 1 }),
  }),
  interaction: Object.freeze({
    panning: true,
    movableNodes: true,
    clickThreshold: 4,
    zoom: Object.freeze({
      modifiers: Object.freeze(["control", "meta"] as const),
      factor: 1.08,
      minScale: 0.3,
      maxScale: 2.4,
    }),
    selectOnActivate: true,
  }),
  viewport: Object.freeze({ fitOnCreate: true, padding: 64, maxScale: 1 }),
});
