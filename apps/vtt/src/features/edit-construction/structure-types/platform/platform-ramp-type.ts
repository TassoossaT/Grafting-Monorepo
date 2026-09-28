import { IGNORE } from "../creation-interaction.ts";
import type { StructureTypeDefinition } from "../structure-type.ts";
import { deriveRampMotion, RAMP_SURFACE_TYPE, rampPolicyFor, rampRoleFor, validateRampMotion } from "./platform-ramp.ts";
import { rampEndsCapability } from "./platform-ramp-plan.ts";

/** The straight ramp's definition: edited by its corners, sides, ends and body, never carving the ground. */
export const rampStructureType: StructureTypeDefinition = Object.freeze<StructureTypeDefinition>({
  surfaceType: RAMP_SURFACE_TYPE, label: "Rampa",
  globalHandles: Object.freeze(["pivot", "rotate", "height", "origin", "destination", "originHeight", "destinationHeight", "side", "corner", "detach"] as const),
  // Its long sides widen it; a corner widens or narrows its own end alone --
  // how the ramp opens or closes; its ends are the origin and destination handles'.
  partHandle: (role) => role === "ramp-side" || role === "ramp-corner",
  ends: rampEndsCapability,
  creation: "a symmetric trapezoid on an inclined plane: an axis and a width at each end",
  traits: Object.freeze([]),
  requiresMotionSolver: true,
  roleFor: rampRoleFor,
  policyFor: rampPolicyFor,
  // A ramp climbs between levels above the ground; it never carves it.
  interactionOver: () => IGNORE,
  deriveMotion: deriveRampMotion,
  validateMotion: validateRampMotion,
});
