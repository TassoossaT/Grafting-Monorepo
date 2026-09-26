import { floorLandingNear, hasTrait, type FloorLanding } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionRegionTopology } from "../../../../ports/index.ts";
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

/** The floor edge `sample` lands on, preferring the floor the pointer is on. */
export function floorLandingAt(floors: readonly ConstructionRegionTopology[], sample: PointerSample): FloorLanding | undefined {
  const under = floorUnder(floors, sample)?.surfaceKey;
  return floorLandingNear(floors, sample.point, under ? { under } : {});
}
