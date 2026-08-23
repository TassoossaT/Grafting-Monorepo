import type { ConstructionRegionTopology } from "@/ports";

import type { AtomicEditOp, EditAxis, EditGesture, EditTarget } from "../atomic-edit.ts";
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
 * One role's complete editing policy: what it allows, what constrains the
 * op's own parameter, and what else fires in the same transaction.
 */
export interface RolePolicy {
  readonly role: EditRole;
  readonly resolve: EditResolution;
  /** Axes the gesture's delta survives on. Ignored when `resolve` is not `"allow"`. */
  readonly axes: readonly EditAxis[];
  /**
   * Extra ops fired alongside the primary one, as one transaction -- e.g.
   * moving a wall's bottom corner moves its paired top corner by the *same*
   * delta. Same-delta cascades are all this model needs so far; there is no
   * scaled or cross-axis variant.
   */
  readonly cascade?: (context: CascadeContext) => readonly AtomicEditOp[];
}

/** What a cascade gets to look at when deriving its extra ops. */
export interface CascadeContext {
  readonly topology: ConstructionRegionTopology;
  /**
   * The other regions this one is connected to -- every region sharing at
   * least one node with {@link topology}.
   *
   * A cascade that only ever saw its own region could not follow a
   * relationship the generator spread across several. A wall does not need
   * this, because a panel's paired corners are both its own; a swept product
   * does, because one cross-section runs through every band it was built
   * from and the rim belongs only to the outermost. Empty when the caller
   * has no wider view to offer, so a role that ignores it is unaffected.
   */
  readonly related: readonly ConstructionRegionTopology[];
  readonly target: EditTarget;
  /** The delta already constrained by the role's own axes. */
  readonly delta: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * One structure type's definition, pairing both halves the design doc keeps
 * together on purpose:
 *
 * 1. **How it is created** -- which generation call produced it, in what
 *    expected shape.
 * 2. **The role table derived from that shape.** Because this side *asked*
 *    for a specific shape, it already knows by construction what index 0 of
 *    the engine's deterministically-ordered response means. Nothing travels
 *    back from Rust to say so.
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
  return { role, resolve: { kind: "deny", reason }, axes: [] };
}

/** Convenience for the common "allowed, on these axes, no cascade" policy. */
export function allowed(role: EditRole, axes: readonly EditAxis[], cascade?: RolePolicy["cascade"]): RolePolicy {
  return { role, resolve: { kind: "allow" }, axes, cascade };
}

export type { EditGesture };
