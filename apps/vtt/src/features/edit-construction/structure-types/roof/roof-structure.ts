import { ALL_AXES } from "../../orchestration/atomic-edit.ts";
import { IGNORE } from "../creation-interaction.ts";
import { allowed, denied, type StructureTypeDefinition } from "../structure-type.ts";
import { roofRecipeGeneration } from "./roof-recipe.ts";

/**
 * A roof is regenerated whole from the recipe its faces keep: every handle
 * -- its rise, a side's slope, a seam, a footprint corner, a corner pulled
 * out of a side, a dormer -- edits the recipe (`roof-recipe.ts`). How far
 * its eaves reach and whether its leaves curve are the covering's business.
 */
export const roofStructureType: StructureTypeDefinition = Object.freeze<StructureTypeDefinition>({
  surfaceType: "roof", label: "Telhado", creation: "the weighted straight skeleton of its footprint, welded to what it stands on",
  // Its upright faces -- gables, a dormer's front -- take windows like any wall.
  traits: Object.freeze(["accepts-cuts"] as const),
  roleFor: (_topology, target) => `roof-${target.kind}`,
  policyFor: (role) => role === "roof-region"
    ? { ...allowed(role, ALL_AXES, "cloud"), transport: true }
    : denied(role, "Mova o telhado pela face."),
  interactionOver: () => IGNORE,
  recipe: roofRecipeGeneration,
  // Stood on a floor or a room, it is made again over it whenever that changes.
  reactions: Object.freeze({ reshape: "follow-base" } as const),
  // Its nodes never drag one another: welded to a floor, a side of it pushed
  // must reshape the floor, not carry the roof -- and the floor with it --
  // whole. The roof is made again over what it stands on instead.
  globalHandles: Object.freeze(["pivot", "rotate", "rise", "slope", "seam", "side", "corner", "insert"] as const),
});
