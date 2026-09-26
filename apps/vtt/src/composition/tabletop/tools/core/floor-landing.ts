import { hasTrait } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition, ConstructionRegionEdge, ConstructionRegionTopology } from "../../../../ports/index.ts";
import type { PointerSample, ToolContext } from "./tool-context.ts";

/** How far in plan from a floor's edge a pointer still lands on it -- either side of the edge. */
export const LANDING_REACH = 0.75;

/** Plan direction. */
export interface PlanDirection {
  readonly x: number;
  readonly z: number;
}

/**
 * Where a structure drawn off a floor meets it: one straight edge of the
 * floor's outline, the point on it nearest the pointer, at the floor's own
 * height, and the direction square to the edge pointing off the floor.
 */
export interface FloorLanding {
  readonly topology: ConstructionRegionTopology;
  readonly use: ConstructionRegionEdge;
  readonly a: ConstructionPosition;
  readonly b: ConstructionPosition;
  readonly point: ConstructionPosition;
  readonly out: PlanDirection;
  readonly height: number;
}

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

/** Twice the signed area of a loop in plan -- its winding. */
function signedArea(points: readonly ConstructionPosition[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!, q = points[(i + 1) % points.length]!;
    area += p.x * q.z - q.x * p.z;
  }
  return area;
}

/**
 * The floor edge `sample` lands on: a straight edge of a floor's outer
 * outline within `reach` of the pointer in plan, whether the pointer is on
 * the floor or just off it. The floor the pointer is on wins; otherwise the
 * nearest edge does, and among edges stacked in plan -- storeys -- the one
 * nearest the height the pointer touched.
 */
export function floorLandingAt(floors: readonly ConstructionRegionTopology[], sample: PointerSample, reach = LANDING_REACH): FloorLanding | undefined {
  const under = floorUnder(floors, sample);
  const p = sample.point;
  let best: { landing: FloorLanding; score: number } | undefined;
  for (const topology of floors) {
    const positions = new Map(topology.nodes.map((node) => [node.id, node.position]));
    const outer = topology.outerLoops[0] ?? [];
    // The outline's winding says which side of each edge is off the floor.
    const winding = Math.sign(signedArea(outer.map((use) => positions.get(use.startNodeId)!))) || 1;
    for (const use of topology.outerLoops.flat()) {
      if (use.geometry.kind !== "line") continue;
      const a = positions.get(use.startNodeId)!, b = positions.get(use.endNodeId)!;
      const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
      const height = a.y;
      const point = { x: a.x + dx * t, y: height, z: a.z + dz * t };
      const distance = Math.hypot(point.x - p.x, point.z - p.z);
      if (distance > reach) continue;
      const length = Math.sqrt(lengthSq);
      // Counter-clockwise outline (positive area): the right-hand normal points out.
      const out = { x: (dz / length) * winding, z: (-dx / length) * winding };
      const score = (topology === under ? 0 : 1000) + distance + Math.abs(height - p.y) * 0.1;
      if (best && best.score <= score) continue;
      best = { landing: { topology, use, a, b, point, out, height }, score };
    }
  }
  return best?.landing;
}

/** How far along `landing`'s edge, in length units, `point` stands. */
export function alongEdge(landing: Pick<FloorLanding, "a" | "b">, point: PlanDirection): number {
  const dx = landing.b.x - landing.a.x, dz = landing.b.z - landing.a.z;
  return ((point.x - landing.a.x) * dx + (point.z - landing.a.z) * dz) / Math.hypot(dx, dz);
}
