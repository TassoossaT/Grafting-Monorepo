# AGENTS.md -- `grafting-procgen-surface-mesh`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

## What belongs here and what does not

This crate has exactly one job: given a construction `Surface`'s cycle,
already resolved to an ordered list of 3D positions, triangulate it into a
`TriangulatedMesh` (positions/normals/indices). `grafting-graph-core::Surface`
deliberately does not do this itself -- see its module doc, "turning that
into geometry is the caller's job" -- and this crate is that caller.

It does not:

- know about `NodeId`, `Graph`, or `SurfaceRegistry` -- it takes plain
  `[f32; 3]` slices, not a graph reference, so it stays usable by any future
  caller with an ordered position list, not only `grafting-graph-core`'s own
  types;
- cache anything. Per `ADR-0022`'s "no stored mesh, ever, by design," every
  call re-derives geometry from the positions given -- a cache, if any,
  belongs at the render/consumer layer;
- assume convexity. `ADR-0022` requires arbitrary polygon support ("a
  hexagon, an irregular outline -- not only a rectangle"), which is why this
  crate uses `earcut` (ear-clipping) rather than a triangle fan.

## Dependency choice

`earcut` (crates.io, `MIT OR Apache-2.0`, matching this repo's existing
license convention) does the 3D-coplanar-to-2D projection
(`utils3d::project3d_to_2d`) and the triangulation itself. No hand-rolled
ear-clipper or manual Newell's-method/basis-projection code -- see
`docs/decisions` conventions on preferring a well-scoped library over
reimplementing the equivalent by hand.

Lives under `libs/domains/procgen` (DEC-046, `GRAFTING_MASTER_SOURCE.md`
§4.4): a generic, shareable geometry capability, not `apps/vtt`-specific.
