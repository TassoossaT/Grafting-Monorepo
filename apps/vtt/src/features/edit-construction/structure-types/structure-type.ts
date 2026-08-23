import type { ConstructionRegionTopology } from "@/ports";

import type { AtomicEditOp, EditAxis, EditGesture, EditTarget } from "../atomic-edit.ts";
import type { CloudTopology } from "../construction-cloud.ts";
import type { CreationInteraction } from "./creation-interaction.ts";

/**
 * A role is this app's own name for "what a particular node/edge of a
 * generated shape means" -- `"wall-bottom-corner"`, `"tower-rim-edge"`.
 * Deliberately a plain string: the engine never sees one, never returns one,
 * and never validates one. Each structure-type file mints its own.
 */
export type EditRole = string;

/** What a role's policy allows a gesture to do. */
export type EditResolution =
  /** Apply the op as computed, subject to `axes`. */
  | { readonly kind: "allow" }
  /** Refuse the gesture outright; nothing reaches the engine. */
  | { readonly kind: "deny"; readonly reason: string }
  /**
   * Escalate to a whole-region regeneration instead of an atomic op -- the
   * organic case. Terrain has no meaningful fixed "this vertex is always the
   * corner," so a terrain "edit" is a fresh generation call replacing the
   * region, not a sequence of primitives.
   */
  | { readonly kind: "regenerate"; readonly reason: string };

/**
 * How far a gesture on this role reaches.
 *
 * `ADR-0022` settles the default: the cloud is what editing operates on,
 * never a face in isolation. A role is `"surface"` only where the grabbed
 * part genuinely belongs to one face and to no other -- a panel's own
 * corner is that panel's corner, and moving it moves whatever else happens
 * to reference the node, which is a consequence of the graph rather than a
 * scope decision. `"cloud"` is for the roles that name the *whole thing*:
 * grabbing a wall's body means the wall, not the one panel under the
 * pointer.
 */
export type EditScope = "surface" | "cloud";

/**
 * One role's complete editing policy: what it allows, how far it reaches,
 * what constrains the op's own parameter, and what else fires in the same
 * transaction.
 */
export interface RolePolicy {
  readonly role: EditRole;
  readonly resolve: EditResolution;
  /** Axes the gesture's delta survives on. Ignored when `resolve` is not `"allow"`. */
  readonly axes: readonly EditAxis[];
  /**
   * Whether the op applies to the grabbed face alone or to every member of
   * its cloud. Declared per role rather than defaulted, so a new structure
   * type states its reach on purpose instead of inheriting whichever answer
   * happened to be cheaper -- the same posture the axes list already takes.
   */
  readonly scope: EditScope;
  /**
   * Extra ops fired alongside the primary one, as one transaction -- e.g.
   * moving a wall's bottom corner moves its paired top corner by the *same*
   * delta. Same-delta cascades are all this model needs so far; there is no
   * scaled or cross-axis variant.
   */
  readonly cascade?: (context: CascadeContext) => readonly AtomicEditOp[];
}

/**
 * What a cascade gets to look at when deriving its extra ops.
 *
 * The whole cloud, not only the grabbed face: a cascade exists precisely to
 * reach parts the gesture never named, and a panel welded onto a neighbour
 * shares its column with that neighbour. Reading one face would make the
 * answer depend on which of two panels the pointer happened to land on.
 *
 * A swept product needs the same reach for its own reason -- one station
 * runs through every band it was built from, and the rim belongs only to
 * the outermost -- which is why there is no second "related regions" list
 * beside this one. The cloud already *is* that list, resolved by the layer
 * whose job it is (`construction-cloud.ts`) instead of recomputed by
 * whichever tool happens to be calling.
 */
export interface CascadeContext {
  readonly cloud: CloudTopology;
  /** The face the gesture landed on -- `cloud.seed`, offered directly for the common case. */
  readonly topology: ConstructionRegionTopology;
  readonly target: EditTarget;
  /** The delta already constrained by the role's own axes. */
  readonly delta: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * One structure type's definition -- which is to say, **what a cloud of this
 * type does**, since the cloud is what the type names (`ADR-0022`, and
 * `construction-cloud.ts`). Nothing below is a property of a single face;
 * a face only carries the string that selects this table.
 *
 * It pairs the halves the design doc keeps together on purpose:
 *
 * 1. **How it is created** -- which generation call produced it, in what
 *    expected shape.
 * 2. **The role table derived from that shape**, each role declaring its own
 *    reach. Because this side *asked* for a specific shape, it already knows
 *    by construction what index 0 of the engine's deterministically-ordered
 *    response means. Nothing travels back from Rust to say so.
 * 3. **How it meets every other type** when painted over one.
 *
 * A tool preset -- "a tower," "a house" -- is not a type and never appears
 * here. A preset chooses parameters and a generator; the geometry it
 * produces lands in a cloud whose type is one of these, and that cloud is
 * where its behaviour comes from. This is why a tower needs no editing code
 * of its own.
 */
export interface StructureTypeDefinition {
  /** The `surfaceType` the engine reports for regions of this kind. */
  readonly surfaceType: string;
  readonly label: string;
  /**
   * How this type is generated, recorded next to the roles it implies --
   * the doc's whole point is that these two halves must not drift apart.
   */
  readonly creation: string;
  /** Resolves what the grabbed part of this region means. */
  readonly roleFor: (topology: ConstructionRegionTopology, target: EditTarget) => EditRole;
  /** The policy for one role. */
  readonly policyFor: (role: EditRole) => RolePolicy;
  /**
   * What happens when **this** type is painted over `coveredType` -- the
   * creation half of the same declaration. Directional on purpose: a wall
   * goes on terrain, terrain does not go on a wall, and neither direction
   * says anything about the other.
   *
   * `paintedSubtype` is the preset the run being painted was built from,
   * when its type has subtypes at all. It is what lets one type vary a
   * declared behaviour -- a bridge deck consuming nothing where a road
   * carves -- without splitting into a second type with its own role table
   * and its own logic to keep in step.
   */
  readonly interactionOver: (
    coveredType: string,
    paintedSubtype?: string,
  ) => CreationInteraction;
}

/** The policy every unknown role falls back to: refuse rather than guess. */
export function denied(role: EditRole, reason: string): RolePolicy {
  return { role, resolve: { kind: "deny", reason }, axes: [], scope: "surface" };
}

/** Convenience for the common "allowed, on these axes, at this reach, no cascade" policy. */
export function allowed(
  role: EditRole,
  axes: readonly EditAxis[],
  scope: EditScope,
  cascade?: RolePolicy["cascade"],
): RolePolicy {
  return { role, resolve: { kind: "allow" }, axes, scope, cascade };
}

export type { EditGesture };
