import { floorLandingNear, hasTrait, type FloorLanding } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionRegionTopology } from "../../../../ports/index.ts";
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
