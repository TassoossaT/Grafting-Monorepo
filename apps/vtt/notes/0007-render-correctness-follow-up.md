# Note 0007 — Render-correctness follow-up (`E3.9`)

- Recorded: 2026-08-12
- Status: implemented
- Source: `E3.9` task (`VTT-RENDER-CORRECTNESS`), the roadmap's own two-item
  follow-up from `E3.8`'s note
  [0006](0006-e2e-validation-slice.md#non-goals-carried-forward), itself
  sourced from [0004](0004-map-product-model.md)'s originally-documented gaps

This is a defect log like [0001](0001-rendering-and-propagation.md)/[0006](0006-e2e-validation-slice.md),
not a decisions record like [0004](0004-map-product-model.md)/[0005](0005-edit-mode-interaction.md).

## Gap 1 — no lighting configured

`Render3dSceneAdapter.start()` called `createEngine({ registry, autoplay: true })`
with no `lights` option. `packages/render-3d`'s own contract is explicit that
the engine "ships no default lighting rig of its own" (`EngineOptions.lights`'s
doc comment) -- every `"lit"`-material item (map surfaces: walls, terrain;
`MAP_SURFACE_VISUAL_KIND`'s own `describe`) therefore rendered fully black
regardless of `colorForSurfaceType`. Token and node-handle visuals use
`"unlit"` materials, so were never affected -- which is exactly what let two
prior tasks' (`E3.6`, `E3.7`) visual verification mistake a black terrain quad
for "nothing rendered wrong," masking the real wall/door bug
[0006](0006-e2e-validation-slice.md) found and fixed.

**Fixed** by adding a `MAP_LIGHTS` constant (one `"ambient"` light so no lit
surface ever goes fully black, one `"directional"` light positioned above the
scene) and passing it as `createEngine`'s `lights` option in
`apps/vtt/src/adapters/rendering/render-3d-scene-adapter.ts`.
Browser-verified: the terrain quad now renders visibly shaded green
(`colorForSurfaceType`'s terrain color) instead of solid black.

## Gap 2 — terrain axis mismatch

`grafting-graph-core`'s `PrismGridMesh::new` builds its own general-purpose
grid with a documented convention: X/Y form the horizontal grid plane, and
its own vertical axis is Z (`z_base = l as f32`, `FormationInputs`'s own doc
comment: "Vertical Z height variation factor"). This convention is
independent of any one consumer -- it also backs
`grafting-procgen-generation-wasm`, which has no opinion on "up" at all --
and stayed unmodified here.

`apps/vtt` (camera, clip plane, `map-chunk-key.ts`'s `chunkKeyFor` bucketing
by X/Z) and `grafting-procgen-structure-generation`'s `wall.rs::position_at`
(fixed in [0006](0006-e2e-validation-slice.md)) both commit to Y-up. Nothing
remapped between the two conventions: `grafting-procgen-terrain-generation`'s
`generate_terrain_cell_surface` derived each corner's position by lerping
directly in `PrismGridMesh`'s own mesh-space and handed that straight to the
caller, so a terrain cell's "up" landed on render-space Z, not Y -- height
variation was invisible from the app's own Y-up camera angle, and a "flat"
cell wasn't flat in the plane the app treats as ground.

**Fixed** at the boundary this crate already owns -- inside
`generate_terrain_cell_surface`, after the existing per-corner lerp (which
stays correct and unchanged, since `bottom`/`top` differ only along the
mesh's own vertical axis) -- by remapping the lerped point from mesh-space
`[x, y, z]` to render-space `[x, z, y]` before constructing each `Node`. This
was chosen over the other two locations `E3.9`'s scope named as open
(remapping inside `PrismGridMesh` itself, or at the Wasm/TS boundary):
`PrismGridMesh` is a general grid utility with its own coherent, documented,
already-relied-upon (by `generation-wasm`) convention that has no reason to
know about any one consumer's render axis, and remapping once here -- the
exact point where an abstract grid cell becomes a construction-surface node
position for a Y-up caller -- keeps every downstream consumer
(`construction-wasm`, `apps/vtt`) working in render-space throughout, with
no double-remapping risk at a second boundary.

Updated `generate.rs`'s existing tests (`happy_path_generates_a_flat_top_surface`,
`a_ramp_module_lerps_each_corner_independently`) to express expectations via
a small `render_space()` test helper instead of asserting raw
`mesh.positions` values directly. Added
`a_flat_cell_is_not_degenerate_in_render_space`, a regression guard: asserts
a flat module's 4 corners share one render-space Y (truly flat, on the
correct axis) and occupy 4 distinct render-space `(X, Z)` footprint
positions (correct ground plane).

Browser-verified via a temporary debug hook (`window.__e2eDebug`, removed
before commit) reading `TabletopRuntime.getSnapshot().map.nodePositions`
directly: the seeded terrain cell's 4 corners are now `(0,1,0)`, `(1,1,0)`,
`(1,1,1)`, `(0,1,1)` -- flat at `Y=1`, spanning a real `X`/`Z` footprint --
sitting correctly alongside the seeded wall's nodes (`Y=0` bottom ring,
`Y=3` top ring per its own `height=3`, all sharing the wall's `X=2`), both
geometries now coordinate-consistent in the same Y-up, X/Z-ground
convention for the first time.

## Validation checklist result

Run against `pnpm nx run vtt:dev`, table `/table/e3-9-validation`:

- **Lighting.** Confirmed: the terrain quad renders visibly shaded (its own
  `colorForSurfaceType` green), not solid black.
- **Terrain axis.** Confirmed via debug-hook ground truth (not visual
  inspection alone, per the lesson from [0006](0006-e2e-validation-slice.md)):
  terrain corner heights land on render-space `Y`; the cell's footprint spans
  `X`/`Z`, matching the app's own ground-plane convention and sitting
  coordinate-consistent with the seeded wall.
- **Regression: drag a node, see the change propagate live; undo.**
  Confirmed: dragging a wall/door node handle (`doorEndTop`) moved it live in
  `map.nodePositions`; Undo reverted it back to its original position
  (sub-percent floating-point drift from the pick-ray round trip, pre-existing
  behavior unrelated to this task's changes, not a regression).
- No console errors attributable to the app (only the same pre-existing
  browser-extension message-channel artifact noted in
  [0006](0006-e2e-validation-slice.md)).

All 39 Rust tests across the touched crates pass:
`grafting-procgen-terrain-generation` (11 unit + 2 interop, `cargo test --lib --tests`)
and `grafting-procgen-construction-wasm` (28 unit, `cargo test --lib`).

## Non-goals carried forward

The no-camera-pan and no-ground-plane-fallback gaps from
[0005](0005-edit-mode-interaction.md) -- the seeded wall was not visibly in
frame in this task's own screenshots, a pre-existing framing limitation, not
a rendering-correctness defect. Wiring `wasm-pack test` (or equivalent) into
CI for `grafting-procgen-construction-wasm`, flagged in
[0006](0006-e2e-validation-slice.md), remains open.

With both of `E3.9`'s items done, Epic 3.5's own remaining open items per
`docs/architecture/vtt-roadmap.md` are the carried-forward gaps above, not
new epic-3.5 scope.
