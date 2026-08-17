# Note 0009 — doors are deferred; nothing current may couple to them

- Recorded: 2026-08-17
- Status: decision recorded, not yet enforced in code
- Source: owner, mid-discussion of curve-authoring design for walls/fences/towers

This is a decisions/backlog record like [0002](0002-fog-of-war.md), not a
defect log.

## The decision

Doors are not designed yet. The owner will design doors together with
windows and any other element that has its own *state* (open/closed,
locked, etc.) — a whole different, not-yet-started feature. Until that
design happens, **no code in this app may mention or depend on "door" as a
concept**, and nothing being built now (the curve-authoring / wall-vs-fence
constraint work this note was recorded alongside) may be shaped around a
door-shaped hole in a wall.

## What exists today that this note flags, not yet removed

- `EdgeNotch` (`libs/domains/procgen/structure-generation/src/extrusion.rs`)
  and its `notch`/`arc_facets` plumbing through
  `generate_and_apply_path_extrusion`/`generate_and_apply_region_partition`
  (`libs/domains/procgen/construction-wasm/src/generation.rs`) are a generic
  "cut a gap into one straight edge" primitive — the type itself carries no
  product noun (`EdgeNotch.surface_type` is caller-supplied), so it is not
  itself a "door" and does not have to be deleted for this note to be
  honored.
- `interior-wall-tool.ts`'s `NOTCH_TYPE = "door"` constant **is** a door
  mention — it is the one place in the app today that names a door. This is
  the concrete thing this note means by "code with a door mention."

## What must happen

Before or alongside the next real edit to `interior-wall-tool.ts` (or any
other file that starts naming "door"), replace `NOTCH_TYPE = "door"` with
something that does not presuppose the door design (e.g. drop the notch
call entirely from `generateRegionPartition` until openings are designed on
purpose, rather than as a side effect of region-partition boundary runs).
Do not add new door-named code anywhere else in the meantime. `EdgeNotch`
itself may stay — it is generic infrastructure a real door design can reuse
later — but no caller should assume today's notch behavior *is* the door
feature.

## Why this matters for the work in progress

The owner is currently working out how wall/fence curve authoring should be
constrained (buildings need known, regular geometry; free-drawn fences need
fragmenting into known contour primitives). That design must not accrete
door-opening logic as a side effect of solving curve constraints — openings
are a separate, later, stateful-element feature.
