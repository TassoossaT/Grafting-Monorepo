# Note 0008 — Openings are pinned to their host, cut at mesh time

- Recorded: 2026-09-23
- Status: implemented in `TASK-EPIC7-CONSTRUCTION`; rules below are owner decisions, not implementation details
- Issues: #313 (decisions), #231, #272 (not used by openings), #291 (host-delete cascade, future)

## Rules (owner decisions — do not re-derive or revert)

1. **An opening is a demarcation, not a real face.** It marks where a future door/window asset sits. Its
   painted pane is a placeholder until assets exist.
2. **An opening is its own graph region of any shape.** It never shares nodes with its host. Shape = its
   bounding rectangle plus a per-side rounding radius (world meters, 0 = straight) or a circle inscribed in
   the box; rounded sides stay inside the box and the outline stays convex. The shape lives in the region's
   generic property bag (`props.openingShape`), so it survives undo and is kept through move/resize. Doors
   take every shape; a round door touches the floor.
3. **Truth lives in the host.** Every opening node is *pinned* to a host face in relative coordinates:
   `u` = fraction along the face's base run, `v` = fraction of the face's **local** height at that `u`
   (between the base run and the top run there). Moving, stretching, curving or tilting the host carries the
   opening; a slanted top deforms it (accepted; alignment helpers may correct it later, #317). A pinned node
   with `u, v` in `[0, 1]` can never leave its host.
4. **The host wall has no topological hole.** The visible cut is computed by the engine at mesh generation,
   in the host's unrolled frame. Picking and physics read that cut mesh, so they see the hole for free.
5. **Nothing is opening- or wall-specific.** Three generic capabilities, used independently:
   pinned-to-a-surface (per node), `cuts` (subtracts its area from the surfaces it is pinned to),
   `accepts-cuts` (can be cut). Types declare `cuts` / `accepts-cuts` as traits; never compare type names.
   Examples: window/door = pinned + cuts; lamp/painting = pinned only; trapdoor/skylight/pond = pinned + cuts.
6. **An opening may span several faces** of a wall run (seams of a brush-drawn curved wall, L corners):
   it is a *group* of pieces, one piece per face, each pinned to exactly one host. Select, move, resize,
   delete and overlap act on the whole group. Work happens in *run space* (`s` along the run, `v`).
7. **No merging.** Two openings never merge, automatically or explicitly. Overlapping another opening on the
   same run is refused.
8. **A door's sill is the floor** (`v0 = 0`).
9. **Deleting the host deletes its openings** — deferred to the generic erase tool (#291), not implemented.

## Why

A randomized test against the real engine showed the old model (a topological hole in the wall) let a hole
cross its face border after a wall edit or on a non-rectangular wall; triangulation then overdrew the
opening's pane and z-fought. Patching with refusal rules was rejected in favour of this model, which makes
that state impossible.

## Where

- Engine: `libs/domains/procgen/construction-wasm/src/pins.rs`, `region_groups.rs`;
  `libs/domains/procgen/surface-mesh/src/host.rs`, `run.rs`, `frame.rs`.
- App: `apps/vtt/src/composition/tabletop/tools/openings/`.
- Guard: `apps/vtt/test/opening-fuzz.test.mjs` (seeded, real engine; straight/arc/bezier/multi-face walls).

## Known limits

- Acute corners: an opening wrapping a corner sharper than 90° may over-cut the neighbouring face.
- Moving a pinned node directly is not snapped back until its host changes; move openings by re-pinning.
- A shaped opening's own painted pane has no vertical sides, so the engine draws it flat: on a curved wall it
  follows the chord, not the curve (the cut in the wall is exact).
- Overlap between openings is tested on bounding rectangles, so rounded openings can't sit closer than their boxes.
