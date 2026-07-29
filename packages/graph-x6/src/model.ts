import type { CanvasEdge, CanvasNode } from "@grafting/x6-canvas";

export interface GraphIrNode {
  readonly id: string;
  readonly kind: "project" | "agent" | "task";
  readonly label: string;
  readonly tags: readonly string[];
  readonly source: string;
}

export interface GraphIrEdge {
  readonly id: string;
  readonly kind: "depends_on" | "owned_by";
  readonly source: string;
  readonly target: string;
  readonly evidence: string;
}

export interface GraphIrCandidate {
  readonly schemaVersion: "0.1-spike";
  readonly inputHash: string;
  readonly nodes: readonly GraphIrNode[];
  readonly edges: readonly GraphIrEdge[];
}

const colors = { project: "#e7f0ff", agent: "#e8f8ee", task: "#fff3d6" } as const;

export function toCanvasModel(ir: GraphIrCandidate): {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
} {
  const rows = new Map<GraphIrNode["kind"], number>();
  const columns = { project: 40, task: 360, agent: 680 } as const;
  const nodes = ir.nodes.map((node) => {
    const row = rows.get(node.kind) ?? 0;
    rows.set(node.kind, row + 1);
    return {
      id: node.id,
      label: `${node.label}\n${node.tags.join(" · ")}`,
      x: columns[node.kind],
      y: 40 + row * 72,
      color: colors[node.kind],
    } satisfies CanvasNode;
  });
  const edges = ir.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.kind,
  } satisfies CanvasEdge));
  return { nodes, edges };
}
