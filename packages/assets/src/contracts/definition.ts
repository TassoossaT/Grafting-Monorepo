import type { ResourceKind, ResourceRef } from "./ref.js";
import type { Vec3 } from "./resource.js";

/**
 * Where a resource came from and what may be done with it.
 *
 * Required rather than optional, and that is a deliberate cost. Attribution
 * obligations do not disappear because a file is fetched at runtime instead of
 * committed, and this repository enforces `THIRD_PARTY_NOTICES.md` with a
 * check. Making provenance structurally unskippable is cheaper than auditing a
 * catalog after the fact and discovering nobody recorded a licence.
 */
export interface AssetProvenance {
  /** Pack name, author, or `"generated"` for something the product produced. */
  readonly origin: string;
  /** SPDX identifier where one applies, otherwise the licence's own name. */
  readonly license: string;
  /** Attribution text to reproduce, when the licence requires it. */
  readonly attribution?: string;
  /** Where the original can be found. Documentation only -- never identity. */
  readonly url?: string;
}

/**
 * The declaration of one resource: everything known about it before it loads.
 *
 * The split between this and the loaded resource is the distinction PlayCanvas
 * draws between an asset *record* and its runtime *resource*, and it is what
 * makes an inventory possible -- every declared asset can be listed, with its
 * state, whether or not anything has loaded it.
 */
export interface AssetDefinition<TKind extends ResourceKind = ResourceKind> {
  /** Stable, opaque identity. */
  readonly ref: ResourceRef<TKind>;
  /** Which resolver interprets {@link source}. */
  readonly kind: TKind;
  /**
   * Content revision. A definition whose revision changes loads as a distinct
   * entry, so live holders keep serving the old one until they release and a
   * scene never blinks mid-frame.
   */
  readonly revision: number;
  /**
   * Resolver-specific input: a URL, a storage key, primitive parameters,
   * packed bytes. `unknown` because only the registered resolver for this kind
   * can interpret it -- which is the whole extension point for "where does this
   * live", and why nothing about storage is hardcoded in this package.
   */
  readonly source: unknown;
  /**
   * Physical extent, for callers that lay content out without loading it.
   *
   * Layout metadata only. Never collision, never physics, never vision -- those
   * are authoritative facts owned elsewhere, and a resource declaring its size
   * must not become a backdoor into deciding them.
   */
  readonly dimensions?: Vec3;
  readonly provenance: AssetProvenance;
}
