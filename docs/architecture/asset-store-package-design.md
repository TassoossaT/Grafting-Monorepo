# `@grafting/assets`: a product-agnostic resource store

- Plan date: 2026-08-21
- Status: **proposed package design, uncommitted.** No package exists yet, no
  API is accepted, and this is not an ADR. Names are provisional.
- Companion to `docs/architecture/vtt-covering-contracts.md` (which consumes
  this package) and `vtt-surface-covering-transformation-plan.md`.
- Authority preserved: `DEC-049`, `DEC-051`, `DEC-052`, `ADR-0011`,
  `ADR-0014`, `ADR-0017`, `ADR-0023`.

## 1. Why this is a package and not app code

The root `AGENTS.md` settles it directly: a generic, product-agnostic
capability must not be hand-rolled inside an app, packages "MAY be created
freely whenever a genuinely reusable capability emerges," and "the test is
whether the thing has any product meaning baked in, not how many callers it
currently has."

Loading a mesh, decoding a texture, caching it under a stable identity,
reference-counting it, and disposing it deterministically has no VTT meaning
whatsoever. It is the same problem for a map editor, a character viewer, an
architecture-studio lab trial, or a product that does not exist yet.

The rule that *does* still bind (`S4.3`, `DEC-028`): the package is created
together with its first working implementation, never as an empty tree
scaffolded in advance.

## 2. Scope

**In:** resource identity, definitions and provenance, format-agnostic
resolution, load state, caching, reference counting, deterministic disposal,
and an inventory for diagnosing what is loaded and why.

**Out:** rendering, GPU resources, scene concepts, layout math, format
parsers, and every product vocabulary — brick, wall, token, door.

The package answers *"what content exists, is it loaded, and who is holding
it"*. It never answers *"how is it drawn"*.

That one sentence resolves the three cases most likely to be pushed into it:

| Case | Belongs here | Does not |
| --- | --- | --- |
| Textures / images | declaration, decode, cache, refcount, disposal | filtering, mipmaps, GPU upload, atlasing |
| Object replication | the *prototype* — one brick's mesh, held once | the repetition. Placements live on `VisualDescriptor` and batching is the backend's choice; the store never learns there are a thousand |
| Effects | the effect's *content* — sprite sheet, noise texture, gradient, curve | the effect's *behavior* — shaders, blending, particle simulation, timing |

`docs/research/asset-management-prior-art.md` §3.4 records what happened to
Babylon.js's `AssetContainer` when this line was not held: it knows about
scenes, which makes it unusable by any consumer with a different scene model.
That is the failure this package's `AGENTS.md` must name explicitly, in the
voice `@grafting/render-3d`'s already uses ("what must not enter this
package").

## 3. One package, not three

Meshes, textures, and materials look like three subsystems and are not. Each
one is: an opaque id, a definition, an asynchronous load that can fail, a
cached result, holders, and a disposal path. That shared shape *is* the
package; the three resource types are vocabulary on top of it.

Splitting them would triple the lifecycle code and still leave the hard part —
a material referencing textures that must outlive it — spread across package
boundaries with no owner.

What genuinely does split off is **format parsing**, because that is where
vendor dependencies live (`ADR-0011`). The core ships **zero runtime
dependencies**; a glTF loader arrives later as a registered resolver, in its
own package or an app adapter, and the core never learns it exists.

## 4. The three concepts

### 4.1 Resource — what is held

```ts
type ResourceKind = string;   // open, never a union (see contracts doc, rule 2)

/** Geometry, structurally independent of any renderer. */
interface MeshResource {
  readonly positions: Float32Array;
  readonly normals?: Float32Array;
  readonly uvs?: Float32Array;
  readonly indices?: Uint16Array | Uint32Array;
  readonly bounds: Aabb;
}

/**
 * An image ready for a renderer to consume. Two forms, because a compressed
 * GPU texture is not a decoded bitmap and never becomes one.
 */
type ImageResource =
  | {
      readonly form: "decoded";
      readonly source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
      readonly width: number;
      readonly height: number;
      readonly colorSpace: "srgb" | "linear";
    }
  | {
      readonly form: "compressed";
      readonly format: string;        // GPU format id, e.g. "bc7-rgba-unorm"
      readonly levels: readonly { data: Uint8Array; width: number; height: number }[];
    };

```

**There is deliberately no `MaterialResource` in the core.** Decided
2026-08-21; an earlier revision of this document defined one with
`baseColor`/`roughness`/`metalness` fields. Two reasons it was wrong:

1. **It bakes in a shading model.** `roughness`/`metalness` is PBR
   metallic-roughness — one convention among several (specular-glossiness,
   toon, unlit). A store that names those fields has quietly bet on the
   renderer it claims not to know about, which is the exact coupling §7 exists
   to prevent.
2. **A material is not a resource.** This package manages things that load
   asynchronously, can fail, occupy memory, and must be disposed. An image is
   all four. A material is a handful of numbers plus references — it has no
   load, no failure mode, no bytes, and nothing to dispose. Reference-counting
   it is ceremony around data that was never scarce.

What is scarce is the **image**. That stays a first-class resource.

A material is therefore a *registered kind*, like everything else: a consumer
that wants PBR materials registers a resolver for `"pbr-material"` with its own
strongly-typed resource shape, and the core never learns the vocabulary. The
package may ship one such resolver as a **replaceable default** — the same
posture `@grafting/render-3d`'s own `AGENTS.md` takes toward defaults
("a replaceable default with a neutral value, never a product's look") — but it
lives in `src/resolvers/`, not in `src/contracts/`.

The practical consequence for a consumer: `acquire(materialRef)` still works
and still transitively acquires the material's images, because the material
resolver acquires them during its own `load`. Grouping is preserved; the
shading vocabulary is not imposed.

### 4.2 Definition — what is declared

```ts
interface AssetDefinition<TKind extends ResourceKind = ResourceKind> {
  readonly ref: ResourceRef<TKind>;
  readonly kind: TKind;
  readonly revision: number;
  /** Resolver-specific input: a URL, packed bytes, primitive params, anything. */
  readonly source: unknown;
  /** Layout metadata only — never collision, physics, or vision. */
  readonly dimensions?: Vec3;
  readonly provenance: AssetProvenance;
}

interface AssetProvenance {
  readonly origin: string;        // pack name, author, or "generated"
  readonly license: string;       // SPDX id where one applies
  readonly attribution?: string;
  readonly url?: string;
}
```

`provenance` is required, not optional. The repository already tracks CC0
licensing per candidate pack in its research registry and enforces
`THIRD_PARTY_NOTICES.md` with a check; making attribution structurally
unskippable is cheaper than auditing it later.

### 4.3 Resolver — how a definition becomes a resource

```ts
interface ResourceResolver<TKind extends ResourceKind, TResource> {
  readonly kind: TKind;
  load(definition: AssetDefinition<TKind>, signal: AbortSignal): Promise<TResource>;
  /** Releases anything `load` allocated outside the JS heap. */
  dispose?(resource: TResource): void;
}
```

Same registration pattern as `VisualRegistry` and the covering registry — one
mechanism, reused for the third time, rather than a third way of doing the
same thing. A parametric box, a decoded `.glb`, a canvas-generated texture,
and a procedurally generated mesh are four resolvers behind one opaque ref.

## 5. Typing: refs that cannot be mixed up

```ts
declare const kindBrand: unique symbol;

/** An opaque identity. Never a URL, path, or index (contracts doc, rule 1). */
type ResourceRef<TKind extends ResourceKind> = string & {
  readonly [kindBrand]: TKind;
};

type MeshRef = ResourceRef<"mesh">;
type ImageRef = ResourceRef<"image">;
// "material" is not a core kind (§4.1) — a consumer that registers one gets
// its own ref type from the same generic, with no change to this package.
```

A branded string costs nothing at runtime and makes passing an `ImageRef`
where a `MeshRef` is expected a compile error. Since every ref is a string on
the wire, this is exactly the case where the type system has to carry the
distinction the data cannot.

The store is typed through the same parameter, so `acquire(meshRef)` returns a
handle to a `MeshResource` with no cast at the call site:

```ts
interface AssetStore {
  define(definition: AssetDefinition): void;
  registerResolver<TKind extends ResourceKind, TResource>(
    resolver: ResourceResolver<TKind, TResource>,
  ): void;

  /** Strong: holds the resource loaded until released. */
  acquire<TKind extends ResourceKind>(
    ref: ResourceRef<TKind>,
  ): ResourceHandle<ResourceOf<TKind>>;

  /**
   * Weak: reads a definition's metadata without loading anything and without
   * keeping anything loaded. Adopted from Bevy's strong/weak handle split —
   * a layout that needs only a unit's `dimensions` must not thereby pin its
   * mesh in memory. See `docs/research/asset-management-prior-art.md` §3.2.
   */
  peek(ref: ResourceRef<ResourceKind>): AssetDefinition | undefined;

  status(ref: ResourceRef<ResourceKind>): ResourceStatus;
  inventory(): readonly InventoryEntry[];
  observe(listener: (event: StoreEvent) => void): () => void;
}
```

`ResourceOf<TKind>` is a resolvable map (`"mesh" → MeshResource`, and so on)
that a consumer can widen by declaration merging when it registers a resolver
for a kind this package never heard of — which is what keeps the kind string
genuinely open rather than open-in-name-only.

## 6. Lifecycle: the part that makes it manageable

The three failures that make asset code miserable are loading the same thing
twice, leaking what is no longer used, and disposing something still in use.
All three are the same missing thing: nobody knows who holds what.

```ts
interface ResourceHandle<TResource> {
  readonly ref: ResourceRef<ResourceKind>;
  readonly revision: number;
  /** The resource if ready, `undefined` while loading or failed. Never throws. */
  current(): TResource | undefined;
  whenReady(): Promise<TResource>;
  /** Drops this holder's claim. Idempotent. */
  release(): void;
}

type ResourceStatus =
  | { readonly state: "undeclared" }
  | { readonly state: "idle" }
  | { readonly state: "loading"; readonly holders: number }
  | { readonly state: "ready"; readonly revision: number; readonly holders: number; readonly bytes?: number }
  | { readonly state: "failed"; readonly error: string; readonly attempts: number };
```

Rules the store enforces:

- `acquire` on an already-loading ref joins that load. One in-flight load per
  `(ref, revision)`, never two.
- A resource is disposed when its holder count reaches zero, through the
  resolver's own `dispose`. Retention policy (dispose immediately, or keep an
  LRU window) is store configuration, not a per-call decision.
- A definition whose `revision` changes loads as a distinct entry. Existing
  handles keep serving the old revision until released, so a live scene never
  blinks mid-frame.
- A failed load is recorded with its attempt count and does not retry in a
  loop. Retrying is the caller's explicit decision.

`inventory()` is the diagnostic this exists for: every declared ref, its state,
holders, revision, and byte estimate. It is what turns "the app is leaking
textures" from a bisect into a table.

## 7. Why this package does not import `@grafting/render-3d`

It would be tempting — `MeshResource` and `MeshData` are structurally almost
identical, and `ImageResource.source` is exactly `TextureSource`.

The repository has already made this decision in the other direction and
documented it: `apps/vtt/src/ports/scene-render-port.ts` defines its own
`RenderMeshData` with the comment that it is *"Defined locally rather than
imported from `@grafting/render-3d`, matching how `RenderToken` already keeps
this port renderer-agnostic."*

The same reasoning applies with more force here. A catalog that imports the
renderer can only be used by consumers that already use that renderer, which
destroys the reuse this package exists for. The structural duplication is a
few interface declarations; the coupling would be permanent.

The consumer performs the translation — three or four field copies, in the
app, where both vocabularies are legitimately known.

## 8. Package structure

```text
packages/assets/
  AGENTS.md            scope-local rules (every package here has one)
  README.md
  package.json         @grafting/assets, private, type: module, exports dist
  project.json         tags, graphIr metadata, publicApi metadata, targets
  tsconfig.json        copy of render-3d's, rootDir src, outDir dist
  src/
    index.ts           the only public entry point
    contracts/         ref.ts, resource.ts, definition.ts, resolver.ts, store.ts
    store/create-store.ts
    resolvers/         primitive mesh + canvas image (zero-dependency defaults)
  tests/
    *.test.mjs
    snapshots/public-api.md
```

`project.json` needs, at minimum:

```jsonc
{
  "name": "assets",
  "root": "packages/assets",
  "projectType": "library",
  "tags": ["scope:shared", "lang:typescript", "platform:web", "type:lib"],
  "metadata": {
    "graphIr": { "id": "assets", "kind": "lib", "tags": ["scope:shared", "lang:typescript"] },
    "publicApi": {
      "entryPoint": "src/index.ts",
      "baseline": "tests/snapshots/public-api.md",
      "forbiddenModules": []          // grows when a vendor loader is added
    }
  },
  "targets": { /* check, build, test, api-check, docs-generate, docs-check */ }
}
```

Both `generate-api-docs.mjs` and `check-typescript-public-api.mjs` discover
projects by scanning for a `project.json` carrying `lang:typescript` and
`metadata.publicApi.entryPoint`. Getting that block right is the whole
registration — there is no central list to edit.

## 9. How to create it

Non-Markdown files, so this needs a task worktree — unlike the planning docs.

1. `.\ia-graft.cmd task new --id <TASK-ID>`
2. Create the files above inside `.worktrees/<TASK-ID>/`. `pnpm-workspace.yaml`
   already globs `packages/*`, so no workspace edit is needed.
3. Dependencies (there should be none at runtime; TypeScript is a dev
   dependency) through `ia-graft task deps`, never a direct install.
4. Generate the API baseline: `UPDATE_SNAPSHOTS=1 node
   tools/scripts/check-typescript-public-api.mjs packages/assets`.
5. Verify: `pnpm exec nx run assets:check`, `assets:test`, `assets:api-check`.
6. Regenerate docs and Graph IR — a new project changes repo topology:
   `pnpm run docs:generate`, then `pnpm run docs:check`.
7. Run the `docs-quality-check` skill on the generated
   `docs/generated/api/ts/assets.api.md`.

Every exported declaration needs TSDoc: the generated baseline states the
policy ("every exported declaration and public member requires TSDoc") and the
docs quality check looks at the undocumented-header ratio.

Ship it with its first real implementation in the same task — the primitive
mesh resolver and the canvas image resolver are enough, and both are
zero-dependency. That satisfies `S4.3` while still creating the package now.

## 10. What is deliberately left out

- **No format parser in the core.** glTF, KTX2, and Basis arrive as registered
  resolvers, each with its vendor confined to its own module or package
  (`ADR-0011`). Adding one to the core would make every consumer pay for a
  decoder it may never call.
- **No GPU concept.** Upload, texture compression, and mipmaps belong to the
  renderer. This package hands over decoded CPU-side data and stops.
- **No asset authoring or editing.** Read, cache, dispose. Authoring is a
  product feature.
- **No network policy.** A resolver may fetch; retry, auth, and CDN selection
  are the resolver's business, not the store's.
- **No bundling/atlasing.** Packing several images into an atlas is a renderer
  or build-time optimization that needs measurements first.

## 11. Open decisions

1. ~~**Package name.**~~ **Decided 2026-08-21 by the owner: `@grafting/assets`**
   — chosen for being simpler and more direct. Scope creep is held back by §2
   and §10, not by the name.
2. **`ResourceOf<TKind>` extensibility mechanism** — declaration merging is the
   zero-cost option but is easy to get wrong; an explicit type parameter on the
   store is uglier and more obvious. Needs one experiment before committing.
3. ~~**Retention policy default.**~~ **Decided 2026-08-21: configurable from
   the start, defaulting to immediate disposal at zero holders.** The choice is
   what happens to decoded bytes when the last holder releases — free them now
   (predictable memory, but re-acquiring pays a full reload) or keep them in a
   bounded not-recently-used window (undo/redo and asset A↔B toggling become
   instant, at the cost of a memory tail that is harder to predict, which is
   what breaks first on a weak GPU). Immediate wins as a default because no
   measurement exists yet. Making it `createStore({ retention })` from day one
   means switching later touches no consumer — the same replaceability rule
   the rest of this design follows.
4. **Byte accounting** — measured, estimated, or resolver-reported? Only
   resolver-reported is honest for decoded images, but it makes `bytes`
   optional forever.
5. ~~**Does `MaterialResource` belong here?**~~ **Decided 2026-08-21: no.** See
   §4.1 — a material imposes a shading model and is not a scarce resource. It
   becomes a registered kind with an optional shipped resolver.

## 12. Unversioned assets — the deployment constraint

Owner direction, 2026-08-22: asset binaries will **not** be committed to git,
and the package must support that without hardcoding anything.

### 12.1 What this confirms

Three rules already in the design exist precisely for this, and now have a
concrete reason rather than a stylistic one:

- **`ResourceRef` is opaque — never a URL or path** (§5). A ref that embedded a
  path would hardcode a location, which is exactly what cannot happen here.
- **Resolvers are registered from outside** (§4.3). The package never learns
  where bytes come from, so a local folder, a CDN, IndexedDB, and a procedural
  generator are all the same to it.
- **Zero runtime dependencies, no parser in the core** (§3). Nothing in the
  package reaches for a file.

`AssetDefinition.source` is typed `unknown` and interpreted only by the
resolver — a URL, a storage key, a set of primitive parameters. That field is
the whole extension point for "where does this live," and it needs no change.

### 12.2 The piece that is missing: where the *list* comes from

If the binaries are not in the repo, the **list of which assets exist** cannot
be in the code either — otherwise the hardcoding just moves from the bytes to
the catalog. `store.define(definition)` exists, but nothing yet says who calls
it.

That needs one more registration point:

```ts
/** Produces the definitions available in an environment. Registered, like resolvers. */
interface CatalogSource {
  readonly id: string;
  list(signal: AbortSignal): Promise<readonly AssetDefinition[]>;
}
```

A manifest fetched over HTTP, a scan of a dev folder, a read from IndexedDB,
and a fixed array in a test are four implementations of one interface. The
package ships none of them.

### 12.3 Version the metadata, not the bytes

These are separable, and separating them is the recommendation:

| | In git | Why |
| --- | --- | --- |
| Asset binaries (`.glb`, textures) | **no** | size, and the owner's decision |
| The manifest (refs, revisions, dimensions, provenance, hashes) | **yes** | small text; makes builds reproducible and license review possible |

This matters beyond tidiness. `THIRD_PARTY_NOTICES.md` has an enforced check,
and attribution obligations do not disappear because a file is fetched at
runtime rather than committed. A versioned manifest carrying `provenance`
(§4.2) satisfies that without a single binary in the repo — and it is the
answer to how the Gumroad-style licensing question stays reviewable.

A content hash per asset is optional but cheap, and it is the only thing that
makes "asset X, revision 2" verifiable rather than a promise.

### 12.4 A missing asset is a normal state, not an error

If binaries live outside the repo, a fresh clone has none. The app must still
run, tests must not fetch, and CI must not depend on external hosts.

This promotes something already in the design from convenience to requirement:
**the parametric primitive resolver (§9) is the permanent fallback**, not just
the cheapest starting point. A box is always available, needs no file, and
keeps the repo self-sufficient.

Required behavior:

- an unresolvable ref reports `{ state: "failed" }` and the consumer falls back
  — it never throws into the render loop;
- a covering whose asset is missing degrades to a primitive or to `none`, both
  of which already exist as first-class states;
- no test and no CI job depends on an asset that is not generated in-process.

Absence being ordinary is what makes an unversioned pipeline survivable.

## 13. References

- `docs/architecture/vtt-covering-contracts.md` — the consumer contracts,
  including `PrototypeResolver`, which this package's resolver mechanism
  replaces
- `AGENTS.md` — the package-creation rule quoted in §1
- `docs/adr/ADR-0014-composable-capability-packages.md` — no product concepts
  in capability packages
- `docs/adr/ADR-0011-package-autonomy-and-external-isolation.md` — vendor
  isolation, which §3 and §10 apply to format parsers
- `packages/render-3d/` — the structural template for a package here
- `apps/vtt/src/ports/scene-render-port.ts` — the renderer-agnostic
  duplication precedent cited in §7
