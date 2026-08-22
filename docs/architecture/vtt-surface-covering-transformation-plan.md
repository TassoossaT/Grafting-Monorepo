# VTT surface covering: transformation plan

- Plan date: 2026-08-21
- Status: **proposed transformation plan, uncommitted.** Closes no decision,
  adopts no dependency, and is not an ADR. It describes how to move the code
  that exists today toward the `Asset` layer `ADR-0022` already accepted.
- Authority preserved: `DEC-049`, `DEC-051`, `DEC-052`, `DEC-060`,
  `ADR-0011`, `ADR-0013`, `ADR-0014`, `ADR-0022`, `ADR-0023`.
- Relationship to existing research: this document is the *how to get there
  from here* for `docs/research/vtt-procedural-geometric-surfacing.md` and
  `docs/research/vtt-asset-placeable-and-assembly-architecture.md`. Those
  describe the target model; neither describes migrating the current
  always-rendered surface chunk into it. That gap is this document's whole
  subject.

## 1. The constraint that produced this plan

Owner direction, verbatim: *"Eu não quero renderizar a superfície por trás...
uma porta seria uma superfície, porém eu poderia fazer uma porta com buraco,
uma porta de grades, se tiver uma superfície renderizada atrás de fato eu
perderia a visão, o ideal seria ser tipo uma região de desenho, mas se eu
fizer tipo um desenho 2D por cima, uma textura e etc, aí sim valeria a pena
desenhar ela."*

This rejects the "backing/mortar surface" recommendation in
`vtt-procedural-geometric-surfacing.md` §5.3 as a *default*. That section
assumed masonry, where a visible backing behind the bricks is correct. It is
wrong for a barred gate, a pierced door, a lattice, a railing, or a window
frame — anything whose product meaning is *you can see through it*. A surface
drawn behind those would destroy the very thing the asset exists to express.

The correction is not "never draw the surface." It is: **drawing the surface
becomes one covering choice among several, never an automatic consequence of
the surface existing.** A painted/textured covering legitimately draws it,
because there the surface mesh *is* the canvas the drawing needs.

## 2. What changes, in one sentence

A `Surface` stops being something that is drawn and becomes a **region that
may be filled** — geometry that is canonical, pickable, and physical, but
visually empty until a covering says otherwise.

## 3. The model

Two records, deliberately separate.

### 3.1 Covering domain — canonical, invisible, product-neutral

**Renamed 2026-08-22** from `SurfaceRegion`, which collides with the real
`grafting_graph_core::SurfaceRegion` landed in #151. See
`vtt-covering-contracts.md` §3.1 — that existing type supplies the boundary
(outer loops + holes), so this concept is only the frame plus identity.

```text
CoveringDomain
  surfaceRef            stable node-set identity (unchanged, ADR-0022)
  polygon               the derived cycle geometry (unchanged)
  frame                 origin + U + V + N, anchored to nodes, not array order
  revision              bumps when polygon or frame changes
```

The region is what "região de desenho" means concretely: a bounded 2D domain
with a stable local coordinate frame, carried in 3D. It emits **no** visual
output on its own. It is the thing a covering is resolved *against*.

The frame is the load-bearing part and the part most easily gotten wrong. It
must be anchored to an explicit node/edge pair, never inferred from array
position or PCA — otherwise moving one node re-orients the whole pattern, and
a texture or brick bond visibly re-shuffles across an unrelated edit. This
requirement is already stated in `vtt-procedural-geometric-surfacing.md` §4;
it applies identically to the plain-texture case, which is why the frame
belongs to the region rather than to any one covering kind.

### 3.2 Covering — the app-owned binding that decides what is visible

```text
SurfaceCovering
  coveringRef
  targetSurfaceRefs[]   one or more coplanar siblings sharing one frame
  kind                  none | painted | instanced | (composed)
  parameters            kind-specific
  revision
```

Four kinds, and the whole point is that the region does not know which it got:

| Kind | Draws the surface mesh? | What it emits | Solves |
| --- | --- | --- | --- |
| `none` | no | nothing | the barred gate, the hole, the open doorway — full see-through, surface still exists |
| `painted` | **yes** | one mesh chunk with UVs + material/texture | the 2D drawing/texture case the owner explicitly wants drawn |
| `instanced` | no | prototype instances placed in the region's `(u,v)` domain | bricks, bars, planks, shingles — the geometry blocks |
| composed | depends on parts | union of the above | plaster wall *with* protruding bricks |

`none` is the default for any surface whose covering has not been chosen. This
is the inversion: today, absence of a decision means "draw a flat colored
chunk"; afterward it means "draw nothing."

The genericity the owner asked for lives exactly here: `CoveringDomain` carries
no covering vocabulary, and `render-3d` carries neither. A covering is app
policy over a neutral region, which is what keeps `ADR-0014` intact.

## 4. What already exists and is directly reusable

This is the part that makes the transformation smaller than it looks. **The
invisible region already exists in the code — it just is not used as a drawing
domain.**

`apps/vtt/src/adapters/rendering/map-surface-pick-scene-item.ts` already
builds, per surface, an item its own doc comment calls an *"Invisible pick
proxy retaining one canonical SurfaceRef per render item"*: its own layer
(`map-surface-picks`), its own visual kind, one item per `surfaceRef`, the
full surface mesh, and a material registered in
`render-3d-scene-adapter.ts` as `{ surface: "unlit", color: 0xffffff,
opacity: 0, doubleSided: true }`.

That is already `CoveringDomain` in everything but name and the missing frame.

`tabletop-runtime.ts`'s `#syncSurfaceChunks` already maintains **two
independent trails** from one surface change:

1. a **per-surface trail**, keyed by `surfaceRef`, carrying the whole mesh
   (`#upsertSurfacePickTarget` / `#removeSurfacePickTarget`);
2. a **spatial chunk trail**, keyed by chunk bucket, merging many surfaces'
   meshes into one buffer and losing per-surface identity.

Trail 1 is the region. Trail 2 is the covering output. The split this plan
needs is already the shape of the code; what is missing is that trail 2 is
currently unconditional and trail 1 is currently invisible-only.

Also already present and usable as-is:

- `MaterialDescriptor` supports `texture?: TextureSource`, `opacity`,
  `depthTest`, `depthWrite`, and `clippable` — enough for `painted` without
  touching `@grafting/render-3d`;
- `RenderLayerKey` already separates `"terrain"` from `"surface-picks"`;
- per-scope revisions and dependency-scoped invalidation already exist in the
  change envelope (`RenderDependencyRevision`).

## 5. What must change

| # | Where | Change |
| --- | --- | --- |
| 1 | `ports/scene-render-port.ts` | `RenderMapChunk` gains a covering identity. Today it carries `surfaceType`/`physical` only — presentation classification, no link back to a surface or a binding. It needs the covering/material key that produced it, so a chunk can be invalidated when a binding changes rather than when geometry changes. |
| 2 | `adapters/rendering/map-chunk-batching.ts` | Chunk key becomes `(spatialBucket × coveringKey)`, not `spatialBucket` alone. `mergeChunkBucket` currently takes `surfaceType`/`physical` **from the first member of the bucket**, so a bucket holding a wall and a terrain cell renders as whichever landed first. That is already latent incorrectness; it becomes a hard blocker the moment two surfaces in one bucket have different coverings. |
| 3 | `adapters/rendering/map-chunk-scene-item.ts` | `colorForSurfaceType` stops being the visual authority and becomes the fallback parameters of the default `painted` covering. The function survives; its role narrows. |
| 4 | `composition/tabletop/` | New covering resolver: `surfaceRef → SurfaceCovering`. Single decision point. Starts as a constant map reproducing today's colors exactly. |
| 5 | `tabletop-runtime.ts` `#syncSurfaceChunks` | Chunk emission becomes conditional on the resolved covering. `none` emits no chunk and removes any existing one. The pick/region trail stays unconditional. |
| 6 | `map-surface-pick-scene-item.ts` | Gains `depthWrite: false` (see §7 — this is a correctness fix, not a refactor) and, later, the stable frame. |
| 7 | `libs/domains/procgen/surface-mesh` (Rust) | `TriangulatedMesh { positions, normals, indices }` gains UVs derived from the region frame. Required by `painted`; must be Rust per `DEC-051`, not computed ad hoc in TypeScript. |
| 8 | `@grafting/render-3d` | Instance-set descriptor (`E4.3`). Required only by `instanced`; **not** required by phases 0–4 below. |

## 6. Phased transformation

Ordered so the earliest phases are behavior-preserving and the see-through
result the owner wants arrives before any asset pipeline exists.

### Phase 0 — introduce the decision point, change nothing visually

Add the covering resolver returning `{ kind: "painted", color:
colorForSurfaceType(...) }` for every surface. Route chunk construction
through it. Nothing on screen changes.

*Done when:* the app renders pixel-identically to today, and exactly one
function decides what a surface looks like.

### Phase 1 — make the region explicit

Promote the pick target to `CoveringDomain`: same per-surface trail, renamed,
plus the stable frame (origin/U/V/N anchored to two ordered nodes of the
cycle). Keep emitting it for every surface unconditionally.

*Done when:* every surface has a frame that survives a node move without
re-orienting, proven by a test that moves a node and asserts frame stability.

### Phase 2 — key chunks by covering

Change the chunk key to `(bucket × coveringKey)`. Fixes the first-member
classification bug in the same move.

*Done when:* a bucket containing a wall and a terrain cell produces two
chunks with correct classification each, and moving a node still rebuilds
only affected chunks.

### Phase 3 — enable `none`, and see through the door

Allow the resolver to return `none`; suppress chunk emission for it. Apply it
to one door surface.

*Done when:* the door surface is invisible, still pickable, still selectable,
still undoable, still reports `physical`, and **the geometry behind it is
visible** (see §7 before assuming this follows automatically).

This is the phase that delivers the owner's stated goal. It requires no asset
catalog, no instancing, no import pipeline, no Rust change.

### Phase 4 — `painted`

Add UVs in Rust from the region frame; extend the `painted` covering with a
texture parameter. First real "desenho 2D por cima."

*Done when:* a texture applied to a wall keeps its alignment across a node
move, and continues correctly across coplanar sibling surfaces around a door
opening rather than restarting per surface.

### Phase 5 — `instanced`

Only here do `E4.3` (generic instance-set in `render-3d`) and `E4.4` (Rust
dressing capability producing the instance plan) become prerequisites. The
barred gate stops being an empty hole and becomes actual bars.

*Done when:* the measured spike in `vtt-procedural-geometric-surfacing.md`
§11 passes.

## 7. Risk found in the current code — read before Phase 3

The invisible pick proxy is registered with `opacity: 0` and **no explicit
`depthWrite`**. `packages/render-3d/src/backend/three/build-visual.ts:180-182`
maps that to `transparent: (opacity ?? 1) < 1` and `depthWrite: depthWrite ??
true`. So the proxy is fully transparent **and still writes to the depth
buffer**.

Today that is harmless: the proxy coincides exactly with the visible chunk of
the same surface, so it occludes only what that chunk already occluded.

The moment Phase 3 removes the visible chunk, the invisible proxy remains —
still writing depth, in the exact place the door used to be. Depending on
draw order it can silently hide geometry behind it: the owner's original
complaint ("eu perderia a visão"), reproduced by an object that cannot be
seen. Debugging that from the symptom would be genuinely unpleasant.

**Mitigation, required in Phase 3:** set `depthWrite: false` on the pick/region
material, and verify see-through against real geometry positioned behind a
`none` surface — not against empty background, which would pass either way.

## 8. Invariants that must not break

1. `Surface` remains the canonical construction record (`ADR-0022`/`DEC-060`).
   A covering never stores node positions, a cycle, a triangulation, or a
   second authoritative mesh.
2. A covering change is a *presentation* change: it bumps the covering
   revision, never graph or surface revisions, and never invalidates unrelated
   surfaces.
3. Picking, selection, drag-to-move, undo/redo, and `physical` behave
   identically whether the covering is `none` or not. Invisible is not absent.
4. `@grafting/render-3d` gains no type, field, or special case named after a
   door, wall, brick, or covering kind (`ADR-0014`).
5. Layout/coverage/lattice math lands in Rust, never TypeScript (`DEC-051`).
6. Edit mode may render regions that play mode hides — see §9.1.

## 9. Open decisions

### 9.1 Does edit mode draw `none` regions? (recommend: yes)

If a `none` surface is invisible everywhere, you cannot see what you are
editing. The natural resolution — and it fits "região de desenho" precisely —
is that edit mode renders regions as a translucent overlay and play mode does
not. This is a per-view concern, and `render-3d` already supports per-view
layer selection (`View.setLayers`), so it costs no new engine capability.

### 9.2 What publishes vision blocking?

`ADR-0022` already assigns vision blocking to the asset layer, not to
`Surface`. A barred gate is the case that forces the issue: `physical` may be
true (blocks movement) while occlusion is near zero (you see through it). So
occlusion must be a covering-published fact, on a spectrum, not a bool on the
surface — but the fog-of-war/visibility contract
(`vtt-visibility-and-knowledge-contract.md`) has to agree before this is
settled. **Not resolved here.**

### 9.3 Remaining

3. Does a covering target one surface or a coplanar sibling group? (Phase 4
   needs the group; Phase 3 does not. Recommend modeling the group from the
   start to avoid re-cutting the contract.)
4. Where do coverings persist, and what is the default for a surface created
   by a generator that names no covering?
5. Does terrain get coverings too, or does it keep a permanent `painted`
   default? (Terrain must not silently become invisible when `none` becomes
   the default — an explicit migration default is required in Phase 3.)

## 10. How a wall actually becomes blocks

This section exists because the phases above describe *when* `instanced`
arrives without describing *what it does*. Owner question that produced it:
*"Ainda não entendi como seria a geração 3d dos assets e a substituição das
paredes, como isso seria feito? onde viveria isso?"*

### 10.1 Nothing is substituted

"Replacing the wall with an asset" is the wrong mental model for the
repeating case, and the wrong model is what makes the rest confusing.

The wall is **not** swapped for a wall model. The wall becomes the *domain* in
which many copies of a much smaller unit are placed. A brick knows nothing
about walls; a wall knows nothing about bricks. The only thing connecting them
is a rectangle test in a 2D coordinate system.

Once the wall is the domain rather than the drawing, the reactive behavior
follows for free: move a node → the polygon changes → the placement list is
recomputed → the bricks reorganize. Nothing was "replaced," so nothing has to
be re-replaced.

### 10.2 Where the asset's 3D geometry comes from

Three independent origins, routinely conflated:

| Origin | What it is | When |
| --- | --- | --- |
| **Parametric primitive** | A brick *is* `{ shape: "box", width, height, depth }`. No file, no import, no modeling. `@grafting/render-3d` already supports this shape today. | First slice. |
| **Authored file** | A `.glb` modeled in Blender or taken from a CC0 pack (Kenney/KayKit are already the registry's leading candidates), imported and normalized behind an adapter. | `E4.9`. |
| **Procedurally generated mesh** | Rust generates the brick's vertices — chamfers, wear, per-instance shape variation. | Later, if measured to be worth it. |

The first slice must use the primitive. A box with mortar gaps already
produces a convincing brick wall at normal camera distance, and it removes
import, licensing, normalization, and disposal from the critical path of
proving the architecture. "Generating the 3D asset" is, at the start, not
generating anything: it is declaring a box.

### 10.3 The algorithm, end to end

Given one wall surface and one unit definition:

1. Resolve the surface's node cycle to world positions — already implemented.
2. Take the region's stable frame: origin `O`, in-plane axes `U`/`V`, normal
   `N` (§3.1).
3. Project every polygon vertex into `(u, v)`. The wall is now a flat 2D
   polygon, whatever its 3D orientation.
4. From unit size, joint size, and bond rule, generate a lattice of candidate
   centers over the polygon's `(u, v)` bounds — for running bond, every odd
   course is offset by half a unit.
5. Classify each candidate's footprint rectangle against the polygon:
   fully inside → accept; fully outside → discard; crossing the border →
   apply the boundary policy (drop, clip, or substitute a trim piece).
6. Map each accepted center back to 3D:
   `position = O + u·U + v·V + offset·N`, with the rotation that aligns the
   unit's local frame to `(U, V, N)`.
7. Apply seeded variation — which geometry variant, small rotation jitter,
   color shift — from a deterministic PRNG so the same seed always rebuilds
   the same wall.
8. Partition results by spatial chunk and by prototype, producing the
   instance plan.

Steps 3–5 are why the frame must be stable. If the frame is derived from array
order or PCA, step 4's lattice re-anchors on any node move and every brick
jumps.

### 10.4 What crosses each boundary — and a blocker

The output of step 8 is **a list of transforms, not geometry**. One thousand
bricks is one box plus one thousand placements — never one thousand meshes.
That is the entire reason `E4.3`'s instance-set is a prerequisite: without it
the only way to draw them is `mergeMeshChunks`, which copies the box's
vertices a thousand times into one buffer.

```text
Rust  →  app :  InstancePlan { prototypeId, chunks[ { chunkId, transforms, variants, bounds } ] }
app   →  r3d :  { instance-set, prototype: Geometry+Material descriptors, transforms }
```

**Blocker found in the current code.** Every value crossing the Wasm boundary
today is serialized as a JSON string: `construction-wasm`'s `editing.rs` notes
that `session.rs`'s `#[wasm_bindgen]` methods are the only place a `String`
becomes a `JsValue`, and the TypeScript adapter reads mesh positions as
`readonly number[]` before converting with `Float32Array.from(...)`
(`construction-session-wasm-adapter.ts:130-142`). That is fine for a polygon
with a handful of vertices. It is not fine for an instance plan: a thousand
bricks at sixteen floats each is sixteen thousand numbers through
`JSON.parse`, per rebuild, per edit.

The instance plan therefore needs a different transport than the one every
existing call uses — a typed-array view over Wasm memory rather than a JSON
round-trip. This is a real, currently-unbudgeted piece of work, and it is
easier to accept now than to discover during Phase 5.

### 10.5 Where each step lives

| Step | Home | Rule that puts it there |
| --- | --- | --- |
| Nodes, cycles, surface identity | `libs/graph/core` + `construction-wasm` | exists today |
| Polygon triangulation | `libs/domains/procgen/surface-mesh` | exists today |
| Frame, `(u,v)` projection, lattice/bond, coverage test, boundary policy, seeded variation, instance plan (steps 2–8) | **new Rust crate**, e.g. `libs/domains/procgen/surface-dressing` | `DEC-051`/`ADR-0013` — reusable layout math is Rust, never TypeScript |
| Wasm exposure of that crate | colocated `*-wasm` binding | `ADR-0017` |
| Unit definition: dimensions, prototype, variants, provenance | asset catalog — app fixture first, extracted to a package once it outgrows one app | `ADR-0014` — generic capability, no product vocabulary |
| *Which* asset dresses *which* wall | `apps/vtt` covering binding (§3.2) | product policy stays in the app |
| Drawing N instances of one prototype | `@grafting/render-3d` instance-set (`E4.3`) | `ADR-0014` — the engine must not learn the word "brick" |

Read top to bottom, that is the answer to "onde viveria isso": the math in a
new Rust crate, the content in a catalog, the choice in the app, the drawing
in the renderer. No single package owns the feature, and that is deliberate.

### 10.6 `fit` — the case that *is* a substitution

The other mode is the literal one, and it is much simpler: a specific door,
one asset, scaled to the surface's resolved dimensions. No lattice, no
coverage test, no bond. Take the polygon's extents in `(u, v)`, compute one
transform, emit one instance.

`fit` is `instanced` with N = 1, which is worth stating explicitly: it needs
no separate pipeline, and it is the cheapest possible first proof that the
region → covering → instance path works end to end, before any repetition
math exists.

## 11. References

- `docs/architecture/vtt-covering-contracts.md` — the concrete shapes this
  plan converges on, and the substitution matrix for each future swap
- `docs/adr/ADR-0022-wall-representation-free-geometry.md` — the accepted
  Graph → Mesh → Surface → Cloud → Asset layering
- `docs/adr/ADR-0023-vtt-application-architecture.md` — slice and port rules
- `docs/research/vtt-procedural-geometric-surfacing.md` — target model for
  `instanced`, pattern frame, boundary policy, LOD
- `docs/research/vtt-asset-placeable-and-assembly-architecture.md` — asset
  definition, ingestion, binding, revision scopes
- `docs/architecture/vtt-rendering-runtime-contract.md` — change envelope,
  dependency-scoped invalidation, view lifecycle
- `docs/architecture/vtt-roadmap.md` — Epic 4 (`E4.1`–`E4.9`)
