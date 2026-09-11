# VTT road/terrain face duplication investigation

Status: active implementation investigation, 2026-09-10.

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
