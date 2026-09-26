import type { ConstructionEdgeSnapshot, ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionPosition } from "@/ports";

import { planAngle, rotateInPlan, rotateVectorInPlan, wrapAngle, type PlanPoint } from "../topology/plan-rotation.ts";
import { openSpineChain, sharedArcCenter } from "./spine-open-chain.ts";
import { spineGlobalHandleId, spineGlobalHandleOf, spineMemberOf, type SpineGlobalHandleKind } from "./spine-handle-ids.ts";
import { isSpineEdge, spineComponent, spineOwnerOf } from "./spine-owner.ts";

/**
 * Where each spine's global handles stand (ids: `spine-handle-ids.ts`):
 *
 * - pivot: a spiral's centre, or the middle of the control points;
 * - rotate: out beyond the spine, level with the pivot, to turn it round it;
 * - height: above the far end;
 * - turns: on a spiral, just past the far end, carrying on round the centre.
 *
 * Every kind is listed here for every spine; which a spine actually shows
 * is its owner's declaration, filtered by whoever shows them.
 */

/** How far from the far end its handles stand, so they never sit on the end point itself. */
const END_REACH = 1.2;
/** How far past the spine's farthest point the rotate handle stands. */
const ROTATE_REACH = 1.5;

export interface SpineGlobalHandle {
  readonly id: string;
  readonly kind: SpineGlobalHandleKind;
  readonly position: ConstructionPosition;
  /** The type the spine generates. */
  readonly owner: string | undefined;
  /** Every control node of the spine, lowest id first. */
  readonly nodeIds: readonly string[];
  readonly edges: readonly ConstructionEdgeSnapshot[];
  /** The spine's free ends, first to last -- the far one is the last. Absent on a branch or a loop. */
  readonly ends?: readonly [string, string];
  /** A spiral's centre. */
  readonly center?: readonly [number, number];
  /** What the spine moves and turns round: where its pivot handle stands. */
  readonly pivot: ConstructionPosition;
}

function handlesOf(graph: ConstructionGraphSnapshot, edges: readonly ConstructionEdgeSnapshot[]): readonly SpineGlobalHandle[] {
  if (edges.length === 0) return [];
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const nodeIds = [...new Set(edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId]))].filter((id) => positions.has(id)).sort();
  if (nodeIds.length === 0) return [];
  const points = nodeIds.map((id) => positions.get(id)!);
  const mean = (axis: "x" | "y" | "z") => points.reduce((sum, p) => sum + p[axis], 0) / points.length;
  const center = sharedArcCenter(edges);
  const chain = openSpineChain(edges);
  const ends = chain && ([chain.nodes[0]!, chain.nodes.at(-1)!] as const);
  const pivot = center ? { x: center[0], y: mean("y"), z: center[1] } : { x: mean("x"), y: mean("y"), z: mean("z") };
  const base = { owner: spineOwnerOf(edges[0]!), nodeIds, edges, pivot, ...(ends ? { ends } : {}), ...(center ? { center } : {}) };
  const name = nodeIds[0]!;
  const reach = Math.max(...points.map((p) => Math.hypot(p.x - pivot.x, p.z - pivot.z))) + ROTATE_REACH;
  const handles: SpineGlobalHandle[] = [
    { ...base, id: spineGlobalHandleId("pivot", name), kind: "pivot", position: pivot },
    { ...base, id: spineGlobalHandleId("rotate", name), kind: "rotate", position: { ...pivot, x: pivot.x + reach } },
  ];
  if (!chain || !ends) return handles;
  const end = positions.get(ends[1])!;
  handles.push({ ...base, id: spineGlobalHandleId("height", name), kind: "height", position: { ...end, y: end.y + END_REACH } });
  if (!center) return handles;
  const before = positions.get(chain.nodes.at(-2)!)!;
  const middle = { x: center[0], z: center[1] };
  const angle = planAngle(middle, end);
  const on = wrapAngle(angle - planAngle(middle, before)) >= 0 ? 1 : -1;
  handles.push({
    ...base, id: spineGlobalHandleId("turns", name), kind: "turns",
    position: { x: end.x - Math.sin(angle) * on * END_REACH, y: end.y, z: end.z + Math.cos(angle) * on * END_REACH },
  });
  return handles;
}

/** Every spine's global handles, of every kind. */
export function spineGlobalHandles(graph: ConstructionGraphSnapshot): readonly SpineGlobalHandle[] {
  const handles: SpineGlobalHandle[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (!edge.curve || !isSpineEdge(edge) || seen.has(edge.edgeId)) continue;
    const component = spineComponent(graph, [edge.startNodeId]).edges.filter((e) => e.curve);
    for (const member of component) seen.add(member.edgeId);
    handles.push(...handlesOf(graph, component));
  }
  return handles;
}

/** The global handle `id` names -- or, for any other handle of a spine, that spine's pivot -- where it stands now. */
export function spineGlobalHandleAt(graph: ConstructionGraphSnapshot, id: string): SpineGlobalHandle | undefined {
  const kind = spineGlobalHandleOf(id)?.kind ?? "pivot";
  const component = spineComponent(graph, [spineMemberOf(graph, id)]).edges.filter((edge) => edge.curve);
  return handlesOf(graph, component).find((handle) => handle.kind === kind);
}

/** A whole-spine transform: turned by `angle` round `pivot` in plan, then moved by `delta`. Either may be absent. */
export interface SpineTransform {
  readonly delta?: ConstructionPosition;
  readonly rotation?: { readonly pivot: PlanPoint; readonly angle: number };
}

/**
 * The graph patch moving and/or turning a whole spine: every control node,
 * every span's handles and every arc centre, so each span keeps its shape.
 * The owner regenerates its surface from it like from any other spine edit.
 */
export function planSpineTransform(graph: ConstructionGraphSnapshot, spine: Pick<SpineGlobalHandle, "nodeIds" | "edges">, transform: SpineTransform): ConstructionGraphPatch {
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const delta = transform.delta ?? { x: 0, y: 0, z: 0 };
  const angle = transform.rotation?.angle ?? 0;
  const place = <P extends PlanPoint>(p: P): P => {
    const turned = transform.rotation ? rotateInPlan(p, transform.rotation.pivot, angle) : p;
    return { ...turned, x: turned.x + delta.x, z: turned.z + delta.z };
  };
  // Only a turn changes handle directions; a move alone changes only arc centres.
  const touched = angle !== 0 ? spine.edges : spine.edges.filter((edge) => edge.curve?.geometry?.kind === "arc");
  return {
    nodes: spine.nodeIds.map((id) => {
      const p = place(positions.get(id)!);
      return { id, position: { ...p, y: p.y + delta.y } };
    }),
    removedEdgeIds: touched.map((edge) => edge.edgeId),
    edges: touched.map((edge) => {
      const curve = edge.curve!;
      const geometry = curve.geometry?.kind === "arc"
        ? { ...curve.geometry, center: (({ x, z }) => [x, z] as const)(place({ x: curve.geometry.center[0], z: curve.geometry.center[1] })) }
        : curve.geometry;
      return {
        ...edge,
        curve: {
          ...curve,
          start: rotateVectorInPlan(curve.start, angle),
          end: rotateVectorInPlan(curve.end, angle),
          ...(geometry ? { geometry } : {}),
        },
      };
    }),
  };
}

export const spinePivots = (graph: ConstructionGraphSnapshot): readonly SpineGlobalHandle[] => spineGlobalHandles(graph).filter((h) => h.kind === "pivot");
export const spinePivotAt = (graph: ConstructionGraphSnapshot, id: string): SpineGlobalHandle | undefined => spineGlobalHandleAt(graph, id);
export const isSpinePivotId = (id: string): boolean => id.startsWith("spine-pivot:");
export const spineEndHandles = (graph: ConstructionGraphSnapshot) => {
  return spineGlobalHandles(graph)
    .filter((h) => h.kind !== "pivot" && h.ends)
    .map((h) => ({
      id: h.id,
      kind: h.kind,
      position: h.position,
      owner: h.owner,
      startNodeId: h.ends![0],
      endNodeId: h.ends![1],
      center: h.kind === "turns" ? h.center : undefined,
    }));
};
export const spineEndHandleAt = (graph: ConstructionGraphSnapshot, id: string): SpineGlobalHandle | undefined => spineGlobalHandleAt(graph, id);
export const spineEndHandleId = (kind: "height" | "turns", nodeId: string): string => spineGlobalHandleId(kind, nodeId);
export const spineEndHandleOf = (id: string) => spineGlobalHandleOf(id);
