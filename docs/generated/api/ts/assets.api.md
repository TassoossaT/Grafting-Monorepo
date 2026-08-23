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

### `method assets.AssetStore.define(definition: AssetDefinition): DeclarationOutcome`

Declares a resource.

A ref already declared is **kept**, not replaced, unless this definition
carries a higher AssetDefinition.revision -- which is the one case
that means "the same thing, changed" rather than "a different thing with
the same name". Anything else is refused and reported.

That asymmetry is the whole point. Content from several catalogues has to
coexist: a default pack and an imported one both declaring `grass/meadow`
must not end with one of them silently gone, and the caller must be able to
find out it happened.

### `method assets.AssetStore.dispose(): void`

Disposes everything, held or not. For teardown, not for eviction.

### `method assets.AssetStore.inventory(): readonly InventoryEntry[]`

Every declared resource with its state, holder count and reported size.

The diagnostic this package exists for: it turns "something is leaking
textures" from a bisect into a table.

### `method assets.AssetStore.load(source: CatalogSource, signal?: AbortSignal): Promise<number>`

Declares everything a CatalogSource lists, and reports how many
declarations that actually produced.

The return value counts what was declared or updated, **not** what the
source listed. A source offering twenty entries of which five collide
returns fifteen, and emits five `rejected` events naming it. Reporting the
listed count instead would say a pack loaded cleanly while a quarter of it
did nothing.

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

### `interface assets.DecodedImage`

A decoded image, in the shape ImageResource's decoded form needs.

### `property assets.DecodedImage.height: number`

Height in pixels. Reported by the decoder, as width is.

### `property assets.DecodedImage.source: ImageBitmap | HTMLImageElement | HTMLCanvasElement`

DOM image types only. No renderer texture type is exposed.

### `property assets.DecodedImage.width: number`

Width in pixels.

Reported by the decoder rather than read back off source, so a
decoder whose output does not expose its own dimensions still works.

### `interface assets.EncodedImageResolverOptions`

How the resolver reaches the platform. Both default to the global.

### `property assets.EncodedImageResolverOptions.decode?: (bytes: Uint8Array, mediaType: string | undefined) => Promise<DecodedImage>`

Turns encoded bytes into a decoded image. Defaults to `createImageBitmap`.

The one step that genuinely varies by environment: a worker, an SSR
context, and a format the platform cannot decode natively each need their
own, and a package that hardcoded the browser's would be unusable in all
three. It is also what lets this resolver be tested with no network and no
real bitmap, which `AGENTS.md` requires -- no test may depend on an asset
that is not produced in-process.

### `property assets.EncodedImageResolverOptions.fetch?: (url: string, init: { signal: AbortSignal }) => Promise<Response>`

Fetches a URL. Defaults to the global `fetch`.

Supplied from outside so a consumer can add auth headers, a cache policy,
or a retry -- none of which this package should have opinions about.

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

### `interface assets.MeshPartsResource`

Geometry that arrived as several pieces, kept separate.

An authored asset routinely holds more than one primitive. Concatenating
them into a single buffer is a real operation, but it is **not this
package's**: joining buffers to save a draw call is a decision for whoever
draws, and `@grafting/render-3d` already owns an implementation
(`mergeMeshChunks`). Duplicating it here would be a second copy of
authoritative behaviour that drifts from the first (`DEC-049`).

So the store decodes — accessors, node transforms, bounds — and hands over
what the file actually contains. A consumer that wants one buffer merges;
one that wants per-part materials later, or per-part culling, still can,
which a pre-merged buffer would have made impossible.

### `property assets.MeshPartsResource.bounds: Aabb`

Union of every part's bounds, so extent is available without merging.

### `property assets.MeshPartsResource.parts: readonly MeshResource[]`

One entry per primitive, already in the asset's own world space.

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

### `type assets.DeclarationOutcome = "declared" | "updated" | "rejected"`

What declaring one definition did.

### `type assets.EncodedImageBytes = { bytes: Uint8Array } | { url: string }`

Where an encoded image's bytes come from.

The same two cases as the glTF resolver, for the same reason: bytes that were
generated, uploaded by a user, or read from storage this package knows
nothing about must work exactly as well as a fetch. Which one a definition
uses is invisible to everything upstream of the resolver.

### `type assets.EncodedImageSource = EncodedImageBytes & { colorSpace?: ImageColorSpace; mediaType?: string }`

What an encoded image definition puts in its `source`.

### `type assets.GltfMeshSource = { bytes: Uint8Array } | { url: string }`

What a glTF mesh definition puts in its `source`.

Two forms rather than one, because the two real situations differ: content
fetched from wherever a catalogue points, and content already in hand —
generated, uploaded by a user, or read from storage the store knows nothing
about.

### `type assets.ImageColorSpace = "srgb" | "linear"`

How a colour channel's values are to be read.

Declared per image, never assumed, because a PBR material is not one texture.
Base colour is authored in sRGB; normal, roughness, ambient occlusion and
height are linear data that merely happen to be stored in an image. Decoding
a normal map as sRGB does not fail -- it produces lighting that is subtly and
consistently wrong, which is the kind of defect that survives review and is
obvious only on screen.

There is no safe default across a material's maps, so the declaration carries
it and this resolver never guesses. `"srgb"` is the fallback only because a
lone texture with nothing said about it is far more often colour.

### `type assets.ImageResource = { colorSpace: "srgb" | "linear"; form: "decoded"; height: number; source: ImageBitmap | HTMLImageElement | HTMLCanvasElement; width: number } | { form: "compressed"; format: string; levels: readonly { data: Uint8Array; height: number; width: number }[] }`

An image ready for a renderer to consume.

Two forms, because a GPU-compressed texture is not a decoded bitmap and never
becomes one. Leaving room for `compressed` now is what keeps adopting KTX2 or
Basis later an addition rather than a breaking change to the one contract
every consumer touches -- and compression is not a micro-optimisation here: a
2048x2048 RGBA texture occupies 16 MB of video memory whatever its file size.

### `type assets.PrimitiveMeshSource = { depth: number; height: number; shape: "box"; width: number } | { depth: number; shape: "plane"; width: number }`

What a primitive mesh definition puts in its `source`.

### `type assets.RejectionReason = "already-declared" | "invalid"`

Why a declaration was refused.

Refusal is reported rather than thrown because catalogues are routinely
untrusted: one malformed entry in an imported pack must not take down the
application that loaded it. The rest of the pack still declares.

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

### `type assets.StoreEvent = { ref: ResourceRef; type: "declared" } | { detail: string; reason: RejectionReason; ref: ResourceRef | undefined; sourceId?: string; type: "rejected" } | { ref: ResourceRef; type: "load-started" } | { ref: ResourceRef; type: "load-succeeded" } | { error: string; ref: ResourceRef; type: "load-failed" } | { ref: ResourceRef; type: "disposed" }`

Something the store did, for diagnostics and tests.

### `variable assets.ENCODED_IMAGE_KIND: "encoded-image"`

The kind createEncodedImageResolver claims.

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

Node transforms **are** applied, because interpreting the scene hierarchy is
part of reading the format. Concatenating the resulting primitives into one
buffer is not: that is a draw-call decision owned by whoever draws, and
`@grafting/render-3d` already implements it as `mergeMeshChunks`. Producing
separate MeshPartsResource parts keeps this package from carrying a
second copy of that algorithm (`DEC-049`), and leaves per-part materials or
per-part culling possible later — which a pre-merged buffer would have
foreclosed.

**This first version brings geometry only.** Materials, textures and
animation clips are deliberately out: each becomes its own registered kind
later, without changing a single contract — the property open kinds were
chosen for.

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

### `function assets.createEncodedImageResolver(options: EncodedImageResolverOptions): ResourceResolver<"encoded-image">`

Loads an authored image the store did not create.

The counterpart to `inMemoryImageResolver`, which adopts an image a caller
already decoded. That one is right for a generated texture and is
deliberately zero-dependency; this one is what lets a consumer *declare* a
texture and acquire it, with the fetch, the decode, the abort handling and
the disposal all owned here instead of repeated at every call site.

Nothing about where images live is decided here. A definition names bytes or
a URL, and both arrive from a `CatalogSource` the consumer supplies -- which
is what makes this work for asset binaries that are never committed.

### `function assets.resourceRef(value: string): ResourceRef<TKind>`

Brands a plain string as a resource reference.

The one place the brand is applied. Callers building refs from a manifest go
through here rather than casting, so the cast exists once and is reviewable.
