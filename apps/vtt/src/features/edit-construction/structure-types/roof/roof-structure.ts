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
  surfaceType: "roof", label: "Telhado", creation: "analytic sheets with one horizontal base and maximum height",
  // Its upright faces -- gables, a dormer's front -- take windows like any wall.
  traits: Object.freeze(["accepts-cuts"] as const),
  roleFor: (_topology, target) => `roof-${target.kind}`,
  policyFor: (role) => role === "roof-region"
    ? { ...allowed(role, ALL_AXES, "cloud"), transport: true }
    : denied(role, "Mova o telhado pela face."),
  interactionOver: () => IGNORE,
  recipe: roofRecipeGeneration,
  globalHandles: Object.freeze(["pivot", "rotate", "rise", "slope", "seam", "side", "corner", "insert"] as const),
  motionInfluences: (topology) => {
    const anchor = topology.nodes[0];
    return anchor ? topology.nodes.slice(1).flatMap((node) => [
      { from: anchor.id, to: node.id, axes: [true, true, true] as const },
      { from: node.id, to: anchor.id, axes: [true, true, true] as const },
    ]) : [];
  },
});
