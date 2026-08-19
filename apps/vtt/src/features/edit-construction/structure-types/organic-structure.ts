import type { EditTarget } from "../atomic-edit.ts";
import { HORIZONTAL_AXES } from "../atomic-edit.ts";
import type { EditRole, RolePolicy, StructureTypeDefinition } from "./structure-type.ts";
import { allowed, denied } from "./structure-type.ts";

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
      case ORGANIC_ROLES.body:
        return allowed(role, HORIZONTAL_AXES);
      default:
        return structural === "regenerate"
          ? {
              role,
              resolve: {
                kind: "regenerate",
                reason: "an organic region has no fixed roles; editing it means generating it again",
              },
              axes: [],
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
): StructureTypeDefinition {
  return Object.freeze({
    surfaceType,
    label,
    creation,
    roleFor: organicRoleFor,
    policyFor: organicPolicyFactory(structural),
  });
}
