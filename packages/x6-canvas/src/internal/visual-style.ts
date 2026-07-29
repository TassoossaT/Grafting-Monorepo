import type { CanvasEdge, CanvasNode } from "../index.js";

const NODE_THEME = Object.freeze({
  group: Object.freeze({ accent: "#4f46e5", stroke: "#a5b4fc" }),
  item: Object.freeze({ accent: "#0f9f6e", stroke: "#a7dbc9" }),
  note: Object.freeze({ accent: "#7c3aed", stroke: "#c4b5fd" }),
});

const EDGE_THEME = Object.freeze({
  hierarchy: Object.freeze({
    connector: Object.freeze({
      name: "smooth",
      args: Object.freeze({ direction: "V" }),
    }),
    sourcePort: "bottom",
    targetPort: "top",
    stroke: "#94a3b8",
    labelFill: "#475569",
    width: 1.6,
    dash: "5 6",
  }),
  dependency: Object.freeze({
    connector: Object.freeze({
      name: "smooth",
      args: Object.freeze({ direction: "H" }),
    }),
    sourcePort: "right",
    targetPort: "left",
    stroke: "#6366f1",
    labelFill: "#4338ca",
    width: 2.2,
    dash: undefined,
  }),
  reference: Object.freeze({
    connector: Object.freeze({ name: "smooth" }),
    sourcePort: "bottom",
    targetPort: "top",
    stroke: "#8b5cf6",
    labelFill: "#6d28d9",
    width: 1.8,
    dash: "2 5",
  }),
});

const CARD_TEXT_LEFT = 50;
const CARD_TEXT_RIGHT = 16;
const CARD_TEXT_VERTICAL_PADDING = 8;

const toTextClipId = (nodeId: string) =>
  `grafting-node-text-${
    Array.from(nodeId, (character) => character.codePointAt(0)?.toString(16)).join("-") ||
    "empty"
  }`;

/** Private X6 highlighter shared by edge selection and deselection calls. */
export const X6_EDGE_SELECTION_HIGHLIGHT = Object.freeze({
  highlighter: Object.freeze({
    name: "stroke",
    args: Object.freeze({
      padding: 0,
      rx: 16,
      ry: 16,
      attrs: Object.freeze({
        stroke: "#2563eb",
        "stroke-width": 3,
      }),
    }),
  }),
});

interface X6SelectionView {
  findOne(selector: string): Element | null;
}

interface X6ReadOnlyInteractionOptions {
  readonly clickThreshold: number;
  readonly interacting: false;
  readonly panning: {
    readonly enabled: true;
    readonly eventTypes: "leftMouseDown"[];
  };
}

/** Allows ordinary mouse drag to pan while tolerating small movement during a click. */
export function toX6ReadOnlyInteractionOptions(): X6ReadOnlyInteractionOptions {
  return {
    clickThreshold: 4,
    interacting: false,
    panning: {
      enabled: true,
      eventTypes: ["leftMouseDown"],
    },
  };
}

/** Toggles the node's own outline without invoking vendor SVG path conversion. */
export function setX6NodeSelection(
  view: X6SelectionView,
  selected: boolean,
): boolean {
  const outline = view.findOne("selectionOutline");
  if (outline === null) return false;

  outline.setAttribute("opacity", selected ? "1" : "0");
  return true;
}

const portGroups = Object.freeze(
  Object.fromEntries(
    (["top", "right", "bottom", "left"] as const).map((side) => [
      side,
      Object.freeze({
        position: side,
        attrs: Object.freeze({
          circle: Object.freeze({
            r: 3.2,
            magnet: false,
            fill: "#ffffff",
            stroke: "#94a3b8",
            strokeWidth: 1.2,
            opacity: 0.9,
          }),
        }),
      }),
    ]),
  ),
);

/** Converts a vendor-neutral node role into private X6 SVG metadata. */
export function toX6NodeMetadata(node: CanvasNode) {
  const role = node.role ?? "note";
  const theme = NODE_THEME[role];
  const width = node.width ?? 240;
  const height = node.height ?? 68;
  const textWidth = Math.max(width - CARD_TEXT_LEFT - CARD_TEXT_RIGHT, 1);
  const textHeight = Math.max(height - CARD_TEXT_VERTICAL_PADDING * 2, 1);
  const textClipId = toTextClipId(node.id);

  return {
    id: node.id,
    x: node.x,
    y: node.y,
    width,
    height,
    zIndex: 2,
    markup: [
      {
        tagName: "defs",
        children: [
          {
            tagName: "clipPath",
            attrs: { id: textClipId, clipPathUnits: "userSpaceOnUse" },
            children: [
              {
                tagName: "rect",
                attrs: {
                  x: CARD_TEXT_LEFT,
                  y: CARD_TEXT_VERTICAL_PADDING,
                  width: textWidth,
                  height: textHeight,
                },
              },
            ],
          },
        ],
      },
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "selectionOutline" },
      { tagName: "rect", selector: "accent" },
      { tagName: "circle", selector: "glyph" },
      { tagName: "circle", selector: "glyphCore" },
      { tagName: "text", selector: "title" },
      { tagName: "text", selector: "caption" },
    ],
    attrs: {
      body: {
        refWidth: "100%",
        refHeight: "100%",
        fill: node.color ?? "#ffffff",
        stroke: theme.stroke,
        strokeWidth: role === "group" ? 1.5 : 1.2,
        rx: 16,
        ry: 16,
        cursor: "pointer",
        style: {
          filter: "drop-shadow(0 8px 14px rgba(15, 23, 42, 0.09))",
        },
      },
      selectionOutline: {
        refWidth: "100%",
        refHeight: "100%",
        fill: "none",
        stroke: "#2563eb",
        strokeWidth: 3,
        rx: 16,
        ry: 16,
        opacity: 0,
        pointerEvents: "none",
        vectorEffect: "non-scaling-stroke",
      },
      accent: {
        width: 5,
        refHeight: "100%",
        fill: theme.accent,
        rx: 2.5,
        ry: 2.5,
        pointerEvents: "none",
      },
      glyph: {
        cx: 29,
        cy: height / 2,
        r: role === "group" ? 11 : 9,
        fill: theme.accent,
        fillOpacity: 0.12,
        stroke: theme.accent,
        strokeWidth: 1.4,
        pointerEvents: "none",
      },
      glyphCore: {
        cx: 29,
        cy: height / 2,
        r: role === "group" ? 3.5 : 2.8,
        fill: theme.accent,
        pointerEvents: "none",
      },
      title: {
        textWrap: {
          text: node.label,
          width: textWidth,
          height: 18,
          ellipsis: "…",
        },
        x: CARD_TEXT_LEFT,
        y: height / 2 - 9,
        fill: "#172033",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        fontSize: role === "group" ? 15 : 14,
        fontWeight: role === "group" ? 700 : 650,
        lineHeight: 17,
        textAnchor: "start",
        textVerticalAnchor: "middle",
        clipPath: `url(#${textClipId})`,
        pointerEvents: "none",
      },
      caption: {
        textWrap: {
          text: node.caption ?? role,
          width: textWidth,
          height: 14,
          ellipsis: "…",
        },
        x: CARD_TEXT_LEFT,
        y: height / 2 + 12,
        fill: "#64748b",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        fontSize: 10,
        fontWeight: 650,
        lineHeight: 12,
        letterSpacing: 0.8,
        textAnchor: "start",
        textVerticalAnchor: "middle",
        clipPath: `url(#${textClipId})`,
        pointerEvents: "none",
      },
    },
    ports: {
      groups: portGroups,
      items: ["top", "right", "bottom", "left"].map((id) => ({ id, group: id })),
    },
  };
}

/** Converts a vendor-neutral edge role into private X6 path metadata. */
export function toX6EdgeMetadata(edge: CanvasEdge) {
  const role = edge.role ?? "reference";
  const theme = EDGE_THEME[role];
  const labels =
    edge.label === undefined
      ? []
      : [
          {
            attrs: {
              label: {
                text: edge.label,
                fill: theme.labelFill,
                fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: 0.45,
              },
              body: {
                ref: "label",
                fill: "#ffffff",
                fillOpacity: 0.96,
                stroke: theme.stroke,
                strokeOpacity: 0.55,
                strokeWidth: 1,
                refWidth: "140%",
                refHeight: "175%",
                refX: "-20%",
                refY: "-37.5%",
                rx: 8,
                ry: 8,
              },
            },
            position: { distance: 0.5 },
          },
        ];

  return {
    id: edge.id,
    source: { cell: edge.source, port: theme.sourcePort },
    target: { cell: edge.target, port: theme.targetPort },
    zIndex: 1,
    connector: theme.connector,
    labels,
    attrs: {
      wrap: {
        strokeWidth: 16,
        cursor: "pointer",
      },
      line: {
        stroke: theme.stroke,
        strokeWidth: theme.width,
        strokeDasharray: theme.dash,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        targetMarker: {
          name: "block",
          width: role === "hierarchy" ? 7 : 9,
          height: role === "hierarchy" ? 5 : 7,
          fill: theme.stroke,
          stroke: theme.stroke,
        },
      },
    },
  };
}
