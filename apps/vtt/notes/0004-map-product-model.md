# Note 0004 — Map product model (`E3.6`)

- Recorded: 2026-08-12
- Status: implemented; the decisions below are the ones a later slice
  (`E3.7`) needs and should not re-derive from scratch
- Source: `E3.6` task (`VTT-MAP-PRODUCT-MODEL`), the second task of
  `docs/architecture/vtt-roadmap.md`'s Epic 3.5

This is a decisions record, not a defect log like [0001](0001-rendering-and-propagation.md).

## The gap this task closed

Note [0003](0003-map-render-pipeline.md) found that nothing in the Rust
workspace turned a `Surface`'s node cycle into a triangulated mesh --
`ConstructionSession::snapshot_json()` exposed only an unordered node-id set
per surface, never positions or a real mesh. This task closed that gap with
a new isolated crate, `grafting-procgen-surface-mesh`
(`libs/domains/procgen/surface-mesh`), and two new `ConstructionSession`
methods (`all_surface_meshes_json`, `surface_mesh_json`) that call it. Only
then did `apps/vtt`'s own map product model and composition-root wiring
become possible.

## Decisions

**Mesh triangulation uses the `earcut` crate, not a hand-rolled ear-clipper.**
`ADR-0022` requires arbitrary (non-convex) polygon support, which a triangle
fan cannot give correctly. `earcut`'s `utils3d::project3d_to_2d` also does
the 3D-coplanar-to-2D projection step, so no manual Newell's-method/basis
code was needed either. License is `MIT OR Apache-2.0`, matching this
repo's existing convention (`libs/graph/core/Cargo.toml`).

**No Worker boundary yet.** `docs/architecture/vtt-rendering-runtime-contract.md`
§7's `BufferLease` pool contract is not implemented anywhere in `apps/vtt`,
and this task would have been the first Worker usage in the app. The
roadmap says construction is "likely" behind a Worker, not mandated.
`ConstructionSessionWasmAdapter` (`apps/vtt/src/adapters/construction/`)
therefore runs on the main thread: a `start(): Promise<void>` method loads
the Wasm module and constructs one `ConstructionSession`, after which every
other port method is synchronous, mirroring `SceneRenderPort`'s own
`start`/`dispose` lifecycle so the composition root awaits both the same
way. Moving this behind a Worker (with the buffer-lease pool the render
contract already specifies) is a fast-follow once `E3.7`'s interaction
latency actually demands it, not a v1 requirement.

**`ConstructionSessionPort` mirrors the entire `ConstructionSession` ABI**,
not only the generate-terrain-cell/generate-wall slice this task's own
runtime wiring calls. `move_node`/`delete_node`/`merge_surfaces`/
`split_surface`/`duplicate_surface` are already typed and implemented on the
adapter (`apps/vtt/src/adapters/construction/construction-session-wasm-adapter.ts`)
but have no operation/runtime wiring yet -- no feature builds an operation
for them, and the composition root never calls them. `E3.7` should wire
those directly against the existing port method, not rediscover or
re-shape the ABI boundary.

**`entities/map`'s `SurfaceRef` is not yet backed by true cycle order.**
`docs/architecture/vtt-product-model.md`'s `orderedNodeRefs` is meant to
"preserve canonical cycle order," but `grafting-procgen-construction-wasm`'s
wire format (`surfaceKey`, `dto::surface_key_to_wire`) sorts the node set
for identity purposes and never exposes `Surface::cycle()`'s actual order.
`MapProjection`/`SurfaceProjection` deliberately do not own mesh authority
(`VTT-PRODUCT-MODEL` invariant `I004`), so this does not affect rendering --
real triangulation happens entirely inside Rust using the real cycle order,
and only the final positions/normals/indices cross the Wasm boundary. But a
future consumer that needs the app to know true cycle order (not just node
membership) must extend the Wasm snapshot to expose it; `surfaceKey`'s
current sorted form is not that.

**Map chunk assembly lives in `adapters/rendering`, not composition.**
`apps/vtt/test/architecture-boundaries.test.mjs` only allows `@grafting/*`
package imports from the `adapters`/`ui` layers. Since bucketing surfaces
into spatial chunks and merging their meshes needs `@grafting/render-3d`'s
`mergeMeshChunks`/`Vec3`, that logic (`chunkSurfaceMeshes`,
`apps/vtt/src/adapters/rendering/map-chunk-batching.ts`) had to live in
`adapters`, called by the composition root -- not inlined into
`tabletop-runtime.ts` itself, which the boundary check would reject.

**One default-seeded terrain cell and wall-with-door per table**, built in
`composition/tabletop/default-map-seed.ts` and applied during
`AppTabletopRuntime.start()`, mirrors the existing guide-token seed. Every
seeded surface starts at revision 1 -- there is no earlier revision to
invalidate, since nothing in this task mutates an existing surface.

## Findings from the browser verification (2026-08-12)

Running `pnpm nx run vtt:dev` and opening a table confirmed the seeded
geometry actually reaches the renderer (the wall's chunk visibly draws as
a solid shape near the guide token) -- proving the whole
Rust-triangulation -> Wasm -> `chunkSurfaceMeshes` -> `SceneRenderPort`
chain works end to end, which is this epic's whole point. Two real gaps
surfaced that this task does not fix, left for whoever renders map
geometry next:

- **Every map chunk renders solid black.** `MAP_SURFACE_VISUAL_KIND`
  (`E3.5`) uses a `"lit"` material, but `Render3dSceneAdapter.start()`
  (`apps/vtt/src/adapters/rendering/render-3d-scene-adapter.ts`) never
  calls `createEngine`'s `lights` option or `RenderEngine.setLights` --
  `@grafting/render-3d`'s own contract doc says explicitly "the engine
  ships no default lighting rig of its own." Token visuals are `"unlit"`
  and never needed one, so nobody noticed until real `"lit"` geometry
  existed to look at. A `"lit"` material with zero configured lights has
  nothing to reflect, so it always draws black regardless of
  `colorForSurfaceType`. Fix: add at least one light (e.g. one ambient +
  one directional) in `Render3dSceneAdapter.start()`.
- **`PrismGridMesh`-sourced terrain likely renders in the wrong plane.**
  `PrismGridMesh::new` (`libs/graph/core/src/model.rs`) stacks layers
  along its own Z axis (`z_base = layer index`), with X/Y as the grid
  plane. `apps/vtt`'s render/camera convention -- and `map-chunk-key.ts`'s
  `chunkKeyFor`, which buckets by X/Z -- treats Y as vertical and X/Z as
  the ground plane. Nothing remaps between these two conventions today.
  The seeded wall (authored directly in `{x,y,z}` render-space
  coordinates in `default-map-seed.ts`, not derived from `PrismGridMesh`)
  is unaffected; a `generateTerrainCell` call's node positions, which
  come straight from `PrismGridMesh`, are not. This was not visually
  distinguishable from the missing-lights issue above during this
  session's verification (everything renders black either way) and needs
  its own follow-up investigation once lighting is fixed and the result
  can actually be seen. Whether the fix belongs in `PrismGridMesh`
  itself, in `terrain-generation`'s generation step, or in an explicit
  remap at the Wasm/TS boundary is an open question, not decided here.

## Non-goals carried forward

No pointer/edit-mode interaction (drag, tool selection, undo/redo) -- that
is `E3.7`. No Worker boundary (see above). No per-view independent clip
heights (unchanged from `E3.5`). No texture/material pipeline (`E4.2`).
