import { Graph } from "@antv/x6";

export interface CanvasNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly color?: string;
}

export interface CanvasEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
}

export interface ReadOnlyCanvas {
  readonly nodeCount: number;
  readonly edgeCount: number;
  center(): void;
  dispose(): void;
}

export function createReadOnlyCanvas(
  container: HTMLElement,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): ReadOnlyCanvas {
  const graph = new Graph({
    container,
    background: { color: "#f7f9fc" },
    grid: { visible: true, size: 10 },
    interacting: false,
    panning: true,
    mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], minScale: 0.35, maxScale: 2 },
  });

  graph.fromJSON({
    nodes: nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width ?? 220,
      height: node.height ?? 48,
      label: node.label,
      attrs: {
        body: { fill: node.color ?? "#ffffff", stroke: "#5b6b88", rx: 8, ry: 8 },
        label: { fill: "#172033", fontSize: 12 },
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      attrs: { line: { stroke: "#8795ad", targetMarker: "classic" } },
    })),
  });
  graph.centerContent();

  return Object.freeze({
    nodeCount: nodes.length,
    edgeCount: edges.length,
    center: () => graph.centerContent(),
    dispose: () => graph.dispose(),
  });
}
