import { floorLandingNear, hasTrait, type FloorLanding } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology } from "../../../../ports/index.ts";
import { pointerAtHeight } from "./pointer-ray.ts";
import type { PointerSample, ToolContext } from "./tool-context.ts";

/**
 * Where a pointer lands on a floor's edge -- the pointer half of
 * `topology/floor-weld.ts`, which holds the rule itself.
 */

/** Every floor on the table -- anything whose type carries the `floor` trait. */
export function floorsOf(ctx: ToolContext): readonly ConstructionRegionTopology[] {
  return ctx.runtime.getAllRegionTopologies().filter((topology) => hasTrait(topology.surfaceType, "floor"));
}

/** The floor the pointer is on, if any. */
export function floorUnder(floors: readonly ConstructionRegionTopology[], sample: PointerSample): ConstructionRegionTopology | undefined {
  return floors.find((topology) => sample.surfaceRef
    ? surfaceRefFromNodeSet(topology.surfaceKey) === sample.surfaceRef
    : sample.nodeId !== undefined && topology.nodes.some((node) => node.id === sample.nodeId));
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
