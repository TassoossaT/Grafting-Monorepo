/**
 * What happens when one structure type is painted over another.
 *
 * Creation and editing are two faces of the same coin: a type declares what
 * its own parts allow (the role table) *and* how it meets every other type.
 * Neither half lives in Rust -- the engine answers "what is already here"
 * (`getFootprintCoverage`) and performs primitives; which of them to run is
 * this table's call.
 *
 * **The relation is directional, and that is the point.** A wall goes on top
 * of terrain; terrain does not go on top of a wall. Declaring one direction
 * says nothing about the other, so both are declared separately rather than
 * inferred from a symmetric "compatible" flag.
 */
export type CreationInteraction =
  /**
   * Paint on top and leave the covered region alone -- they coexist. A wall
   * standing on terrain neither consumes nor is consumed by it.
   */
  | { readonly kind: "ignore" }
  /**
   * Consume what is covered, carving the new shape out of it: the covered
   * region is destroyed and its leftover kept with the new shape as a hole.
   * A path cut through terrain, and a path crossing a wall -- which reads as
   * an opening in that wall.
   *
   * Declaring `cut` says a type *may* cut; where it does is the ground
   * contact law (`topology/ground-contact.ts`): only where the structure
   * rests on the ground, and, partly clear of it, only where the ground rises
   * through it.
   *
   * **Calibration is global for now, and is meant to become per type and per
   * interaction.** Every cutting type reads the same constants -- how far
   * above the ground a structure still rests, the tolerance where the ground
   * rises through it, how finely contact is sampled. A later pass lets each
   * type -- and each operation, creation or edit -- carry its own values
   * here, so a road and a platform meet the ground differently. Until then
   * no type overrides them; they are to be moved into the VTT's global
   * calibration menu first.
   */
  | { readonly kind: "cut" }
  /**
   * Delete the covered faces, generate the new ones above them, and stitch
   * the result back onto the rim the removal exposed. Terrain painted over
   * terrain raises it rather than stacking a second copy on top.
   */
  | { readonly kind: "restack" }
  /**
   * Refuse outright. Terrain cannot be brought into being above another
   * structure -- there is no meaning to assign, so nothing is generated and
   * the caller reports why.
   */
  | { readonly kind: "forbid"; readonly reason: string };

export type CreationInteractionKind = CreationInteraction["kind"];

export const IGNORE: CreationInteraction = Object.freeze({ kind: "ignore" });
export const CUT: CreationInteraction = Object.freeze({ kind: "cut" });
export const RESTACK: CreationInteraction = Object.freeze({ kind: "restack" });

export function forbid(reason: string): CreationInteraction {
  return Object.freeze({ kind: "forbid", reason });
}
