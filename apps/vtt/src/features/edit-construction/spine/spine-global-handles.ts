import type { ConstructionEdgeSnapshot, ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionPosition } from "@/ports";

import { planAngle, rotateInPlan, rotateVectorInPlan, wrapAngle, type PlanPoint } from "../topology/plan-rotation.ts";
import { openSpineChain, sharedArcCenter } from "./spine-open-chain.ts";
import type { GlobalHandle } from "../global-handles/global-handle.ts";
import { spineGlobalHandleId, spineGlobalHandleOf, spineMemberOf } from "./spine-handle-ids.ts";
import { isSpineEdge, spineComponent, spineOwnerOf } from "./spine-owner.ts";

/**
 * Where each spine's global handles stand (ids: `spine-handle-ids.ts`):
 *
 * - pivot: a spiral's centre, or the middle of the control points;
 * - rotate: out beyond the spine, level with the pivot, to turn it round it;
 * - height: above the middle, raising the whole spine;
 * - originHeight, destinationHeight: above each end, raising that end alone;
 * - turns: on a spiral, just past the far end, carrying on round the centre.
 *
 * Every kind is listed here for every spine; which a spine actually shows
 * is its owner's declaration, filtered by whoever shows them.
 */

/** How far from the far end its handles stand, so they never sit on the end point itself. */
const END_REACH = 1.2;
/** How far past the structure's farthest point the rotate handle stands. */
export const ROTATE_REACH = 1.5;
/** Where an end's tilt handle stands: on past `end`, away from its neighbour `inner`, a little above it. */
function tiltAt(end: ConstructionPosition, inner: ConstructionPosition): ConstructionPosition {
  const span = Math.hypot(end.x - inner.x, end.z - inner.z) || 1;
  return { x: end.x + ((end.x - inner.x) / span) * TILT_OUT, y: end.y + TILT_UP, z: end.z + ((end.z - inner.z) / span) * TILT_OUT };
}
const TILT_OUT = 1;
const TILT_UP = 0.5;

/** How far above a spiral's rim its radius handle floats, clear of the surface. */
const RIM_LIFT = 0.3;

/**
 * `reach` out from `pivot` towards `toward`, level with the pivot -- where a
 * rotate handle stands, so that turning the structure turns the handle with
 * it. Straight out along +X when `toward` is the pivot itself.
 */
export function outward(pivot: ConstructionPosition, toward: ConstructionPosition, reach: number): ConstructionPosition {
  const dx = toward.x - pivot.x, dz = toward.z - pivot.z;
  const length = Math.hypot(dx, dz);
  return length < 1e-9 ? { ...pivot, x: pivot.x + reach } : { ...pivot, x: pivot.x + (dx / length) * reach, z: pivot.z + (dz / length) * reach };
}

/** A global handle placed by a spine: the generic handle, with the spine it stands for. */
export interface SpineGlobalHandle extends GlobalHandle {
  readonly edges: readonly ConstructionEdgeSnapshot[];
  /** The spine's free ends, first to last -- the far one is the last. Absent on a branch or a loop. */
  readonly ends?: readonly [string, string];
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
  const owner = spineOwnerOf(edges[0]!);
  if (owner === undefined) return [];
  const base = { owner, provider: "spine", nodeIds, edges, pivot, ...(ends ? { ends } : {}), ...(center ? { center } : {}) };
  const name = nodeIds[0]!;
  const reach = Math.max(...points.map((p) => Math.hypot(p.x - pivot.x, p.z - pivot.z))) + ROTATE_REACH;
  const handles: SpineGlobalHandle[] = [
    { ...base, id: spineGlobalHandleId("pivot", name), kind: "pivot", position: pivot, motion: { kind: "free" } },
    { ...base, id: spineGlobalHandleId("rotate", name), kind: "rotate", position: outward(pivot, positions.get(name)!, reach), motion: { kind: "orbit", center: pivot } },
  ];
  if (!chain || !ends) return handles;
  const end = positions.get(ends[1])!;
  const first = positions.get(ends[0])!;
  handles.push(
    // Above the middle: the whole spine up or down.
    { ...base, id: spineGlobalHandleId("height", name), kind: "height", position: { ...pivot, y: pivot.y + END_REACH }, motion: { kind: "vertical" } },
    // On past each end: that end alone -- how steeply the spine climbs.
    { ...base, id: spineGlobalHandleId("originHeight", name), kind: "originHeight", position: tiltAt(first, positions.get(chain.nodes[1]!)!), motion: { kind: "vertical" } },
    { ...base, id: spineGlobalHandleId("destinationHeight", name), kind: "destinationHeight", position: tiltAt(end, positions.get(chain.nodes.at(-2)!)!), motion: { kind: "vertical" } },
  );
  if (!center) return handles;
  const before = positions.get(chain.nodes.at(-2)!)!;
  const middle = { x: center[0], z: center[1] };
  const angle = planAngle(middle, end);
  const on = wrapAngle(angle - planAngle(middle, before)) >= 0 ? 1 : -1;
  handles.push({
    ...base, id: spineGlobalHandleId("turns", name), kind: "turns", motion: { kind: "orbit", center: middle },
    position: { x: end.x - Math.sin(angle) * on * END_REACH, y: end.y, z: end.z + Math.cos(angle) * on * END_REACH },
  });
  // On the rim, halfway along the spiral: pushed out or in along its own radius.
  const halfway = positions.get(chain.nodes[Math.floor(chain.nodes.length / 2)]!)!;
  const radial = planAngle(middle, halfway);
  const out = { x: Math.cos(radial), z: Math.sin(radial) };
  const rim = Math.hypot(halfway.x - middle.x, halfway.z - middle.z);
  handles.push({
    ...base, id: spineGlobalHandleId("radius", name), kind: "radius", motion: { kind: "line", direction: out },
    position: { x: middle.x + out.x * rim, y: halfway.y + RIM_LIFT, z: middle.z + out.z * rim },
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
