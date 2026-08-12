# AGENTS.md -- `grafting-procgen-terrain-generation`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

## What belongs here and what does not

This crate has exactly one job, per `ADR-0022`'s "generation must stay
isolated per domain" requirement: given an already-solved terrain module
(from `grafting-procgen-tileset-wfc`) and a target `PrismGridMesh` cell,
derive the `Node`/`Edge`/`SurfaceSpec` data an ADR-0022 construction surface
needs. It does not:

- run the WFC solver or decide socket compatibility -- that is
  `grafting-procgen-tileset-wfc`'s job, depended on here only for its
  plain-data `Tileset`/`Module`/`Assignment` types (`default-features =
  false`: no solver backend is pulled in, only the domain model);
- mutate a `Graph` or `SurfaceRegistry`, or call any of
  `grafting-graph-core`'s `move_node`/`delete_node`/`merge_surfaces`/
  `split_surface`/`duplicate_surface` operations. This crate produces a
  target node/cycle description; reconciling that against a live graph
  (first creation via `add_node`/`add_edge`/`SurfaceRegistry::add_surface`,
  or an edit via the existing operations) is a future orchestration layer's
  job, not this crate's;
- know anything about walls, doors, or any other non-terrain domain -- that
  is `grafting-procgen-structure-generation`'s job, a separate crate with no
  dependency on this one, so the two domains stay isolated at the
  crate-dependency-graph level, not just by convention.

## Scope of this first version

Only `CornerHeightModule` (a flat corner-height profile, ported from
`apps/architecture-studio/src/vtt/terrain-modules.ts`'s
`ModuleShape::CornerHeights` variant) is implemented. The `Mesh` variant
(arbitrary authored unit-cell geometry) is a deliberate, documented
follow-up -- `bilinear_point` exists as tested infrastructure for it, but
`generate_terrain_cell_surface` does not call it yet, since a corner-heights
module only ever samples the 4 exact corners, where the general bilinear map
is provably identity. Do not read that as dead code; it is scoped-ahead
infrastructure, not an oversight.

Lives under `libs/domains/procgen` (DEC-046, `GRAFTING_MASTER_SOURCE.md`
§4.4): a generic, shareable domain capability, not `apps/vtt`-specific.
