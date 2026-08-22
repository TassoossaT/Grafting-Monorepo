# assets

### `interface assets.Aabb`

An axis-aligned bounding box in resource-local space.

### `property assets.Aabb.max: Vec3`

Corner with the largest coordinate on every axis.

### `property assets.Aabb.min: Vec3`

Corner with the smallest coordinate on every axis.

### `interface assets.AssetDefinition`

The declaration of one resource: everything known about it before it loads.

The split between this and the loaded resource is the distinction PlayCanvas
draws between an asset *record* and its runtime *resource*, and it is what
makes an inventory possible -- every declared asset can be listed, with its
state, whether or not anything has loaded it.

### `property assets.AssetDefinition.dimensions?: Vec3`

Physical extent, for callers that lay content out without loading it.

Layout metadata only. Never collision, never physics, never vision -- those
are authoritative facts owned elsewhere, and a resource declaring its size
must not become a backdoor into deciding them.

### `property assets.AssetDefinition.kind: TKind`

Which resolver interprets source.

### `property assets.AssetDefinition.provenance: AssetProvenance`

Where this came from and what may be done with it. Required, never inferred.

### `property assets.AssetDefinition.ref: ResourceRef<TKind>`

Stable, opaque identity.

### `property assets.AssetDefinition.revision: number`

Content revision. A definition whose revision changes loads as a distinct
entry, so live holders keep serving the old one until they release and a
scene never blinks mid-frame.

### `property assets.AssetDefinition.source: unknown`

Resolver-specific input: a URL, a storage key, primitive parameters,
packed bytes. `unknown` because only the registered resolver for this kind
can interpret it -- which is the whole extension point for "where does this
live", and why nothing about storage is hardcoded in this package.

### `interface assets.AssetProvenance`

Where a resource came from and what may be done with it.

Required rather than optional, and that is a deliberate cost. Attribution
obligations do not disappear because a file is fetched at runtime instead of
committed, and this repository enforces `THIRD_PARTY_NOTICES.md` with a
check. Making provenance structurally unskippable is cheaper than auditing a
catalog after the fact and discovering nobody recorded a licence.

### `property assets.AssetProvenance.attribution?: string`

Attribution text to reproduce, when the licence requires it.

### `property assets.AssetProvenance.license: string`

SPDX identifier where one applies, otherwise the licence's own name.

### `property assets.AssetProvenance.origin: string`

Pack name, author, or `"generated"` for something the product produced.

### `property assets.AssetProvenance.url?: string`

Where the original can be found. Documentation only -- never identity.

### `interface assets.AssetStore`

Owns what content exists, whether it is loaded, and who is holding it.

It never answers how anything is drawn. Textures, prototypes and effect
content are all just resources here; filtering, batching, shaders and
particle simulation belong to the renderer, and product meaning belongs to
the app. Holding that line is what stops this package from slowly becoming a
second renderer -- the way Babylon's `AssetContainer`, which knows about
scenes, cannot be used by a consumer with a different scene model.

### `method assets.AssetStore.acquire(ref: ResourceRef<TKind>): ResourceHandle<ResourceOf<TKind>>`

Claims a resource, starting its load if nothing else already has.

Concurrent acquisitions of the same `(ref, revision)` join one load; there
is never a second request in flight for the same thing.

### `method assets.AssetStore.define(definition: AssetDefinition): void`

Declares a resource, replacing any prior declaration of the same ref.

### `method assets.AssetStore.dispose(): void`

Disposes everything, held or not. For teardown, not for eviction.

### `method assets.AssetStore.inventory(): readonly InventoryEntry[]`

Every declared resource with its state, holder count and reported size.

The diagnostic this package exists for: it turns "something is leaking
textures" from a bisect into a table.

### `method assets.AssetStore.load(source: CatalogSource, signal?: AbortSignal): Promise<number>`

Declares everything a CatalogSource lists.

### `method assets.AssetStore.observe(listener: (event: StoreEvent) => void): () => void`

Subscribes to store events. Returns an unsubscribe function.

### `method assets.AssetStore.peek(ref: ResourceRef): AssetDefinition<string> | undefined`

Reads a definition without loading anything and without keeping anything
loaded -- Bevy's weak handle, in the one form this package needs.

A layout that needs only a unit's `dimensions` must not thereby pin its
mesh in memory. Without this, "just read the size" quietly costs megabytes.

### `method assets.AssetStore.registerResolver(resolver: ResourceResolver<TKind>): void`

Registers the resolver for one kind. Throws if that kind is already claimed.

### `method assets.AssetStore.status(ref: ResourceRef): ResourceStatus`

What the store currently knows about one reference.

### `interface assets.AssetStoreOptions`

Everything needed to stand a store up.

### `property assets.AssetStoreOptions.retention?: RetentionPolicy`

Defaults to `{ kind: "immediate" }`.

### `interface assets.CatalogSource`

Supplies the definitions available in one environment.

Without this, "where do the bytes live" would simply move up a level into
"where does the *list* live", and be hardcoded there instead. A manifest
fetched over HTTP, a scan of a development folder, a read from IndexedDB and
a fixed array in a test are four implementations of this one method; the
package ships none of them.

### `property assets.CatalogSource.id: string`

Identifies this source in diagnostics.

### `method assets.CatalogSource.list(signal: AbortSignal): Promise<readonly AssetDefinition<string>[]>`

Everything this source declares.

### `interface assets.InMemoryImageSource`

What an in-memory image definition puts in its `source`.

### `property assets.InMemoryImageSource.colorSpace?: "srgb" | "linear"`

Defaults to `"srgb"`, which is what colour textures are authored in.

### `property assets.InMemoryImageSource.height: number`

Height in pixels, used to report the decoded memory cost.

### `property assets.InMemoryImageSource.source: ImageBitmap | HTMLImageElement | HTMLCanvasElement`

The already-decoded image. Ownership passes to the store.

### `property assets.InMemoryImageSource.width: number`

Width in pixels, used to report the decoded memory cost.

### `interface assets.InventoryEntry`

One row of AssetStore.inventory.

### `property assets.InventoryEntry.kind: string`

Which resolver would load it.

### `property assets.InventoryEntry.ref: ResourceRef`

The declared resource this row describes.

### `property assets.InventoryEntry.status: ResourceStatus`

What the store currently knows about it.

### `interface assets.MeshResource`

Packed geometry, in the resource's own local frame.

### `property assets.MeshResource.bounds: Aabb`

Extent of the geometry, so a consumer can lay it out without reading vertices.

### `property assets.MeshResource.indices?: Uint16Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>`

Optional triangle indices. Positions are read sequentially when omitted.

### `property assets.MeshResource.normals?: Float32Array<ArrayBufferLike>`

Optional flat `xyz` normal triples.

### `property assets.MeshResource.positions: Float32Array`

Flat `xyz` triples, three floats per vertex.

### `property assets.MeshResource.uvs?: Float32Array<ArrayBufferLike>`

Optional flat `uv` pairs, two floats per vertex.

### `interface assets.ResourceHandle`

One holder's claim on a loaded resource.

Holding a handle is what keeps a resource alive; releasing it is what allows
disposal. This is Bevy's strong handle, and the reason the three classic
asset bugs -- loading the same thing twice, leaking what is unused, disposing
what is still in use -- all reduce to one missing fact: nobody knows who
holds what.

### `property assets.ResourceHandle.ref: ResourceRef`

Which resource this handle claims.

### `property assets.ResourceHandle.revision: number`

Which revision of the definition this handle serves.

### `method assets.ResourceHandle.current(): TResource | undefined`

The resource if it is ready, `undefined` while loading or after a failure.
Never throws -- a render loop must be able to call this every frame.

### `method assets.ResourceHandle.release(): void`

Drops this holder's claim. Idempotent; releasing twice is not an error.

### `method assets.ResourceHandle.whenReady(): Promise<TResource>`

Resolves when the resource is ready; rejects if the load failed.

### `interface assets.ResourceKinds`

The resource type each built-in kind resolves to.

Deliberately an `interface` rather than a type alias: a consumer that
registers a resolver for its own kind widens this by declaration merging,
and ResourceOf then types that kind end to end without this package
knowing it exists.

```ts
declare module "@grafting/assets" {
  interface ResourceKinds {
    readonly "pbr-material": MyMaterialResource;
  }
}
```

### `interface assets.ResourceResolver`

Turns a declaration into a loaded resource, for one kind.

Registration is the whole integration surface for content this package knows
nothing about, and it is the third use of the same pattern in this repository
-- `@grafting/render-3d`'s `VisualRegistry` and the VTT's covering registry
being the other two. Godot arrives at the same shape (`ResourceLoader` as a
facade over registered per-format loaders), and Bevy at a near-identical one.

A parametric box, a decoded `.glb`, a canvas-generated texture and a
procedurally generated mesh are four resolvers behind one opaque ref. Nothing
upstream of a resolver knows which it got.

### `property assets.ResourceResolver.kind: TKind`

The kind this resolver claims. One resolver per kind.

### `method assets.ResourceResolver.dispose(resource: ResourceOf<TKind>): void`

Releases anything load allocated outside the JS heap.

The single most important method in this package. WebGL and `ImageBitmap`
resources are not garbage collected, and disposal bugs are subtle enough
that three.js shipped one for years -- `Texture.dispose()` does not close
the underlying `ImageBitmap`, so textures decoded from `.glb` leak unless
the caller also closes the bitmap. Routing every disposal through one owner
is what makes such a fix land in one place instead of every call site.

### `method assets.ResourceResolver.load(definition: AssetDefinition<TKind>, signal: AbortSignal): Promise<ResourceOf<TKind>>`

Produces the resource. Rejecting is an ordinary outcome, not a crash: the
store records the failure and the caller falls back.

`signal` aborts when the last holder releases before the load finishes.

### `method assets.ResourceResolver.sizeOf(resource: ResourceOf<TKind>): number`

Reports the resource's memory cost, when the resolver can know it honestly.

Optional because only the resolver can tell: a decoded image's true cost is
its uncompressed pixel buffer, not its file size, and a guess in the store
would be worse than an absent number.

### `interface assets.Vec3`

A point or extent in resource-local space.

### `property assets.Vec3.x: number`

Rightward axis.

### `property assets.Vec3.y: number`

Upward axis.

### `property assets.Vec3.z: number`

Depth axis.

### `type assets.GltfMeshSource = { bytes: Uint8Array } | { url: string }`

What a glTF mesh definition puts in its `source`.

Two forms rather than one, because the two real situations differ: content
fetched from wherever a catalogue points, and content already in hand —
generated, uploaded by a user, or read from storage the store knows nothing
about.

### `type assets.ImageResource = { colorSpace: "srgb" | "linear"; form: "decoded"; height: number; source: ImageBitmap | HTMLImageElement | HTMLCanvasElement; width: number } | { form: "compressed"; format: string; levels: readonly { data: Uint8Array; height: number; width: number }[] }`

An image ready for a renderer to consume.

Two forms, because a GPU-compressed texture is not a decoded bitmap and never
becomes one. Leaving room for `compressed` now is what keeps adopting KTX2 or
Basis later an addition rather than a breaking change to the one contract
every consumer touches -- and compression is not a micro-optimisation here: a
2048x2048 RGBA texture occupies 16 MB of video memory whatever its file size.

### `type assets.PrimitiveMeshSource = { depth: number; height: number; shape: "box"; width: number } | { depth: number; shape: "plane"; width: number }`

What a primitive mesh definition puts in its `source`.

### `type assets.ResourceKind = string`

Which sort of resource a definition describes.

Deliberately an open string rather than a union of the kinds shipped here.
`ADR-0014` forbids baking product concepts into a capability package, and a
closed set would mean a consumer with a kind this package never imagined --
a material, an audio clip, an animation track -- could not use the store at
all without editing it.

### `type assets.ResourceOf = TKind extends keyof ResourceKinds ? ResourceKinds[TKind] : unknown`

The resource a kind produces, or `unknown` for a kind nothing has declared.

`unknown` rather than `any` on purpose: an unregistered kind stays usable but
forces the caller to narrow, instead of silently disabling type checking.

### `type assets.ResourceRef = string & { [kindBrand]: TKind }`

A stable, opaque handle to one declared resource.

Branded by kind so a mesh reference cannot be passed where an image is
expected. The brand exists only in the type system -- at runtime every ref is
an ordinary string -- which is exactly the case where types have to carry a
distinction the data cannot.

### `type assets.ResourceStatus = { state: "undeclared" } | { state: "idle" } | { holders: number; state: "loading" } | { bytes?: number; holders: number; revision: number; state: "ready" } | { attempts: number; error: string; state: "failed" }`

What the store currently knows about one reference.

### `type assets.RetentionPolicy = { kind: "immediate" } | { kind: "least-recently-used"; maxBytes: number }`

What happens to a resource's bytes when its last holder releases.

### `type assets.StoreEvent = { ref: ResourceRef; type: "declared" } | { ref: ResourceRef; type: "load-started" } | { ref: ResourceRef; type: "load-succeeded" } | { error: string; ref: ResourceRef; type: "load-failed" } | { ref: ResourceRef; type: "disposed" }`

Something the store did, for diagnostics and tests.

### `variable assets.GLTF_MESH_KIND: "gltf-mesh"`

The kind gltfMeshResolver claims.

### `variable assets.gltfMeshResolver: ResourceResolver<typeof GLTF_MESH_KIND>`

Loads authored geometry from a glTF 2.0 asset.

Opening the container is the easy part; the work is resolving accessors --
component types, byte strides, sparse accessors, 16- versus 32-bit indices.
`@gltf-transform/core` does that, and is used here rather than three's
`GLTFLoader` for one structural reason: it depends on no renderer, so the
store stays usable by consumers that never chose three (`ADR-0011`).

No glTF type escapes this module. The result is a plain MeshResource,
as every other resolver produces.

**This first version brings geometry only.** Materials, textures, animation
clips and scene hierarchy are deliberately out: each becomes its own
registered kind later, without changing a single contract — the property
open kinds were chosen for. Every primitive in every scene is flattened into
one mesh with node transforms applied, which is what a consumer drawing a
prop or a unit prototype actually wants.

### `variable assets.IN_MEMORY_IMAGE_KIND: "in-memory-image"`

The kind inMemoryImageResolver claims.

### `variable assets.inMemoryImageResolver: ResourceResolver<typeof IN_MEMORY_IMAGE_KIND>`

Adopts an already-decoded image the caller produced, and takes over its
disposal.

Zero-dependency by construction: it decodes nothing, so it needs no parser --
whoever created the bitmap, canvas or element hands it over and stops owning
it. That makes it the seam any future decoder plugs into, and useful on its
own for generated textures.

The disposal here is the point. `ImageBitmap` is not garbage collected and
must be closed explicitly; three.js shipped this exact defect for years,
where `Texture.dispose()` left the underlying bitmap open and textures
decoded from `.glb` leaked despite disposal that looked correct
(mrdoob/three.js#23953). Owning disposal in one place is what makes that a
one-line fix instead of an audit of every call site.

### `variable assets.PRIMITIVE_MESH_KIND: "primitive-mesh"`

The kind primitiveMeshResolver claims.

### `variable assets.primitiveMeshResolver: ResourceResolver<typeof PRIMITIVE_MESH_KIND>`

Builds geometry from parameters, with no file and no dependency.

This is the store's floor, and it is deliberately always available. Because
asset binaries are not versioned in this repository, a fresh clone has none,
and CI must not reach for an external host -- so something has to be
loadable with nothing but code. A box is that something: it needs no import,
no licence and no network, which makes it both the cheapest way to start and
the permanent fallback when a real asset is missing.

### `function assets.createAssetStore(options: AssetStoreOptions): AssetStore`

Creates an asset store.

Ships no resolvers and no catalog sources: a store that knew how to load
anything would know where things live, and this package deliberately does
not. Register what the environment provides.

### `function assets.resourceRef(value: string): ResourceRef<TKind>`

Brands a plain string as a resource reference.

The one place the brand is applied. Callers building refs from a manifest go
through here rather than casting, so the cast exists once and is reviewable.
