# `@grafting/assets`

A product-agnostic store for the content an application renders: meshes,
images, and whatever else a consumer teaches it about.

It owns **what content exists, whether it is loaded, and who is holding it**.
It owns nothing about how content is drawn.

## Why it exists

Three failures make asset code miserable, and they are all the same missing
fact — nobody knows who holds what:

- **loading the same thing twice**, so one texture occupies memory twice;
- **leaking**, because WebGL resources are not garbage collected and the
  browser only cleans up when the page goes away;
- **disposing too early**, freeing something another consumer still draws.

Disposal in particular is harder than it looks: three.js's `Texture.dispose()`
does not close the underlying `ImageBitmap`, so textures decoded from `.glb`
leak despite disposal that reads as correct
([mrdoob/three.js#23953](https://github.com/mrdoob/three.js/issues/23953)).
That fix is one line — in one place. This package is that place.

The design follows shipped prior art rather than invention: Godot's
reference-counted `Resource` plus a `ResourceLoader` that dispatches to
registered per-format loaders, and Bevy's strong/weak handle split. See
`docs/research/asset-management-prior-art.md`.

## Usage

```ts
import {
  createAssetStore,
  primitiveMeshResolver,
  PRIMITIVE_MESH_KIND,
  resourceRef,
} from "@grafting/assets";

const store = createAssetStore();
store.registerResolver(primitiveMeshResolver);

const brick = resourceRef<typeof PRIMITIVE_MESH_KIND>("unit/brick");
store.define({
  ref: brick,
  kind: PRIMITIVE_MESH_KIND,
  revision: 1,
  source: { shape: "box", width: 0.2, height: 0.1, depth: 0.1 },
  dimensions: { x: 0.2, y: 0.1, z: 0.1 },
  provenance: { origin: "generated", license: "NONE" },
});

const handle = store.acquire(brick);
const mesh = await handle.whenReady();
// ... draw it ...
handle.release(); // disposed once nothing else holds it
```

Reading metadata without loading anything, and without keeping anything
loaded — a layout that needs only a size must not pin a mesh in memory:

```ts
const size = store.peek(brick)?.dimensions;
```

Finding a leak:

```ts
console.table(store.inventory());
// ref, kind, and status: undeclared | idle | loading | ready | failed,
// with holder counts and reported bytes
```

## Extending it

Everything this package does not know arrives by registration.

- **A new format** is a `ResourceResolver`: `{ kind, load, dispose?, sizeOf? }`.
  A glTF resolver, a KTX2 resolver and a procedural generator are all this
  shape. Vendor dependencies stay inside the resolver's own module.
- **A new place content lives** is a `CatalogSource`: `{ id, list }`. An HTTP
  manifest, an IndexedDB read, a development folder scan, and a fixed array in
  a test are four implementations.
- **A new resource type** is a kind plus, optionally, a `ResourceKinds`
  declaration-merge so `acquire` returns it typed.

## Shipped resolvers

- **`primitiveMeshResolver`** — a box or plane from parameters, with no file
  and no dependency. The permanent fallback when a real asset is missing, not
  merely a starting point: asset binaries are not versioned in this repository,
  so a fresh clone has none and CI must not reach for an external host.
  Something has to be loadable from code alone.
- **`inMemoryImageResolver`** — adopts an already-decoded image and takes over
  closing it. Also zero-dependency.
- **`gltfMeshResolver`** — authored geometry from a glTF 2.0 asset, by bytes or
  URL. Uses `@gltf-transform/core` rather than three's `GLTFLoader`, because it
  needs no renderer; a store that imported one would only be usable by
  consumers that had already chosen it.

Only the glTF resolver carries a dependency, and only consumers that import it
pay for the parser — `sideEffects: false` and ESM let a bundler drop both.

## Retention

By default a resource is disposed as soon as its last holder releases: memory
in use is exactly memory held, which is the predictable behaviour to have
before any measurement exists. `createAssetStore({ retention: { kind:
"least-recently-used", maxBytes } })` keeps unheld resources around instead,
making re-acquisition instant at the cost of a memory tail. Switching is a
store option, so it touches no consumer.
