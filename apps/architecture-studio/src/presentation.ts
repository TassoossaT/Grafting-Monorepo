import type { CanvasEdge, CanvasEntityReference, CanvasNode } from "@grafting/x6-canvas";
import type { GraphLayoutRequest, GraphLayoutSnapshot } from "./layout-client.ts";
import {
  ARCHITECTURE_CANVAS_VIEWS,
  ARCHITECTURE_NODE_SIZE,
  type ArchitectureEdgeTreatment,
  type ArchitectureNodeTreatment,
} from "./canvas-views.ts";

export interface GraphIrEvidence {
  readonly kind: string;
  readonly path: string;
  readonly pointer?: string;
  readonly symbol?: string;
  readonly sha256: string;
}

export interface GraphIrProvenance {
  readonly extractor: { readonly id: string; readonly version: string };
  readonly sourceRevision: string;
  readonly confidence: number;
  readonly evidence: readonly GraphIrEvidence[];
}

export interface GraphIrNode {
  readonly id: string;
  readonly kind: string;
  readonly authorityClass: string;
  readonly level?: string;
  readonly label: string;
  readonly tags: readonly string[];
  readonly provenance: GraphIrProvenance;
}

export interface GraphIrEdge {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly target: string;
  readonly relationClass: string;
  readonly provenance: GraphIrProvenance;
}

export interface GraphIrDocument {
  readonly schemaVersion: "1.0.0";
  readonly graphId: string;
  readonly sourceRevision: string;
  readonly generator: { readonly id: string; readonly version: string; readonly inputHash: string };
  readonly nodes: readonly GraphIrNode[];
  readonly edges: readonly GraphIrEdge[];
}

export type GraphIrEntity = GraphIrNode | GraphIrEdge;

export interface GraphPresentation {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
}

/** Single authored configuration for the Rust-owned layout projection. */
export const PROJECTION = Object.freeze({
  node: Object.freeze({ ...ARCHITECTURE_NODE_SIZE }),
  layout: Object.freeze({
    nodeWidth: ARCHITECTURE_NODE_SIZE.width,
    nodeHeight: ARCHITECTURE_NODE_SIZE.height,
    horizontalGap: 32,
    verticalGap: 28,
    groupGap: 120,
    padding: 72,
    groupColumns: 3,
    memberColumns: 2,
  }),
  groupingEdgeKinds: Object.freeze(["contains"]),
});

const nodeTreatment = (kind: string): ArchitectureNodeTreatment => {
  if (kind === "project") return "project";
  if (kind === "target") return "target";
  return "other";
};

const edgeTreatment = (kind: string): ArchitectureEdgeTreatment => {
  if (kind === "contains") return "hierarchy";
  if (kind === "depends_on") return "dependency";
  return "reference";
};

export function assertGraphIrV1(value: unknown): asserts value is GraphIrDocument {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid Graph IR: expected a document object.");
  }
  const candidate = value as Partial<GraphIrDocument>;
  if (candidate.schemaVersion !== "1.0.0") {
    throw new Error(`Unsupported Graph IR schema: ${String(candidate.schemaVersion)}; expected 1.0.0.`);
  }
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    throw new Error("Invalid Graph IR: nodes and edges must be arrays.");
  }
}

export function toLayoutRequest(graph: GraphIrDocument): GraphLayoutRequest {
  return Object.freeze({
    nodes: Object.freeze(graph.nodes.map((node) => node.id)),
    edges: Object.freeze(
      graph.edges.map((edge) => Object.freeze({ id: edge.id, source: edge.source, target: edge.target })),
    ),
    groupingEdgeIds: Object.freeze(
      graph.edges
        .filter((edge) => PROJECTION.groupingEdgeKinds.some((kind) => kind === edge.kind))
        .map((edge) => edge.id),
    ),
    options: PROJECTION.layout,
  });
}

export function toCanvasPresentation(
  graph: GraphIrDocument,
  layout: GraphLayoutSnapshot,
): GraphPresentation {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const positions = new Map<string, { readonly x: number; readonly y: number }>();
  for (const position of layout.positions) {
    if (!nodeIds.has(position.id)) throw new Error(`Layout returned an unknown node: ${position.id}`);
    if (positions.has(position.id)) throw new Error(`Layout returned a duplicate node: ${position.id}`);
    positions.set(position.id, position);
  }

  const nodes = graph.nodes.map((node) => {
    const position = positions.get(node.id);
    if (position === undefined) throw new Error(`Layout did not return node: ${node.id}`);
    return Object.freeze({
      id: node.id,
      view: ARCHITECTURE_CANVAS_VIEWS.node.entitySummary,
      x: position.x,
      y: position.y,
      width: PROJECTION.node.width,
      height: PROJECTION.node.height,
      data: Object.freeze({
        title: node.label,
        description: node.kind,
        treatment: nodeTreatment(node.kind),
        tags: node.tags,
      }),
    } satisfies CanvasNode);
  });

  const edges = graph.edges.map((edge) => {
    const treatment = edgeTreatment(edge.kind);
    const horizontal = treatment === "dependency";
    return Object.freeze({
      id: edge.id,
      view: ARCHITECTURE_CANVAS_VIEWS.edge.relation,
      source: Object.freeze({ nodeId: edge.source, portId: horizontal ? "right" : "bottom" }),
      target: Object.freeze({ nodeId: edge.target, portId: horizontal ? "left" : "top" }),
      data: Object.freeze({
        ...(treatment === "hierarchy" ? {} : { label: edge.kind }),
        treatment,
      }),
    } satisfies CanvasEdge);
  });
  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) });
}

export function isGraphIrEdge(entity: GraphIrEntity): entity is GraphIrEdge {
  return "source" in entity && "target" in entity;
}

export function toEntityReference(entity: GraphIrEntity): CanvasEntityReference {
  return Object.freeze({ kind: isGraphIrEdge(entity) ? "edge" : "node", id: entity.id });
}

export function findEntity(
  graph: GraphIrDocument,
  reference: CanvasEntityReference,
): GraphIrEntity | undefined {
  return reference.kind === "node"
    ? graph.nodes.find((node) => node.id === reference.id)
    : graph.edges.find((edge) => edge.id === reference.id);
}
