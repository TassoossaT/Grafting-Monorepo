import { cutsGround } from "../platform/platform-structure.ts";
import { denied, type StructureTypeDefinition } from "../structure-type.ts";

/** The surface type of ground a shape made: the inside of a tunnel or cave, the body of an earth bridge. */
export const SOLID_GROUND_SURFACE_TYPE = "solid-ground";

/**
 * Ground a shape made -- a tunnel's ceiling, walls and floor, the hill over
 * it, an earth bridge's deck and belly -- laid from a height field plus the
 * shapes that carve or fill it (`grafting-procgen-solid-field`).
 *
 * To everything planar it is a sealed structure standing in the ground, the
 * way a floor is: the ground under open sky is cut round it by the ground's
 * own regeneration and meets its outline at its height without splitting it.
 * That is what lets terrain stay a height over the plane everywhere else --
 * the brush, flattening and every cut keep working unchanged -- while this
 * holds the stretches that are ground over ground.
 *
 * Not `"ground"` itself: the planar machinery would regenerate it as a height
 * over the plane and flatten the cave it is. Its faces are re-laid from their
 * shapes, never grabbed: the terrain brush's tunnel and bridge strokes add to
 * them.
 */
export const solidGroundStructureType: StructureTypeDefinition = Object.freeze<StructureTypeDefinition>({
  surfaceType: SOLID_GROUND_SURFACE_TYPE,
  label: "Terreno escavado",
  creation: "every piece of the surface a shape made, each a height over a plane of its own, laid by the irregular quad grid",
  traits: Object.freeze([]),
  rigid: true,
  sealedOutline: true,
  interactionOver: cutsGround,
  roleFor: () => "solid-ground-face",
  policyFor: (role) => denied(role, "Edite o túnel, a caverna ou a ponte com o pincel de terreno."),
});
