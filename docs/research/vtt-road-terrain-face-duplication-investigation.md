# VTT road/terrain face duplication and commit cost

Status: RESOLVED in PR #262 (merged 2026-09-11). Owner verified in-app: mesh
growth gone, road commits faster. Follow-ups open: #263-#269.

## Verdict 1: terrain growth came from the grid engine, not face selection

Symptom: every road create/edit grew terrain faces/edges/vertices, mostly in
neighbouring regions. Many TS-side attempts (limit regeneration, face budgets,
resolution, wider consumed regions, corner-only neighbour exclusion) did not
converge -- they could not, because the engine grew the rim itself.

Root cause, reproduced against the real Rust engine
(`libs/domains/procgen/irregular-grid/tests/seam_stability.rs`):

- Constrained triangulation lattice side = 3x `faceSide`; a standing terrain
  rim arrives walked at ~1x `faceSide`.
- Ruppert refinement split contour segments; `ortho` put a midpoint on every
  contour edge. Each point came back in `onContour`, TS adopted it
  (`adoptContourNodes` -> `insert-vertex`), splitting the retained neighbour.
- The next fill beside that neighbour read the halved rim as its contour and
  halved it again. Two 12x12 regions regenerated in turn: seam 7 -> 13 -> 25
  nodes, cells 76 -> 82 -> 110 for identical ground. Only the TS
  `SHORTEST_USEFUL_FRACTION` (0.25 x faceSide) floor stopped it, at 4x density.
- Group/lineage metadata was never needed.

Fix (engine):

- `constrained::triangulate_keeping_seams`: cut contour segments longer than
  `SHORTEST_SPLIT` (0.375 lattice side) into an even number of pieces; hold out
  every point near the middle of its neighbours' chord (chord <= `LONGEST_SEAM`
  0.75 side, off-chord <= `SEAM_STRAYING` 0.1 side); refine with spade
  `keep_constraint_edges`. If a seam edge does not survive (crossing contours,
  duplicate claim), `build_constrained_quad_grid` falls back to the old
  midpoint-per-edge path and reports `seams_kept: false`.
- `ortho::ortho_along`: a seam edge uses its held nodes as the shared corner;
  a seam holding none merges its two corner cells into one polygon.
  `pair::pair_triangles_keeping` never merges across a seam. `relax_faces`
  relaxes n-gons; quad path bit-identical (parity fixture passes).
- Wire contract change: grid `quads` is `number[][]` (cells may have 5+
  corners). `construction-session-wasm-adapter.ts` multi-component merge no
  longer assumes 4 indices; `gridPatch` already accepted any length.

Result: seam stays 7 nodes and cells 44-46 over 6 alternating regenerations.
Mesh density stops following boundary point count: 24x24 walked at 1 -> mean
side 1.27 became 1.59; brush outline at 1x chord 308 -> 115 faces
(`construction-wasm/src/grid_generation.rs` tests hold the new tables).

## Verdict 2: slow road commits were engine calls scaling with map size

Symptom: some road commits took 0.8-1.4 s. The grid generator was NOT it:
5-13 ms for a dense 60x60 fill in release, seams path no slower.

Measured with the always-on commit log (see Tools): ~1.2 s of 1.4 s inside
engine calls, TS geometry negligible. Native benchmark reproduced it on fields
of 1 600 / 6 400 / 14 400 faces:

| call                                    | before            | after (#262)   |
|-----------------------------------------|-------------------|----------------|
| seeded `region_topologies_in_bounds`    | 39 / 157 / 945 ms | 5 / 9 / 6 ms   |
| `apply_patch_replacement` of one face   | 17 / 70 / 190 ms  | 8 / 43 / 95 ms |
| `insert_vertex`                         | 0.3 / 1.8 / 7 ms  | unchanged      |

Causes and fixes:

- `ContourTopology::edges_incident_to` scanned every edge per call; the seeded
  neighbourhood BFS calls it per node (quadratic). Fix: `edges_at_node` index
  maintained in `add_edge` / `remove_edge` / `prune_unused_edges`; same sorted
  output. Invariant for future edits: any new code mutating `edges` must keep
  the index in step.
- `apply_patch_replacement_json` cloned the whole state three times: undo
  `before`, undo `after`, and the atomic working copy. Fix: history entry holds
  one `state`; undo/redo `swap_state` with live state; replacement returns the
  superseded `ReplacedState` instead of dropping it. Remaining: one working
  copy + `spatial_index` clone per call (#269). Behaviour change: redo restores
  the state live when undo was pressed, not a snapshot taken at commit time.
- Orphan node pruning called `Graph::snapshot()` (clone+sort whole graph) once
  per candidate node. Fix: `successors`/`predecessors` on the node.

## Tools left in place

- `apps/vtt/src/composition/tabletop/commit-timing.ts`: `timeCommit` /
  `timePhase` / `countInCommit`. Prints a nested `[tempo]` phase tree only for
  commits >= 80 ms. Wired through `commitPathCloudIntent`,
  `TabletopRuntime.applyPatchReplacement` / `applyRegionEdit`,
  `dispatchCutRepairs`, `executeTerrainCut`, `fillTerrain`; counter
  `splits refeitos um a um (lote recusado)` in `adoptContourNodes`.
  First step for any future slowness report: ask the owner for this block.
- `construction-wasm/src/session_cost_probe.rs` (ignored test): `cargo test
  --release -p grafting-procgen-construction-wasm --lib session_cost_probe --
  --ignored --nocapture`.
- `irregular-grid/tests/seam_stability.rs`: regression for seam growth.

## Open follow-ups

- #269 patch replacement: undo diff instead of one whole-map copy per call.
- #263 undo history unbounded: one full map state per entry, two per road
  commit (P1).
- #264 `insert_vertex` prunes every unused edge per split.
- #265 adoption splits commit before the replacement; refusal leaves them.
- #266 road regeneration re-mints its contour, orphaning terrain nodes cut onto
  long road edges every edit.
- #267 suspected, unverified: undoing a road may fail because the terrain
  repair pushes its own history entry on top.
- #268 tooling: `docs:generate` fails in task worktrees (architecture-studio
  missing `@grafting/procgen-construction-wasm` link); worktree
  `construction-wasm/pkg` is a symlink to the main checkout's.

## Lessons

- Mock-validated TS fixes did not converge for weeks; one real-engine probe
  found the cause in minutes. Reproduce geometry growth against the engine
  first.
- For intermittent slowness, instrument phases before optimising; the first
  suspects (generator, fallback triangulation, TS quadratics) were all wrong.
- A local edit must cost what it touches; audit engine calls for whole-map
  scans or clones (`snapshot()`, `edges.values()` filters, `state.clone()`).

## Original acceptance checks (all met by #262)

- Repeated overlapping road edits do not grow terrain counts except for
  genuinely changed boundary geometry.
- Faces outside the repair area remain untouched.
- Curved roads and T junctions keep their road quality.
