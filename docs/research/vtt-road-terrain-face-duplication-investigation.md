# VTT road/terrain face duplication investigation

Status: growth root cause found and fixed in the engine, 2026-09-10. Atomic
splits+replacement and in-app verification still open.

## Verdict: the engine halved every seam it regenerated against

Root cause, measured against the real Rust engine
(`libs/domains/procgen/irregular-grid/tests/seam_stability.rs`):

- Constrained triangulation used lattice side = 3x `faceSide`; a standing
  terrain rim arrives walked at ~1x `faceSide`. Ruppert split contour
  segments, then `ortho` put a midpoint on every contour edge.
- Every such point came back in `onContour` -> TS adopted it -> the retained
  neighbour's edge split in two. The next fill beside that neighbour read the
  halved rim as its contour and halved it again.
- Two 12x12 regions regenerated in turn: seam 7 -> 13 -> 25 nodes, cells
  76 -> 82 -> 110 for the same ground. Stopped only at the TS
  `SHORTEST_USEFUL_FRACTION` floor, at 4x the density.
- Group/lineage metadata was never the cause; face selection fixes could not
  converge while the engine grew the rim itself.

Fix (engine, no TS contract change except cells may exceed 4 corners):

- `constrained::triangulate_keeping_seams`: cut contour segments longer than
  `SHORTEST_SPLIT` (0.375 lattice side) into an even number of pieces; hold out
  every point lying near the middle of its neighbours' chord (chord <=
  `LONGEST_SEAM` 0.75 side, off-chord <= 0.1 side); refine with
  `keep_constraint_edges`; fall back to the old path when a seam edge does not
  survive (crossing contours).
- `ortho::ortho_along`: a seam edge takes its held points as the shared
  "midpoint"; a seam holding none merges its two corner cells into a polygon.
  `pair_triangles_keeping` never merges across a seam. `relax_faces` relaxes
  n-gons; quads bit-identical (parity fixture passes).
- Result: seam stays 7 nodes over 6 alternating rounds, cells 44-46 stable.
  Mesh density no longer follows boundary point count (24x24 walked at 1:
  1.27 -> 1.59 mean side; brush outline at 1x chord: 308 -> 115 faces).
- Wire: `quads` is now `number[][]`; `construction-session-wasm-adapter.ts`
  multi-component merge no longer assumes 4 indices.

Remaining:

- Long road contour edges are still cut once per road regeneration; the road
  re-mints its contour, so terrain holding those nodes is re-orphaned.
- `adoptContourNodes` commits splits before `applyPatchReplacement`; a refused
  replacement still leaves splits. Rarer now, not atomic yet.
- `construction-wasm/pkg` must be rebuilt for the app to use the fix.

## Observed failure

Generating or editing a road removes the connected surfaces and triggers terrain
repair. A single repair can produce multiple terrain faces. On the next edit,
only part of the previously generated area is selected for removal. The
remaining face is left alive and the next repair generates over it again. After
repeated edits this produces a large, growing number of terrain vertices and
edges.

The failure is not limited to repeating the exact same pointer location. It is
an ownership/coverage mismatch: the faces selected for replacement are not the
same set as all old faces geometrically intersecting the repair area.

## Important non-solution

Regenerating a larger area, or storing a persistent set/group of generated
faces, is not the first fix. If an old overlapping face survives the
replacement transaction, a larger regeneration can still leave fragments and
repeat the problem. The first invariant must be enforced at the geometry
boundary.

## Required invariant

Before inserting a terrain repair patch:

```text
every old terrain face intersecting the repair area has been removed
```

The new patch may contain multiple polygons, but no old face may remain
overlapping the replacement area. The operation must be atomic from the
terrain graph's perspective.

## Suspected code path

The investigation should focus on:

- `dispatchCutRepairs` — candidate selection and `underFootprint` filtering;
- `planTerrainCloudCutRepair` — centroid/vertex/coverage admission rules;
- `executeTerrainCut` — covered-region and neighbourhood derivation;
- `fillTerrain` / `gridPatch` — cells, boundary edge reuse, and patch output;
- `applyPatchReplacement` — whether every selected old region is actually
  consumed before the new terrain patch is registered.

Centroid-only tests are insufficient: a large terrain polygon can intersect a
repair polygon while its centroid and all but one vertices remain outside.
Selection must use actual polygon intersection (or an equivalent exact graph
boundary test), not only an AABB, centroid, or node proximity test.

## Acceptance checks

- Repeating an overlapping road edit does not increase terrain face/vertex/edge
  counts except for genuinely changed boundary geometry.
- A repair that produces two polygons consumes every old polygon intersecting
  the repair area on the next edit.
- Faces outside the repair area remain untouched.
- Curved roads and T junctions preserve their existing road quality.
- The replacement is atomic: no partially consumed old faces remain if patch
  construction or registration refuses.
