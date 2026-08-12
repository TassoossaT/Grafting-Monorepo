# `structure-generation` (`grafting-procgen-structure-generation`)

Derives `ADR-0022` construction-surface node cycles for walls and door
openings from centerline generation parameters -- the "structure" half of
`docs/architecture/vtt-roadmap.md`'s E3.3, the last undone piece of Epic
3's map-construction slice. Generation-only: this crate produces plain
`Node`/`Edge`/`SurfaceSpec` data and never mutates a `Graph` or
`SurfaceRegistry` itself. No dependency on
`grafting-procgen-terrain-generation` or on the WFC solver -- walls/doors
are not WFC-driven in this design.

## Status

`generate_wall(wall, door, ...)` derives a wall's surface(s): 1 piece with
no door, 2 pieces with a door touching one end, or 3 sibling pieces (left
remainder, door, right remainder) sharing jamb `NodeId`s for a door
interior to the wall. A `Surface.cycle` is one simple closed loop and
cannot represent a ring with a hole punched in it, which is why a doorway
is modeled as sibling surfaces rather than one surface with a hole --
matching `ADR-0022`'s own worked `Merge` example ("a door's nodes and an
adjoining wall's nodes becoming one thing").

Wall geometry has no modeled thickness (a flat, double-sided planar quad),
and a door opening is full-height only in this version -- both deliberate,
documented follow-ups, not oversights.

No Wasm boundary in this crate yet -- deferred to a separate follow-up task
alongside exposing `grafting-graph-core`'s construction operations to
JS/the Studio brush tool.

## Targets

- `check` -- `cargo check -p grafting-procgen-structure-generation`
- `test` -- `cargo test -p grafting-procgen-structure-generation`

Run via Nx: `nx run structure-generation:check` / `:test`.
