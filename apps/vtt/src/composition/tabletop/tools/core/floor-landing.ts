import { floorLandingNear, hasTrait, insideFace, nearestOnSegment, type FloorLanding } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionNodeId, ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "../../../../ports/index.ts";
import { pointerAtHeight } from "./pointer-ray.ts";
import { graphNodeOf } from "./node-identity.ts";
import type { PointerSample, ToolContext } from "./tool-context.ts";

/**
 * Where a pointer or a point lands on a floor -- anything whose type carries
 * the `floor` trait: on its edge (the pointer half of `topology/floor-weld.ts`,
 * which holds the rule itself), on its level, at one of its nodes, partway
 * along one of its sides. Any tool building on floors asks here.
 */

/** Every floor on the table -- anything whose type carries the `floor` trait. */
export function floorsOf(ctx: ToolContext): readonly ConstructionRegionTopology[] {
  return ctx.runtime.getAllRegionTopologies().filter((topology) => hasTrait(topology.surfaceType, "floor"));
}

/** The floor the pointer is on, if any. */
export function floorUnder(floors: readonly ConstructionRegionTopology[], sample: PointerSample): ConstructionRegionTopology | undefined {
  return floors.find((topology) => sample.surfaceRef
    ? surfaceRefFromNodeSet(topology.surfaceKey) === sample.surfaceRef
    : graphNodeOf(sample) !== undefined && topology.nodes.some((node) => node.id === graphNodeOf(sample)));
}

/**
 * The floor edge `sample` lands on, preferring the floor the pointer is on.
 * Each floor is tried where the pointer's ray crosses that floor's own
 * level, so aiming at a raised floor's edge from off it lands there, not
 * wherever the ray met the ground behind it.
 */
export function floorLandingAt(floors: readonly ConstructionRegionTopology[], sample: PointerSample): FloorLanding | undefined {
  const under = floorUnder(floors, sample);
  if (under) {
    const landing = floorLandingNear([under], sample.point, { under: under.surfaceKey });
    if (landing) return landing;
  }
  let best: { landing: FloorLanding; distance: number } | undefined;
  for (const floor of floors) {
    const height = floor.nodes[0]?.position.y;
    if (height === undefined) continue;
    const aimed = sample.ray ? pointerAtHeight(sample, height) : sample.point;
    const landing = floorLandingNear([floor], aimed);
    if (!landing) continue;
    const distance = Math.hypot(landing.point.x - aimed.x, landing.point.z - aimed.z) + Math.abs(height - sample.point.y) * (sample.ray ? 0 : 0.1);
    if (!best || distance < best.distance) best = { landing, distance };
  }
  return best?.landing;
}

/**
 * The floor edge `sample` lands on, as above -- or, when the pointer is on a
 * floor but nowhere near its edge, the edge a straight line from `from`
 * crosses to reach it: a ramp drawn from the ground onto a floor stops at
 * the floor's edge and joins it there, wherever on the floor it was dropped.
 */
export function floorLandingToward(floors: readonly ConstructionRegionTopology[], sample: PointerSample, from: ConstructionPosition | undefined): FloorLanding | undefined {
  const near = floorLandingAt(floors, sample);
  if (near || !from) return near;
  const floor = floorUnder(floors, sample);
  if (!floor) return undefined;
  const height = floor.nodes[0]!.position.y;
  const to = sample.ray ? pointerAtHeight(sample, height) : sample.point;
  const at = new Map(floor.nodes.map((node) => [node.id, node.position]));
  let first: { t: number; x: number; z: number } | undefined;
  for (const use of floor.outerLoops.flat()) {
    for (const [a, b] of edgePieces(use, at)) {
      // Where from->to crosses a->b, as a share of from->to.
      const d = { x: to.x - from.x, z: to.z - from.z }, e = { x: b.x - a.x, z: b.z - a.z };
      const det = d.x * e.z - d.z * e.x;
      if (Math.abs(det) < 1e-12) continue;
      const t = ((a.x - from.x) * e.z - (a.z - from.z) * e.x) / det;
      const u = ((a.x - from.x) * d.z - (a.z - from.z) * d.x) / det;
      if (t < 0 || t > 1 || u < 0 || u > 1 || (first && first.t <= t)) continue;
      first = { t, x: from.x + d.x * t, z: from.z + d.z * t };
    }
  }
  return first && floorLandingNear([floor], { x: first.x, y: height, z: first.z }, { reach: 0.2 });
}

/** An outline edge as straight pieces in plan: itself, or a curved one followed closely. */
function edgePieces(use: ConstructionRegionTopology["outerLoops"][number][number], at: ReadonlyMap<string, ConstructionPosition>): readonly (readonly [ConstructionPosition, ConstructionPosition])[] {
  const a = at.get(use.startNodeId)!, b = at.get(use.endNodeId)!;
  if (use.geometry.kind !== "arc") return [[a, b]];
  const [cx, cz] = use.geometry.center;
  const radius = Math.hypot(a.x - cx, a.z - cz);
  const from = Math.atan2(a.z - cz, a.x - cx), to = Math.atan2(b.z - cz, b.x - cx);
  const turn = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sweep = use.geometry.clockwise ? -(turn(from - to) || 2 * Math.PI) : (turn(to - from) || 2 * Math.PI);
  const steps = 24;
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const angle = from + (sweep * i) / steps;
    return { x: cx + Math.cos(angle) * radius, y: a.y, z: cz + Math.sin(angle) * radius };
  });
  return points.slice(1).map((p, i) => [points[i]!, p] as const);
}

/**
 * The closest floor node within `reach` in plan, at `position`'s own
 * elevation (within `levelTolerance`) -- a magnet, never a floor of another
 * storey merely because it lies below in plan.
 */
export function nearestFloorNode(
  ctx: ToolContext,
  position: ConstructionPosition,
  reach: number,
  levelTolerance: number,
): { readonly node: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }; readonly distance: number } | undefined {
  let best: { readonly node: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }; readonly distance: number } | undefined;
  for (const floor of floorsOf(ctx)) {
    for (const node of floor.nodes) {
      if (Math.abs(node.position.y - position.y) > levelTolerance) continue;
      const distance = Math.hypot(node.position.x - position.x, node.position.z - position.z);
      if (distance > reach) continue;
      if (best === undefined || distance < best.distance) best = { node, distance };
    }
  }
  return best;
}

/**
 * Where the pointer is on a floor's level: on a floor it is over, or within
 * `edgeReach` of the edge of, exactly at that floor's height -- read along
 * the pointer's ray, never whatever the renderer's pick met first (the
 * ground below a raised floor's edge, something standing in front) nor its
 * sub-centimetre noise. Anywhere else, where it hit. Of several floors, the
 * one the ray meets first.
 */
export function onFloorLevel(ctx: ToolContext, sample: PointerSample, edgeReach: number): ConstructionPosition {
  let best: { readonly point: ConstructionPosition; readonly y: number } | undefined;
  for (const floor of floorsOf(ctx)) {
    const y = floor.nodes[0]?.position.y;
    if (y === undefined || floor.nodes.some((node) => Math.abs(node.position.y - y) > 1e-6)) continue;
    const point = sample.ray ? pointerAtHeight(sample, y) : { ...sample.point, y };
    if (!sample.ray && Math.abs(sample.point.y - y) > 0.25) continue;
    const at = new Map(floor.nodes.map((node) => [node.id, node.position]));
    const near = Math.min(...floor.outerLoops.flat().map((use) => nearestOnSegment(point, at.get(use.startNodeId)!, at.get(use.endNodeId)!).distance));
    if (!insideFace(floor, point) && near > edgeReach) continue;
    // The ray meets the higher floor first.
    if (!best || y > best.y) best = { point, y };
  }
  return best?.point ?? sample.point;
}

/**
 * The straight floor side at `point`'s height (within `levelTolerance`) that
 * `point` lands on -- within `reach`, and more than `cornerClearance` from
 * either corner -- with the point moved onto it: where something joins the
 * floor partway along its outline.
 */
export function floorSideAt(
  ctx: ToolContext,
  point: ConstructionPosition,
  reach: number,
  cornerClearance: number,
  levelTolerance: number,
): { readonly point: ConstructionPosition; readonly floor: ConstructionSurfaceKey } | undefined {
  let best: { readonly point: ConstructionPosition; readonly floor: ConstructionSurfaceKey; readonly off: number } | undefined;
  for (const floor of floorsOf(ctx)) {
    const at = new Map(floor.nodes.map((node) => [node.id, node.position]));
    for (const use of [...floor.outerLoops, ...floor.holes].flat()) {
      if (use.geometry.kind !== "line") continue;
      const a = at.get(use.startNodeId)!, b = at.get(use.endNodeId)!;
      if (Math.abs(a.y - point.y) > levelTolerance || Math.abs(b.y - point.y) > levelTolerance) continue;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-6) continue;
      const { t, distance, x, z } = nearestOnSegment(point, a, b);
      if (distance > reach || t * length <= cornerClearance || (1 - t) * length <= cornerClearance) continue;
      if (best === undefined || distance < best.off) best = { point: { x, y: a.y + (b.y - a.y) * t, z }, floor: floor.surfaceKey, off: distance };
    }
  }
  return best && { point: best.point, floor: best.floor };
}
