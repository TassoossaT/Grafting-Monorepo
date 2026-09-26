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

/**
 * The handles at a spine's far end, beside its pivot: one above the end to
 * raise or lower it, and -- on a spiral -- one just past the end, following
 * the turn, to wind the spiral on or back. Named after the spine's lowest
 * control node like the pivot.
 */
export type SpineEndHandleKind = "height" | "turns";
const END_PREFIX: Readonly<Record<SpineEndHandleKind, string>> = { height: "spine-height:", turns: "spine-turns:" };
/** How far from the end its handles stand, so they never sit on the end point itself. */
const END_HANDLE_REACH = 1.2;

export const spineEndHandleId = (kind: SpineEndHandleKind, nodeId: string): string => `${END_PREFIX[kind]}${nodeId}`;

/** Which end handle `id` names, and after which node. */
export function spineEndHandleOf(id: string): { readonly kind: SpineEndHandleKind; readonly nodeId: string } | undefined {
  for (const kind of ["height", "turns"] as const) if (id.startsWith(END_PREFIX[kind])) return { kind, nodeId: id.slice(END_PREFIX[kind].length) };
  return undefined;
}

/** A spine control node `id` stands for: a pivot's or end handle's own node, a curve handle's span start, or `id` itself. */
export function spineMemberOf(graph: ConstructionGraphSnapshot, id: string): string {
  if (isSpinePivotId(id)) return id.slice(PREFIX.length);
  const end = spineEndHandleOf(id);
  if (end) return end.nodeId;
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

export interface SpineEndHandle {
  readonly id: string;
  readonly kind: SpineEndHandleKind;
  readonly position: ConstructionPosition;
  readonly owner: string | undefined;
  /** The spine's two free ends, first to last; the handles stand at the last. */
  readonly startNodeId: string;
  readonly endNodeId: string;
  /** For a spiral: its centre, and the plan direction the end leaves in. */
  readonly center?: readonly [number, number];
}

/** A spine's two free ends in a fixed order, or `undefined` for a branch or a loop. */
function openEnds(edges: readonly ConstructionEdgeSnapshot[]): readonly [string, string] | undefined {
  const degree = new Map<string, number>();
  for (const edge of edges) for (const id of [edge.startNodeId, edge.endNodeId]) degree.set(id, (degree.get(id) ?? 0) + 1);
  if ([...degree.values()].some((d) => d > 2)) return undefined;
  const ends = [...degree].filter(([, d]) => d === 1).map(([id]) => id).sort();
  return ends.length === 2 ? [ends[0]!, ends[1]!] : undefined;
}

function endHandlesOf(graph: ConstructionGraphSnapshot, pivot: SpinePivot): readonly SpineEndHandle[] {
  const ends = openEnds(pivot.edges);
  if (!ends) return [];
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const [startNodeId, endNodeId] = ends;
  const end = positions.get(endNodeId)!;
  const name = pivot.nodeIds[0]!;
  const handles: SpineEndHandle[] = [{
    id: spineEndHandleId("height", name), kind: "height", owner: pivot.owner, startNodeId, endNodeId,
    position: { ...end, y: end.y + END_HANDLE_REACH },
  }];
  const first = pivot.edges[0]!.curve?.geometry;
  const spiral = first?.kind === "arc" && pivot.edges.every((edge) => {
    const geometry = edge.curve?.geometry;
    return geometry?.kind === "arc" && Math.hypot(geometry.center[0] - first.center[0], geometry.center[1] - first.center[1]) < 1e-6;
  });
  if (!spiral || first.kind !== "arc") return handles;
  const last = pivot.edges.find((edge) => edge.startNodeId === endNodeId || edge.endNodeId === endNodeId)!;
  const before = positions.get(last.startNodeId === endNodeId ? last.endNodeId : last.startNodeId)!;
  const [cx, cz] = first.center;
  const angle = Math.atan2(end.z - cz, end.x - cx);
  let step = angle - Math.atan2(before.z - cz, before.x - cx);
  while (step > Math.PI) step -= 2 * Math.PI;
  while (step <= -Math.PI) step += 2 * Math.PI;
  // Just past the end, carrying on round the centre the way the spiral turns.
  const on = step >= 0 ? 1 : -1;
  const tangent = { x: -Math.sin(angle) * on, z: Math.cos(angle) * on };
  handles.push({
    id: spineEndHandleId("turns", name), kind: "turns", owner: pivot.owner, startNodeId, endNodeId, center: first.center,
    position: { x: end.x + tangent.x * END_HANDLE_REACH, y: end.y, z: end.z + tangent.z * END_HANDLE_REACH },
  });
  return handles;
}

/** Every open spine's end handles: height always, turns on a spiral. */
export function spineEndHandles(graph: ConstructionGraphSnapshot): readonly SpineEndHandle[] {
  return spinePivots(graph).flatMap((pivot) => endHandlesOf(graph, pivot));
}

/** The end handle `id` names, where it stands now. */
export function spineEndHandleAt(graph: ConstructionGraphSnapshot, id: string): SpineEndHandle | undefined {
  const named = spineEndHandleOf(id);
  const pivot = named && spinePivotAt(graph, named.nodeId);
  return pivot && endHandlesOf(graph, pivot).find((handle) => handle.kind === named!.kind);
}
