import type { ConstructionEdgeSnapshot, ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionPosition } from "@/ports";

import { curvePick } from "../topology/curve-handles.ts";
import { isSpineEdge, spineComponent, spineOwnerOf } from "./spine-owner.ts";

/**
 * One handle per spine that stands for the whole thing -- what a road, a
 * ramp or a spiral is grabbed by to be moved as one. It sits at a spiral's
 * centre when every span is an arc round the same one, and at the middle of
 * the spine's control points otherwise.
 *
 * A pivot is named after the spine's lowest control node id, so it stays the
 * same handle through every edit that keeps that node. It is not a graph
 * node: moving it moves every node of its spine, and every arc centre with
 * them.
 */
const PREFIX = "spine-pivot:";

export const spinePivotId = (nodeId: string): string => `${PREFIX}${nodeId}`;

export function isSpinePivotId(id: string): boolean {
  return id.startsWith(PREFIX);
}

/** A spine control node `id` stands for: a pivot's own node, a curve handle's span start, or `id` itself. */
export function spineMemberOf(graph: ConstructionGraphSnapshot, id: string): string {
  if (isSpinePivotId(id)) return id.slice(PREFIX.length);
  const pick = curvePick(id);
  return pick ? graph.edges.find((edge) => edge.edgeId === pick.edgeId)?.startNodeId ?? id : id;
}

export interface SpinePivot {
  readonly id: string;
  readonly position: ConstructionPosition;
  /** The type the spine generates. */
  readonly owner: string | undefined;
  readonly nodeIds: readonly string[];
  readonly edges: readonly ConstructionEdgeSnapshot[];
}

function pivotOf(graph: ConstructionGraphSnapshot, edges: readonly ConstructionEdgeSnapshot[]): SpinePivot | undefined {
  if (edges.length === 0) return undefined;
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const nodeIds = [...new Set(edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId]))].filter((id) => positions.has(id)).sort();
  if (nodeIds.length === 0) return undefined;
  const points = nodeIds.map((id) => positions.get(id)!);
  const mean = (axis: "x" | "y" | "z") => points.reduce((sum, p) => sum + p[axis], 0) / points.length;
  const first = edges[0]!.curve?.geometry;
  const shared = first?.kind === "arc" && edges.every((edge) => {
    const geometry = edge.curve?.geometry;
    return geometry?.kind === "arc" && Math.hypot(geometry.center[0] - first.center[0], geometry.center[1] - first.center[1]) < 1e-6;
  });
  const position = shared && first.kind === "arc"
    ? { x: first.center[0], y: mean("y"), z: first.center[1] }
    : { x: mean("x"), y: mean("y"), z: mean("z") };
  return { id: spinePivotId(nodeIds[0]!), position, owner: spineOwnerOf(edges[0]!), nodeIds, edges };
}

/** Every spine's pivot. */
export function spinePivots(graph: ConstructionGraphSnapshot): readonly SpinePivot[] {
  const pivots: SpinePivot[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (!edge.curve || !isSpineEdge(edge) || seen.has(edge.edgeId)) continue;
    const component = spineComponent(graph, [edge.startNodeId]).edges.filter((e) => e.curve);
    for (const member of component) seen.add(member.edgeId);
    const pivot = pivotOf(graph, component);
    if (pivot) pivots.push(pivot);
  }
  return pivots;
}

/** The pivot of the spine `id` belongs to -- a pivot, a control node or a curve handle. */
export function spinePivotAt(graph: ConstructionGraphSnapshot, id: string): SpinePivot | undefined {
  const member = spineMemberOf(graph, id);
  return pivotOf(graph, spineComponent(graph, [member]).edges.filter((edge) => edge.curve));
}

/**
 * The graph patch moving the whole spine of `pivot` by `delta`: every
 * control node, and every arc centre, so each span keeps its shape. The
 * owner regenerates its surface from it like from any other spine edit.
 */
export function planSpineTranslate(graph: ConstructionGraphSnapshot, pivot: SpinePivot, delta: ConstructionPosition): ConstructionGraphPatch {
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const shaped = pivot.edges.filter((edge) => edge.curve?.geometry?.kind === "arc");
  return {
    nodes: pivot.nodeIds.map((id) => {
      const p = positions.get(id)!;
      return { id, position: { x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z } };
    }),
    removedEdgeIds: shaped.map((edge) => edge.edgeId),
    edges: shaped.map((edge) => {
      const geometry = edge.curve!.geometry!;
      return geometry.kind !== "arc" ? edge : {
        ...edge,
        curve: { ...edge.curve!, geometry: { ...geometry, center: [geometry.center[0] + delta.x, geometry.center[1] + delta.z] as const } },
      };
    }),
  };
}
