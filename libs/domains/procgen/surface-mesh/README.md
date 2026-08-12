# `surface-mesh` (`grafting-procgen-surface-mesh`)

Turns a construction `Surface`'s node cycle -- an ordered ring of 3D
positions -- into a triangulated mesh. Closes the gap
`docs/architecture/vtt-roadmap.md`'s `E3.5` note left open: nothing in the
Rust workspace derived real geometry from a `Surface`'s cycle before this
crate existed.

## Status

V1: `triangulate_surface(positions: &[[f32; 3]]) -> Option<TriangulatedMesh>`.
Uses the `earcut` crate for both the 3D-to-2D projection and the
ear-clipping triangulation itself, so arbitrary (non-convex) simple
polygons are supported, per `ADR-0022`. Returns `None` for fewer than 3
positions or a degenerate (collinear/zero-area) ring.

No holes, no caching (every call re-derives geometry, matching `ADR-0022`'s
"no stored mesh, ever" design), no dependency on `grafting-graph-core` --
this crate takes plain position slices, not graph types.

## Targets

- `check` -- `cargo check -p grafting-procgen-surface-mesh`
- `test` -- `cargo test -p grafting-procgen-surface-mesh`

Run via Nx: `nx run surface-mesh:check` / `:test`.
