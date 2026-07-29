import type { Edge } from "@antv/x6";

import type {
  CanvasEdgeConnector,
  CanvasEdgeMarkerPresentation,
  CanvasEdgePresentation,
} from "../index.js";

/** Private data retained by an X6 edge for replaceable presentation updates. */
export interface EdgeHostData {
  readonly edge: import("../index.js").CanvasEdge;
  readonly definition: import("../index.js").CanvasEdgeViewDefinition;
  readonly selected: boolean;
}

const toX6Connector = (connector: CanvasEdgeConnector | undefined) => {
  if (connector === undefined) return undefined;
  if (connector.kind === "straight") return { name: "normal" };
  if (connector.kind === "rounded") {
    return {
      name: "rounded",
      ...(connector.radius === undefined ? {} : { args: { radius: connector.radius } }),
    };
  }
  return {
    name: "smooth",
    ...(connector.direction === undefined
      ? {}
      : { args: { direction: connector.direction === "horizontal" ? "H" : "V" } }),
  };
};

const toX6Marker = (marker: CanvasEdgeMarkerPresentation | undefined) => {
  if (marker === undefined) return undefined;
  if (marker.kind === "none") return null;
  return {
    name: marker.kind,
    width: marker.width,
    height: marker.height,
    fill: marker.fill,
    stroke: marker.stroke,
  };
};

/** Maps a neutral edge presentation to private X6 metadata. */
export function toX6EdgePresentation(presentation: CanvasEdgePresentation) {
  const line = presentation.line;
  return {
    connector: toX6Connector(presentation.connector),
    zIndex: presentation.zIndex,
    labels: (presentation.labels ?? []).map((label) => ({
      position: { distance: label.position ?? 0.5 },
      attrs: {
        label: {
          text: label.text,
          fill: label.color,
          fontSize: label.fontSize,
          fontWeight: label.fontWeight,
          class: label.className,
        },
        body: {
          ref: "label",
          fill: label.backgroundColor,
          stroke: label.borderColor,
          rx: label.borderRadius,
          ry: label.borderRadius,
        },
      },
    })),
    attrs: {
      wrap: {
        strokeWidth: presentation.hitAreaWidth,
      },
      line: {
        ...(line?.attributes ?? {}),
        stroke: line?.color,
        strokeWidth: line?.width,
        strokeDasharray: line?.dash,
        strokeOpacity: line?.opacity,
        class: line?.className,
        sourceMarker: toX6Marker(line?.sourceMarker),
        targetMarker: toX6Marker(line?.targetMarker),
      },
    },
  };
}

/** Replaces the complete private X6 edge presentation. */
export function applyEdgePresentation(edge: Edge, presentation: CanvasEdgePresentation): void {
  const mapped = toX6EdgePresentation(presentation);
  if (mapped.connector === undefined) edge.removeConnector();
  else edge.setConnector(mapped.connector);
  edge.setLabels(mapped.labels);
  edge.replaceAttrs(mapped.attrs);
  if (mapped.zIndex !== undefined) edge.setZIndex(mapped.zIndex);
}
