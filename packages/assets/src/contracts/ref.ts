/**
 * Resource identity.
 *
 * An identity is opaque on purpose. A URL, a file path, or an index into an
 * array all leak where something currently lives into the name it is known by,
 * and every one of them breaks when that changes -- moving a file, switching to
 * a CDN, or inserting an element ahead of an index. This repository already has
 * its own cautionary case: `tileset-wfc::CellId` is a positional index, which
 * is precisely why `ADR-0022` forbids persisting it as identity.
 */

declare const kindBrand: unique symbol;

/**
 * A stable, opaque handle to one declared resource.
 *
 * Branded by kind so a mesh reference cannot be passed where an image is
 * expected. The brand exists only in the type system -- at runtime every ref is
 * an ordinary string -- which is exactly the case where types have to carry a
 * distinction the data cannot.
 */
export type ResourceRef<TKind extends ResourceKind = ResourceKind> = string & {
  readonly [kindBrand]: TKind;
};

/**
 * Which sort of resource a definition describes.
 *
 * Deliberately an open string rather than a union of the kinds shipped here.
 * `ADR-0014` forbids baking product concepts into a capability package, and a
 * closed set would mean a consumer with a kind this package never imagined --
 * a material, an audio clip, an animation track -- could not use the store at
 * all without editing it.
 */
export type ResourceKind = string;

/**
 * The resource type each built-in kind resolves to.
 *
 * Deliberately an `interface` rather than a type alias: a consumer that
 * registers a resolver for its own kind widens this by declaration merging,
 * and {@link ResourceOf} then types that kind end to end without this package
 * knowing it exists.
 *
 * ```ts
 * declare module "@grafting/assets" {
 *   interface ResourceKinds {
 *     readonly "pbr-material": MyMaterialResource;
 *   }
 * }
 * ```
 */
export interface ResourceKinds {}

/**
 * The resource a kind produces, or `unknown` for a kind nothing has declared.
 *
 * `unknown` rather than `any` on purpose: an unregistered kind stays usable but
 * forces the caller to narrow, instead of silently disabling type checking.
 */
export type ResourceOf<TKind extends ResourceKind> = TKind extends keyof ResourceKinds
  ? ResourceKinds[TKind]
  : unknown;

/**
 * Brands a plain string as a resource reference.
 *
 * The one place the brand is applied. Callers building refs from a manifest go
 * through here rather than casting, so the cast exists once and is reviewable.
 */
export function resourceRef<TKind extends ResourceKind>(value: string): ResourceRef<TKind> {
  return value as ResourceRef<TKind>;
}
