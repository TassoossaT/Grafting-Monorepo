# Note 0006 — End-to-end validation slice (`E3.8`)

- Recorded: 2026-08-12
- Status: implemented; the bug below was a real regression that reached
  `master` undetected — read this before touching wall/door generation or
  this crate's test wiring
- Source: `E3.8` task (`VTT-E2E-VALIDATION`), the epic's own acceptance
  criterion in `docs/architecture/vtt-roadmap.md`'s Epic 3.5

This is a defect log like [0001](0001-rendering-and-propagation.md), not a
decisions record like [0004](0004-map-product-model.md)/[0005](0005-edit-mode-interaction.md).

## What this task was

`E3.8` has no feature scope of its own — it is Epic 3.5's stated acceptance
check: generate a terrain cell and a wall with a door, see both rendered,
drag a node in edit mode, see the change propagate live. `E3.5`-`E3.7` were
all already marked Done, so this task's job was to actually run that
checklist against the real Wasm engine in a real browser, not to build
anything new.

## A real, previously undetected bug found while running the checklist

Live browser verification (`pnpm nx run vtt:dev`, table
`/table/e2e-validation`) showed only a black quad and a green token billboard
on load — no visually distinct wall or door shape, despite
[0004](0004-map-product-model.md)/[0005](0005-edit-mode-interaction.md) both
recording that the default seed includes a generated wall-with-door and that
the full loop was "browser-verified." A debug hook on `TabletopRuntime`
(`window.__e2eDebug`, temporary, removed before commit) showed
`getSnapshot().map.byId` held exactly **one** surface — the terrain cell.
None of `generateWall`'s three returned pieces (two wall remainders, one
door) ever made it into `entities/map`'s `MapProjection`.

Traced to `grafting-procgen-construction-wasm`'s own
`all_surface_meshes_json()` returning only the terrain mesh — confirmed with
a native (non-`wasm_bindgen_test`) Rust reproduction, since this crate's
`#[wasm_bindgen_test]`s are not wired into any CI job (`wasm-pack test` is
never invoked anywhere in `.github/workflows` or `tools/scripts`) and do not
run under a plain `cargo test` either — they are not executing anywhere,
which is exactly how a wrong assertion in one of them
(`generating_a_door_wall_exposes_three_sibling_meshes`, still present,
unmodified) went unnoticed. Root cause: `grafting-procgen-structure-generation`'s
`wall.rs::position_at` added a wall's `height` to `position[2]` (Z) instead
of `position[1]` (Y-up, per `docs/architecture/vtt-roadmap.md`'s floor-cutaway
clip plane being expressed as `Y < Y_limit`). For a wall running along X
(the crate's own unit test fixture), Z and X are different axes, so the bug
was geometrically invisible — height and length landed on distinct axes by
coincidence, producing a valid (if mislabeled) rectangle. For a wall running
along Z — which is what *both* this app's default seed
(`default-map-seed.ts`) and its "generate wall" edit-mode trigger
(`tabletop-entry.tsx`) actually build — height and length collapsed onto the
same axis, folding the top edge back onto the centerline and producing a
self-overlapping quad. `earcut` correctly refuses to triangulate that, so
`triangulate_surface` returned `None`, and `mesh_dto_for`'s `?` silently
dropped the surface as a "transient/absent state, not an error" (its own,
otherwise correct, documented behavior for a mid-edit degenerate cycle).

Every wall or door this app has ever generated has therefore been invisible
and absent from `entities/map` since `E3.3` (Rust generation code, PR #84)
landed — through `E3.6`'s and `E3.7`'s own "browser-verified" claims. Both
of those verifications were visually fooled by a second, already-documented,
unrelated gap: unlit surfaces render solid black
([0004](0004-map-product-model.md)'s `E3.9` follow-up), so the terrain
cell's own black quad was mistaken for a rendered wall.

**Fixed** by changing `position[2] += wall.height` to
`position[1] += wall.height` in
`libs/domains/procgen/structure-generation/src/wall.rs`. Updated that
crate's own `no_door_generates_one_piece` test (which had asserted the buggy
coordinates as correct) and added
`a_wall_running_along_z_keeps_top_and_bottom_on_distinct_axes` alongside it.
Added `generating_a_terrain_cell_then_a_z_running_wall_exposes_all_four_meshes`
to `construction-wasm`'s `session.rs` tests as a plain `#[test]` (not
`#[wasm_bindgen_test]`, deliberately — see below) reproducing the exact seed
scenario end to end.

## A second gap surfaced, not fixed here

`grafting-procgen-construction-wasm`'s `#[wasm_bindgen_test]` suite
(`session.rs`, `wall.rs` unit tests aside) does not run in CI and does not
run under a plain `cargo test` on this workspace — confirmed empirically
(`cargo test --lib session::` matches zero tests; `wasm-pack test` is not
invoked from any workflow or script). Every assertion in that file has been
dead weight since it was written. This task's own new regression test was
deliberately written as a plain `#[test]` so it actually executes, but the
rest of the suite (a dozen-plus `#[wasm_bindgen_test]`s) remains unexecuted
anywhere. Wiring `wasm-pack test --node` (or similar) into CI for this crate
is a real, still-open gap — flagged here for whoever next touches this
crate's test setup, not fixed as part of this task (out of scope: CI
plumbing, not the map/construction feature surface).

## Validation checklist result (after the fix)

Run against `pnpm nx run vtt:dev`, table `/table/e2e-validation`, verified
via screenshots and a temporary debug hook (both removed before commit):

- **Generate a terrain cell and a wall with a door, see both rendered.**
  Confirmed: default seed now yields 4 real surfaces (1 terrain, 2 wall
  remainders, 1 door), all triangulated and chunk-uploaded; the render
  shape visibly grew from a small terrain-only quad to the full wall+door
  silhouette once the fix landed. Both edit-mode "Generate terrain
  cell"/"Generate wall" triggers also confirmed to add new working surfaces
  (`map.byId` grew 4 → 6 across both clicks, no console errors) — still
  subject to [0005](0005-edit-mode-interaction.md)'s already-documented
  no-camera-pan gap, so new geometry placed far from the seed isn't always
  in frame, but the generation pipeline itself is proven live.
- **Drag a node in edit mode, see the change propagate live.** Confirmed:
  toggling "Move node: on" and dragging a handle reshaped the mesh in real
  time (screenshot-verified, not just a state check).
- **Undo/redo.** Confirmed: Undo reverted the drag's visible shape exactly;
  Redo reapplied it.

No console errors attributable to the app surfaced during any of the above
(the only console exceptions seen are a pre-existing browser-extension
message-channel artifact, unrelated to this app).

## Non-goals carried forward

The two `E3.9` render-correctness gaps ([0004](0004-map-product-model.md)):
no lighting configured (every physical surface still renders solid black,
which is *why* this bug was visually invisible for two prior tasks) and the
terrain `PrismGridMesh`-vs-render-space axis question. Both remain open and
are now more clearly load-bearing for any future visual verification, not
just cosmetic. The no-camera-pan gap and no-ground-plane-fallback gap from
[0005](0005-edit-mode-interaction.md). Wiring `wasm-pack test` (or
equivalent) into CI for `grafting-procgen-construction-wasm`.
