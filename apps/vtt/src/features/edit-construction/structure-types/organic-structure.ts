import type { EditTarget } from "../atomic-edit.ts";
import { HORIZONTAL_AXES } from "../atomic-edit.ts";
import type { EditRole, RolePolicy, StructureTypeDefinition } from "./structure-type.ts";
import { allowed, denied } from "./structure-type.ts";
import { CUT, IGNORE, RESTACK, forbid, type CreationInteraction } from "./creation-interaction.ts";

/**
 * The role model for a procedurally generated, non-enumerable boundary --
 * terrain sculpted from a noise lattice, a path swept by a brush. There is
 * no "this vertex is always the corner" to assign, because generation never
 * promised one: the vertex count and layout follow the stroke, not a fixed
 * shape this side requested.
 *
 * Consequences, straight from
 * `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`: the table
 * is near-empty on purpose. Anything structural (subdividing, welding,
 * cutting) escalates to a whole-region regeneration rather than a sequence
 * of primitives, because no atomic sequence can express "re-roll this
 * terrain." What *is* role-independent -- sliding a boundary vertex, edge,
 * or the whole patch around -- stays allowed, since it needs no knowledge of
 * what the vertex means.
 */

export const ORGANIC_ROLES = {
  boundaryVertex: "organic-boundary-vertex",
  boundaryEdge: "organic-boundary-edge",
  body: "organic-body",
} as const;

export function organicRoleFor(_topology: unknown, target: EditTarget): EditRole {
  if (target.kind === "vertex") return ORGANIC_ROLES.boundaryVertex;
  if (target.kind === "edge") return ORGANIC_ROLES.boundaryEdge;
  return ORGANIC_ROLES.body;
}

/**
 * @param structural Whether structural edits escalate to regeneration
 * (terrain) or are simply refused (a flat swept path, which has nothing to
 * regenerate from a single gesture).
 */
export function organicPolicyFactory(structural: "regenerate" | "deny") {
  return function organicPolicyFor(role: EditRole): RolePolicy {
    switch (role) {
      case ORGANIC_ROLES.boundaryVertex:
      case ORGANIC_ROLES.boundaryEdge:
        return allowed(role, HORIZONTAL_AXES, "surface");
      case ORGANIC_ROLES.body:
        // Sliding "the ground" means the patch, and a patch is however many
        // faces a stroke left welded together -- a terrain sweep is one
        // lattice of many faces, not one face. Moving the clicked face
        // alone would tear it out of its own lattice, which is the one
        // thing an organic boundary cannot survive.
        return allowed(role, HORIZONTAL_AXES, "cloud");
      default:
        return structural === "regenerate"
          ? {
              role,
              resolve: {
                kind: "regenerate",
                reason: "an organic region has no fixed roles; editing it means generating it again",
              },
              axes: [],
              // What gets regenerated is the cloud: a re-roll of one face
              // out of a lattice would leave its neighbours describing a
              // boundary that no longer exists.
              scope: "cloud" as const,
            }
          : denied(role, "this region has no editing role for that part");
    }
  };
}

export function organicStructureType(
  surfaceType: string,
  label: string,
  creation: string,
  structural: "regenerate" | "deny",
  interactionOver: (coveredType: string, paintedSubtype?: string) => CreationInteraction,
): StructureTypeDefinition {
  return Object.freeze({
    surfaceType,
    label,
    creation,
    roleFor: organicRoleFor,
    policyFor: organicPolicyFactory(structural),
    interactionOver,
  });
}

/** Surface types that are themselves ground -- what terrain may restack onto. */
const TERRAIN_TYPES = new Set(["terrain", "terrain-grass"]);

/**
 * Terrain painted over terrain **raises** it: the covered faces are deleted,
 * the new ones generated above, and the result stitched back onto the rim
 * the removal exposed. It does not overlay a second lattice on top of the
 * first, which is what used to stack geometry on every stroke.
 *
 * Terrain over anything else is refused. Ground is not something that can
 * come into being above a wall or a path -- there is no meaning to assign,
 * so nothing is generated and the caller says why. This is the direction
 * that does *not* mirror: a wall over terrain is perfectly ordinary.
 */
export function terrainInteractionOver(coveredType: string): CreationInteraction {
  if (TERRAIN_TYPES.has(coveredType)) return RESTACK;
  return forbid(`terrain cannot be created above "${coveredType}"`);
}

/**
 * A path **carves**: it consumes what it crosses and keeps the leftover with
 * the path's own shape cut out of it. Over terrain that is a road; over a
 * wall the same cut reads as an opening through it.
 *
 * Over another path the two formations become one connected path surface:
 * the same cut-and-refill flow consumes the overlap instead of leaving
 * coincident path geometry behind.
 *
 * Except a deck, which spans rather than carves. That is a declared property
 * of the subtype, not something read back from geometry -- which is exactly
 * why an overpass needs no height-aware coverage query to be told apart from
 * a crossing at the same level. The run that passes over says so.
 */
export function pathInteractionOver(
  _coveredType: string,
  paintedSubtype?: string,
): CreationInteraction {
  return paintedSubtype === "bridge" ? IGNORE : CUT;
}
