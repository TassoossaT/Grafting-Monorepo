# AGENTS.md -- `grafting-procgen-structure-generation`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

## What belongs here and what does not

This crate has exactly one job, per `ADR-0022`'s "generation must stay
isolated per domain" requirement: given an already-decided wall centerline
and an optional door opening, derive the `Node`/`Edge`/`SurfaceSpec` data
an ADR-0022 construction surface needs. It does not:

- decide *where* a wall or door goes -- no floorplan, room-layout, or
  interior-generation logic (`vtt-roadmap.md`'s `E3.4`) belongs here; this
  crate only turns an already-decided centerline + opening into geometry;
- mutate a `Graph` or `SurfaceRegistry`, or call any of
  `grafting-graph-core`'s `move_node`/`delete_node`/`merge_surfaces`/
  `split_surface`/`duplicate_surface` operations -- same boundary
  `grafting-procgen-terrain-generation` holds. This crate produces a
  target node/cycle description (one or more sibling `StructurePiece`s);
  reconciling that against a live graph is a future orchestration layer's
  job;
- know anything about terrain -- that is
  `grafting-procgen-terrain-generation`'s job, a separate crate with no
  dependency on this one, so the two domains stay isolated at the
  crate-dependency-graph level, not just by convention.

## Scope of this first version

Wall geometry has no modeled thickness (a flat, double-sided planar quad),
matching `vtt-roadmap.md`'s already-decided `E1.4` fix direction for
`vtt-brush`'s wall-mesh bug. A door opening is full-height only -- no
lintel piece above a shorter door. Both are deliberate, documented
follow-ups, not oversights; widen `WallSegment`/`DoorOpening` only with a
real consumer driving the shape, not speculatively.

Lives under `libs/domains/procgen` (DEC-046, `GRAFTING_MASTER_SOURCE.md`
§4.4): a generic, shareable domain capability, not `apps/vtt`-specific.
