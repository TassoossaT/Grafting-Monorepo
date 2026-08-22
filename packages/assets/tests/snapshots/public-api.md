# Generated TypeScript public API baseline

Package: `@grafting/assets`  
TypeScript: `5.9.3`  
Source entry point: `src/index.ts`  
Documentation policy: every exported declaration and public member requires TSDoc  
Forbidden public modules: `@gltf-transform/core`

## Declaration entry point

```ts
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
export interface ResourceKinds {
}
/**
 * The resource a kind produces, or `unknown` for a kind nothing has declared.
 *
 * `unknown` rather than `any` on purpose: an unregistered kind stays usable but
 * forces the caller to narrow, instead of silently disabling type checking.
 */
export type ResourceOf<TKind extends ResourceKind> = TKind extends keyof ResourceKinds ? ResourceKinds[TKind] : unknown;
/**
 * Brands a plain string as a resource reference.
 *
 * The one place the brand is applied. Callers building refs from a manifest go
 * through here rather than casting, so the cast exists once and is reviewable.
 */
export declare function resourceRef<TKind extends ResourceKind>(value: string): ResourceRef<TKind>;
export {};

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
export interface ResourceKinds {
}
/**
 * The resource a kind produces, or `unknown` for a kind nothing has declared.
 *
 * `unknown` rather than `any` on purpose: an unregistered kind stays usable but
 * forces the caller to narrow, instead of silently disabling type checking.
 */
export type ResourceOf<TKind extends ResourceKind> = TKind extends keyof ResourceKinds ? ResourceKinds[TKind] : unknown;
/**
 * Brands a plain string as a resource reference.
 *
 * The one place the brand is applied. Callers building refs from a manifest go
 * through here rather than casting, so the cast exists once and is reviewable.
 */
export declare function resourceRef<TKind extends ResourceKind>(value: string): ResourceRef<TKind>;
export {};

/**
 * The decoded forms this package ships kinds for.
 *
 * Every shape here is structural and renderer-neutral. Nothing imports
 * `@grafting/render-3d`, and nothing should: a catalog that depends on one
 * renderer can only be used by consumers that already chose that renderer,
 * which destroys the reuse this package exists for. The few duplicated
 * interface declarations are the cheaper half of that trade -- the same call
 * `apps/vtt`'s own render port already documents making.
 */
/** A point or extent in resource-local space. */
export interface Vec3 {
    /** Rightward axis. */
    readonly x: number;
    /** Upward axis. */
    readonly y: number;
    /** Depth axis. */
    readonly z: number;
}
/** An axis-aligned bounding box in resource-local space. */
export interface Aabb {
    /** Corner with the smallest coordinate on every axis. */
    readonly min: Vec3;
    /** Corner with the largest coordinate on every axis. */
    readonly max: Vec3;
}
/** Packed geometry, in the resource's own local frame. */
export interface MeshResource {
    /** Flat `xyz` triples, three floats per vertex. */
    readonly positions: Float32Array;
    /** Optional flat `xyz` normal triples. */
    readonly normals?: Float32Array;
    /** Optional flat `uv` pairs, two floats per vertex. */
    readonly uvs?: Float32Array;
    /** Optional triangle indices. Positions are read sequentially when omitted. */
    readonly indices?: Uint16Array | Uint32Array;
    /** Extent of the geometry, so a consumer can lay it out without reading vertices. */
    readonly bounds: Aabb;
}
/**
 * Geometry that arrived as several pieces, kept separate.
 *
 * An authored asset routinely holds more than one primitive. Concatenating
 * them into a single buffer is a real operation, but it is **not this
 * package's**: joining buffers to save a draw call is a decision for whoever
 * draws, and `@grafting/render-3d` already owns an implementation
 * (`mergeMeshChunks`). Duplicating it here would be a second copy of
 * authoritative behaviour that drifts from the first (`DEC-049`).
 *
 * So the store decodes — accessors, node transforms, bounds — and hands over
 * what the file actually contains. A consumer that wants one buffer merges;
 * one that wants per-part materials later, or per-part culling, still can,
 * which a pre-merged buffer would have made impossible.
 */
export interface MeshPartsResource {
    /** One entry per primitive, already in the asset's own world space. */
    readonly parts: readonly MeshResource[];
    /** Union of every part's bounds, so extent is available without merging. */
    readonly bounds: Aabb;
}
/**
 * An image ready for a renderer to consume.
 *
 * Two forms, because a GPU-compressed texture is not a decoded bitmap and never
 * becomes one. Leaving room for `compressed` now is what keeps adopting KTX2 or
 * Basis later an addition rather than a breaking change to the one contract
 * every consumer touches -- and compression is not a micro-optimisation here: a
 * 2048x2048 RGBA texture occupies 16 MB of video memory whatever its file size.
 */
export type ImageResource = {
    readonly form: "decoded";
    /** DOM image types only. No renderer texture type is exposed. */
    readonly source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
    readonly colorSpace: "srgb" | "linear";
} | {
    readonly form: "compressed";
    /** GPU format identifier, e.g. `"bc7-rgba-unorm"`. Interpreted by the renderer. */
    readonly format: string;
    /** Mip levels, largest first. */
    readonly levels: readonly {
        readonly data: Uint8Array;
        readonly width: number;
        readonly height: number;
    }[];
};

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
    /** Where this came from and what may be done with it. Required, never inferred. */
    readonly provenance: AssetProvenance;
}

import type { AssetDefinition } from "./definition.js";
import type { ResourceKind, ResourceOf } from "./ref.js";
/**
 * Turns a declaration into a loaded resource, for one kind.
 *
 * Registration is the whole integration surface for content this package knows
 * nothing about, and it is the third use of the same pattern in this repository
 * -- `@grafting/render-3d`'s `VisualRegistry` and the VTT's covering registry
 * being the other two. Godot arrives at the same shape (`ResourceLoader` as a
 * facade over registered per-format loaders), and Bevy at a near-identical one.
 *
 * A parametric box, a decoded `.glb`, a canvas-generated texture and a
 * procedurally generated mesh are four resolvers behind one opaque ref. Nothing
 * upstream of a resolver knows which it got.
 */
export interface ResourceResolver<TKind extends ResourceKind = ResourceKind> {
    /** The kind this resolver claims. One resolver per kind. */
    readonly kind: TKind;
    /**
     * Produces the resource. Rejecting is an ordinary outcome, not a crash: the
     * store records the failure and the caller falls back.
     *
     * `signal` aborts when the last holder releases before the load finishes.
     */
    load(definition: AssetDefinition<TKind>, signal: AbortSignal): Promise<ResourceOf<TKind>>;
    /**
     * Releases anything {@link load} allocated outside the JS heap.
     *
     * The single most important method in this package. WebGL and `ImageBitmap`
     * resources are not garbage collected, and disposal bugs are subtle enough
     * that three.js shipped one for years -- `Texture.dispose()` does not close
     * the underlying `ImageBitmap`, so textures decoded from `.glb` leak unless
     * the caller also closes the bitmap. Routing every disposal through one owner
     * is what makes such a fix land in one place instead of every call site.
     */
    dispose?(resource: ResourceOf<TKind>): void;
    /**
     * Reports the resource's memory cost, when the resolver can know it honestly.
     *
     * Optional because only the resolver can tell: a decoded image's true cost is
     * its uncompressed pixel buffer, not its file size, and a guess in the store
     * would be worse than an absent number.
     */
    sizeOf?(resource: ResourceOf<TKind>): number;
}
/**
 * Supplies the definitions available in one environment.
 *
 * Without this, "where do the bytes live" would simply move up a level into
 * "where does the *list* live", and be hardcoded there instead. A manifest
 * fetched over HTTP, a scan of a development folder, a read from IndexedDB and
 * a fixed array in a test are four implementations of this one method; the
 * package ships none of them.
 */
export interface CatalogSource {
    /** Identifies this source in diagnostics. */
    readonly id: string;
    /** Everything this source declares. */
    list(signal: AbortSignal): Promise<readonly AssetDefinition[]>;
}

import type { AssetDefinition } from "./definition.js";
import type { ResourceKind, ResourceOf, ResourceRef } from "./ref.js";
import type { CatalogSource, ResourceResolver } from "./resolver.js";
/**
 * One holder's claim on a loaded resource.
 *
 * Holding a handle is what keeps a resource alive; releasing it is what allows
 * disposal. This is Bevy's strong handle, and the reason the three classic
 * asset bugs -- loading the same thing twice, leaking what is unused, disposing
 * what is still in use -- all reduce to one missing fact: nobody knows who
 * holds what.
 */
export interface ResourceHandle<TResource> {
    /** Which resource this handle claims. */
    readonly ref: ResourceRef;
    /** Which revision of the definition this handle serves. */
    readonly revision: number;
    /**
     * The resource if it is ready, `undefined` while loading or after a failure.
     * Never throws -- a render loop must be able to call this every frame.
     */
    current(): TResource | undefined;
    /** Resolves when the resource is ready; rejects if the load failed. */
    whenReady(): Promise<TResource>;
    /** Drops this holder's claim. Idempotent; releasing twice is not an error. */
    release(): void;
}
/** What the store currently knows about one reference. */
export type ResourceStatus = 
/** No definition has been declared for this ref. */
{
    readonly state: "undeclared";
}
/** Declared, with nothing holding it and nothing loaded. */
 | {
    readonly state: "idle";
} | {
    readonly state: "loading";
    readonly holders: number;
} | {
    readonly state: "ready";
    readonly revision: number;
    readonly holders: number;
    /** Resolver-reported cost in bytes, when it could report one honestly. */
    readonly bytes?: number;
} | {
    readonly state: "failed";
    readonly error: string;
    readonly attempts: number;
};
/** One row of {@link AssetStore.inventory}. */
export interface InventoryEntry {
    /** The declared resource this row describes. */
    readonly ref: ResourceRef;
    /** Which resolver would load it. */
    readonly kind: ResourceKind;
    /** What the store currently knows about it. */
    readonly status: ResourceStatus;
}
/** Something the store did, for diagnostics and tests. */
export type StoreEvent = {
    readonly type: "declared";
    readonly ref: ResourceRef;
} | {
    readonly type: "load-started";
    readonly ref: ResourceRef;
} | {
    readonly type: "load-succeeded";
    readonly ref: ResourceRef;
} | {
    readonly type: "load-failed";
    readonly ref: ResourceRef;
    readonly error: string;
} | {
    readonly type: "disposed";
    readonly ref: ResourceRef;
};
/** What happens to a resource's bytes when its last holder releases. */
export type RetentionPolicy = 
/**
 * Dispose immediately. Memory in use is exactly memory held, which is the
 * predictable default -- and predictability is what matters most before any
 * measurement exists.
 */
{
    readonly kind: "immediate";
}
/**
 * Keep unheld resources until the retained set exceeds `maxBytes`, then
 * dispose the least recently released first. Re-acquiring something recent
 * becomes instant, at the cost of a memory tail that is harder to predict.
 */
 | {
    readonly kind: "least-recently-used";
    readonly maxBytes: number;
};
/** Everything needed to stand a store up. */
export interface AssetStoreOptions {
    /** Defaults to `{ kind: "immediate" }`. */
    readonly retention?: RetentionPolicy;
}
/**
 * Owns what content exists, whether it is loaded, and who is holding it.
 *
 * It never answers how anything is drawn. Textures, prototypes and effect
 * content are all just resources here; filtering, batching, shaders and
 * particle simulation belong to the renderer, and product meaning belongs to
 * the app. Holding that line is what stops this package from slowly becoming a
 * second renderer -- the way Babylon's `AssetContainer`, which knows about
 * scenes, cannot be used by a consumer with a different scene model.
 */
export interface AssetStore {
    /** Declares a resource, replacing any prior declaration of the same ref. */
    define(definition: AssetDefinition): void;
    /** Declares everything a {@link CatalogSource} lists. */
    load(source: CatalogSource, signal?: AbortSignal): Promise<number>;
    /** Registers the resolver for one kind. Throws if that kind is already claimed. */
    registerResolver<TKind extends ResourceKind>(resolver: ResourceResolver<TKind>): void;
    /**
     * Claims a resource, starting its load if nothing else already has.
     *
     * Concurrent acquisitions of the same `(ref, revision)` join one load; there
     * is never a second request in flight for the same thing.
     */
    acquire<TKind extends ResourceKind>(ref: ResourceRef<TKind>): ResourceHandle<ResourceOf<TKind>>;
    /**
     * Reads a definition without loading anything and without keeping anything
     * loaded -- Bevy's weak handle, in the one form this package needs.
     *
     * A layout that needs only a unit's `dimensions` must not thereby pin its
     * mesh in memory. Without this, "just read the size" quietly costs megabytes.
     */
    peek(ref: ResourceRef): AssetDefinition | undefined;
    /** What the store currently knows about one reference. */
    status(ref: ResourceRef): ResourceStatus;
    /**
     * Every declared resource with its state, holder count and reported size.
     *
     * The diagnostic this package exists for: it turns "something is leaking
     * textures" from a bisect into a table.
     */
    inventory(): readonly InventoryEntry[];
    /** Subscribes to store events. Returns an unsubscribe function. */
    observe(listener: (event: StoreEvent) => void): () => void;
    /** Disposes everything, held or not. For teardown, not for eviction. */
    dispose(): void;
}

import type { AssetStore, AssetStoreOptions } from "../contracts/store.js";
/**
 * Creates an asset store.
 *
 * Ships no resolvers and no catalog sources: a store that knew how to load
 * anything would know where things live, and this package deliberately does
 * not. Register what the environment provides.
 */
export declare function createAssetStore(options?: AssetStoreOptions): AssetStore;

import type { ResourceResolver } from "../contracts/resolver.js";
/** The kind {@link primitiveMeshResolver} claims. */
export declare const PRIMITIVE_MESH_KIND = "primitive-mesh";
/** What a primitive mesh definition puts in its `source`. */
export type PrimitiveMeshSource = {
    readonly shape: "box";
    readonly width: number;
    readonly height: number;
    readonly depth: number;
} | {
    readonly shape: "plane";
    readonly width: number;
    readonly depth: number;
};
/**
 * Builds geometry from parameters, with no file and no dependency.
 *
 * This is the store's floor, and it is deliberately always available. Because
 * asset binaries are not versioned in this repository, a fresh clone has none,
 * and CI must not reach for an external host -- so something has to be
 * loadable with nothing but code. A box is that something: it needs no import,
 * no licence and no network, which makes it both the cheapest way to start and
 * the permanent fallback when a real asset is missing.
 */
export declare const primitiveMeshResolver: ResourceResolver<typeof PRIMITIVE_MESH_KIND>;

import type { ResourceResolver } from "../contracts/resolver.js";
/** The kind {@link primitiveMeshResolver} claims. */
export declare const PRIMITIVE_MESH_KIND = "primitive-mesh";
/** What a primitive mesh definition puts in its `source`. */
export type PrimitiveMeshSource = {
    readonly shape: "box";
    readonly width: number;
    readonly height: number;
    readonly depth: number;
} | {
    readonly shape: "plane";
    readonly width: number;
    readonly depth: number;
};
/**
 * Builds geometry from parameters, with no file and no dependency.
 *
 * This is the store's floor, and it is deliberately always available. Because
 * asset binaries are not versioned in this repository, a fresh clone has none,
 * and CI must not reach for an external host -- so something has to be
 * loadable with nothing but code. A box is that something: it needs no import,
 * no licence and no network, which makes it both the cheapest way to start and
 * the permanent fallback when a real asset is missing.
 */
export declare const primitiveMeshResolver: ResourceResolver<typeof PRIMITIVE_MESH_KIND>;

import type { ResourceResolver } from "../contracts/resolver.js";
/** The kind {@link inMemoryImageResolver} claims. */
export declare const IN_MEMORY_IMAGE_KIND = "in-memory-image";
/** What an in-memory image definition puts in its `source`. */
export interface InMemoryImageSource {
    /** The already-decoded image. Ownership passes to the store. */
    readonly source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
    /** Width in pixels, used to report the decoded memory cost. */
    readonly width: number;
    /** Height in pixels, used to report the decoded memory cost. */
    readonly height: number;
    /** Defaults to `"srgb"`, which is what colour textures are authored in. */
    readonly colorSpace?: "srgb" | "linear";
}
/**
 * Adopts an already-decoded image the caller produced, and takes over its
 * disposal.
 *
 * Zero-dependency by construction: it decodes nothing, so it needs no parser --
 * whoever created the bitmap, canvas or element hands it over and stops owning
 * it. That makes it the seam any future decoder plugs into, and useful on its
 * own for generated textures.
 *
 * The disposal here is the point. `ImageBitmap` is not garbage collected and
 * must be closed explicitly; three.js shipped this exact defect for years,
 * where `Texture.dispose()` left the underlying bitmap open and textures
 * decoded from `.glb` leaked despite disposal that looked correct
 * (mrdoob/three.js#23953). Owning disposal in one place is what makes that a
 * one-line fix instead of an audit of every call site.
 */
export declare const inMemoryImageResolver: ResourceResolver<typeof IN_MEMORY_IMAGE_KIND>;

import type { ResourceResolver } from "../contracts/resolver.js";
/** The kind {@link inMemoryImageResolver} claims. */
export declare const IN_MEMORY_IMAGE_KIND = "in-memory-image";
/** What an in-memory image definition puts in its `source`. */
export interface InMemoryImageSource {
    /** The already-decoded image. Ownership passes to the store. */
    readonly source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
    /** Width in pixels, used to report the decoded memory cost. */
    readonly width: number;
    /** Height in pixels, used to report the decoded memory cost. */
    readonly height: number;
    /** Defaults to `"srgb"`, which is what colour textures are authored in. */
    readonly colorSpace?: "srgb" | "linear";
}
/**
 * Adopts an already-decoded image the caller produced, and takes over its
 * disposal.
 *
 * Zero-dependency by construction: it decodes nothing, so it needs no parser --
 * whoever created the bitmap, canvas or element hands it over and stops owning
 * it. That makes it the seam any future decoder plugs into, and useful on its
 * own for generated textures.
 *
 * The disposal here is the point. `ImageBitmap` is not garbage collected and
 * must be closed explicitly; three.js shipped this exact defect for years,
 * where `Texture.dispose()` left the underlying bitmap open and textures
 * decoded from `.glb` leaked despite disposal that looked correct
 * (mrdoob/three.js#23953). Owning disposal in one place is what makes that a
 * one-line fix instead of an audit of every call site.
 */
export declare const inMemoryImageResolver: ResourceResolver<typeof IN_MEMORY_IMAGE_KIND>;

import type { ResourceResolver } from "../contracts/resolver.js";
/** The kind {@link createEncodedImageResolver} claims. */
export declare const ENCODED_IMAGE_KIND = "encoded-image";
/**
 * Where an encoded image's bytes come from.
 *
 * The same two cases as the glTF resolver, for the same reason: bytes that were
 * generated, uploaded by a user, or read from storage this package knows
 * nothing about must work exactly as well as a fetch. Which one a definition
 * uses is invisible to everything upstream of the resolver.
 */
export type EncodedImageBytes = 
/** Encoded bytes of a PNG, JPEG, WebP -- whatever the decoder accepts. */
{
    readonly bytes: Uint8Array;
}
/** A location to fetch the bytes from. */
 | {
    readonly url: string;
};
/**
 * How a colour channel's values are to be read.
 *
 * Declared per image, never assumed, because a PBR material is not one texture.
 * Base colour is authored in sRGB; normal, roughness, ambient occlusion and
 * height are linear data that merely happen to be stored in an image. Decoding
 * a normal map as sRGB does not fail -- it produces lighting that is subtly and
 * consistently wrong, which is the kind of defect that survives review and is
 * obvious only on screen.
 *
 * There is no safe default across a material's maps, so the declaration carries
 * it and this resolver never guesses. `"srgb"` is the fallback only because a
 * lone texture with nothing said about it is far more often colour.
 */
export type ImageColorSpace = "srgb" | "linear";
/** What an encoded image definition puts in its `source`. */
export type EncodedImageSource = EncodedImageBytes & {
    /**
     * How this image's values are read. Defaults to `"srgb"`.
     *
     * Set `"linear"` for every map that carries data rather than colour.
     */
    readonly colorSpace?: ImageColorSpace;
    /**
     * Media type handed to the decoder, when the bytes do not carry one.
     *
     * Only needed for a decoder that cannot sniff the format itself; the platform
     * one can.
     */
    readonly mediaType?: string;
};
/** A decoded image, in the shape {@link ImageResource}'s decoded form needs. */
export interface DecodedImage {
    /** DOM image types only. No renderer texture type is exposed. */
    readonly source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
    /**
     * Width in pixels.
     *
     * Reported by the decoder rather than read back off {@link source}, so a
     * decoder whose output does not expose its own dimensions still works.
     */
    readonly width: number;
    /** Height in pixels. Reported by the decoder, as {@link width} is. */
    readonly height: number;
}
/** How the resolver reaches the platform. Both default to the global. */
export interface EncodedImageResolverOptions {
    /**
     * Fetches a URL. Defaults to the global `fetch`.
     *
     * Supplied from outside so a consumer can add auth headers, a cache policy,
     * or a retry -- none of which this package should have opinions about.
     */
    readonly fetch?: (url: string, init: {
        signal: AbortSignal;
    }) => Promise<Response>;
    /**
     * Turns encoded bytes into a decoded image. Defaults to `createImageBitmap`.
     *
     * The one step that genuinely varies by environment: a worker, an SSR
     * context, and a format the platform cannot decode natively each need their
     * own, and a package that hardcoded the browser's would be unusable in all
     * three. It is also what lets this resolver be tested with no network and no
     * real bitmap, which `AGENTS.md` requires -- no test may depend on an asset
     * that is not produced in-process.
     */
    readonly decode?: (bytes: Uint8Array, mediaType: string | undefined) => Promise<DecodedImage>;
}
/**
 * Loads an authored image the store did not create.
 *
 * The counterpart to `inMemoryImageResolver`, which adopts an image a caller
 * already decoded. That one is right for a generated texture and is
 * deliberately zero-dependency; this one is what lets a consumer *declare* a
 * texture and acquire it, with the fetch, the decode, the abort handling and
 * the disposal all owned here instead of repeated at every call site.
 *
 * Nothing about where images live is decided here. A definition names bytes or
 * a URL, and both arrive from a `CatalogSource` the consumer supplies -- which
 * is what makes this work for asset binaries that are never committed.
 */
export declare function createEncodedImageResolver(options?: EncodedImageResolverOptions): ResourceResolver<typeof ENCODED_IMAGE_KIND>;

import type { ResourceResolver } from "../contracts/resolver.js";
/** The kind {@link createEncodedImageResolver} claims. */
export declare const ENCODED_IMAGE_KIND = "encoded-image";
/**
 * Where an encoded image's bytes come from.
 *
 * The same two cases as the glTF resolver, for the same reason: bytes that were
 * generated, uploaded by a user, or read from storage this package knows
 * nothing about must work exactly as well as a fetch. Which one a definition
 * uses is invisible to everything upstream of the resolver.
 */
export type EncodedImageBytes = 
/** Encoded bytes of a PNG, JPEG, WebP -- whatever the decoder accepts. */
{
    readonly bytes: Uint8Array;
}
/** A location to fetch the bytes from. */
 | {
    readonly url: string;
};
/**
 * How a colour channel's values are to be read.
 *
 * Declared per image, never assumed, because a PBR material is not one texture.
 * Base colour is authored in sRGB; normal, roughness, ambient occlusion and
 * height are linear data that merely happen to be stored in an image. Decoding
 * a normal map as sRGB does not fail -- it produces lighting that is subtly and
 * consistently wrong, which is the kind of defect that survives review and is
 * obvious only on screen.
 *
 * There is no safe default across a material's maps, so the declaration carries
 * it and this resolver never guesses. `"srgb"` is the fallback only because a
 * lone texture with nothing said about it is far more often colour.
 */
export type ImageColorSpace = "srgb" | "linear";
/** What an encoded image definition puts in its `source`. */
export type EncodedImageSource = EncodedImageBytes & {
    /**
     * How this image's values are read. Defaults to `"srgb"`.
     *
     * Set `"linear"` for every map that carries data rather than colour.
     */
    readonly colorSpace?: ImageColorSpace;
    /**
     * Media type handed to the decoder, when the bytes do not carry one.
     *
     * Only needed for a decoder that cannot sniff the format itself; the platform
     * one can.
     */
    readonly mediaType?: string;
};
/** A decoded image, in the shape {@link ImageResource}'s decoded form needs. */
export interface DecodedImage {
    /** DOM image types only. No renderer texture type is exposed. */
    readonly source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
    /**
     * Width in pixels.
     *
     * Reported by the decoder rather than read back off {@link source}, so a
     * decoder whose output does not expose its own dimensions still works.
     */
    readonly width: number;
    /** Height in pixels. Reported by the decoder, as {@link width} is. */
    readonly height: number;
}
/** How the resolver reaches the platform. Both default to the global. */
export interface EncodedImageResolverOptions {
    /**
     * Fetches a URL. Defaults to the global `fetch`.
     *
     * Supplied from outside so a consumer can add auth headers, a cache policy,
     * or a retry -- none of which this package should have opinions about.
     */
    readonly fetch?: (url: string, init: {
        signal: AbortSignal;
    }) => Promise<Response>;
    /**
     * Turns encoded bytes into a decoded image. Defaults to `createImageBitmap`.
     *
     * The one step that genuinely varies by environment: a worker, an SSR
     * context, and a format the platform cannot decode natively each need their
     * own, and a package that hardcoded the browser's would be unusable in all
     * three. It is also what lets this resolver be tested with no network and no
     * real bitmap, which `AGENTS.md` requires -- no test may depend on an asset
     * that is not produced in-process.
     */
    readonly decode?: (bytes: Uint8Array, mediaType: string | undefined) => Promise<DecodedImage>;
}
/**
 * Loads an authored image the store did not create.
 *
 * The counterpart to `inMemoryImageResolver`, which adopts an image a caller
 * already decoded. That one is right for a generated texture and is
 * deliberately zero-dependency; this one is what lets a consumer *declare* a
 * texture and acquire it, with the fetch, the decode, the abort handling and
 * the disposal all owned here instead of repeated at every call site.
 *
 * Nothing about where images live is decided here. A definition names bytes or
 * a URL, and both arrive from a `CatalogSource` the consumer supplies -- which
 * is what makes this work for asset binaries that are never committed.
 */
export declare function createEncodedImageResolver(options?: EncodedImageResolverOptions): ResourceResolver<typeof ENCODED_IMAGE_KIND>;

import type { ResourceResolver } from "../contracts/resolver.js";
/** The kind {@link gltfMeshResolver} claims. */
export declare const GLTF_MESH_KIND = "gltf-mesh";
/**
 * What a glTF mesh definition puts in its `source`.
 *
 * Two forms rather than one, because the two real situations differ: content
 * fetched from wherever a catalogue points, and content already in hand —
 * generated, uploaded by a user, or read from storage the store knows nothing
 * about.
 */
export type GltfMeshSource = 
/** Bytes of a `.glb`, or of a self-contained `.gltf`, already in memory. */
{
    readonly bytes: Uint8Array;
}
/** A location to fetch the bytes from. */
 | {
    readonly url: string;
};
/**
 * Loads authored geometry from a glTF 2.0 asset.
 *
 * Opening the container is the easy part; the work is resolving accessors --
 * component types, byte strides, sparse accessors, 16- versus 32-bit indices.
 * `@gltf-transform/core` does that, and is used here rather than three's
 * `GLTFLoader` for one structural reason: it depends on no renderer, so the
 * store stays usable by consumers that never chose three (`ADR-0011`).
 *
 * No glTF type escapes this module. The result is a plain {@link MeshResource},
 * as every other resolver produces.
 *
 * Node transforms **are** applied, because interpreting the scene hierarchy is
 * part of reading the format. Concatenating the resulting primitives into one
 * buffer is not: that is a draw-call decision owned by whoever draws, and
 * `@grafting/render-3d` already implements it as `mergeMeshChunks`. Producing
 * separate {@link MeshPartsResource} parts keeps this package from carrying a
 * second copy of that algorithm (`DEC-049`), and leaves per-part materials or
 * per-part culling possible later — which a pre-merged buffer would have
 * foreclosed.
 *
 * **This first version brings geometry only.** Materials, textures and
 * animation clips are deliberately out: each becomes its own registered kind
 * later, without changing a single contract — the property open kinds were
 * chosen for.
 */
export declare const gltfMeshResolver: ResourceResolver<typeof GLTF_MESH_KIND>;

import type { ResourceResolver } from "../contracts/resolver.js";
/** The kind {@link gltfMeshResolver} claims. */
export declare const GLTF_MESH_KIND = "gltf-mesh";
/**
 * What a glTF mesh definition puts in its `source`.
 *
 * Two forms rather than one, because the two real situations differ: content
 * fetched from wherever a catalogue points, and content already in hand —
 * generated, uploaded by a user, or read from storage the store knows nothing
 * about.
 */
export type GltfMeshSource = 
/** Bytes of a `.glb`, or of a self-contained `.gltf`, already in memory. */
{
    readonly bytes: Uint8Array;
}
/** A location to fetch the bytes from. */
 | {
    readonly url: string;
};
/**
 * Loads authored geometry from a glTF 2.0 asset.
 *
 * Opening the container is the easy part; the work is resolving accessors --
 * component types, byte strides, sparse accessors, 16- versus 32-bit indices.
 * `@gltf-transform/core` does that, and is used here rather than three's
 * `GLTFLoader` for one structural reason: it depends on no renderer, so the
 * store stays usable by consumers that never chose three (`ADR-0011`).
 *
 * No glTF type escapes this module. The result is a plain {@link MeshResource},
 * as every other resolver produces.
 *
 * Node transforms **are** applied, because interpreting the scene hierarchy is
 * part of reading the format. Concatenating the resulting primitives into one
 * buffer is not: that is a draw-call decision owned by whoever draws, and
 * `@grafting/render-3d` already implements it as `mergeMeshChunks`. Producing
 * separate {@link MeshPartsResource} parts keeps this package from carrying a
 * second copy of that algorithm (`DEC-049`), and leaves per-part materials or
 * per-part culling possible later — which a pre-merged buffer would have
 * foreclosed.
 *
 * **This first version brings geometry only.** Materials, textures and
 * animation clips are deliberately out: each becomes its own registered kind
 * later, without changing a single contract — the property open kinds were
 * chosen for.
 */
export declare const gltfMeshResolver: ResourceResolver<typeof GLTF_MESH_KIND>;
```
