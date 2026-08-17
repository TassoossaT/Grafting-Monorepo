# Note 0008 — `region_partition`'s algorithm needs rework

- Recorded: 2026-08-16
- Status: not started -- needs study and a replan, not a quick fix
- Source: owner testing `interior-wall-tool.ts` ("Gerar Interiores"), the
  first real caller of `generate_and_apply_region_partition` since the
  retired `house-brush-tool.ts` ("Pintar Casa")

This is a decisions/backlog record like [0002](0002-fog-of-war.md), not a
defect log like [0001](0001-rendering-and-propagation.md)/[0007](0007-render-correctness-follow-up.md)
-- nothing here is broken in the sense of crashing or producing invalid
geometry; the owner's own words were "a geração está muito ruim" (the
generation is bad) after actually using it, not "it errors" or "it's wrong."

## What exists today

`grafting_procgen_construction_wasm::generation::generate_and_apply_region_partition`
(`libs/domains/procgen/construction-wasm/src/generation.rs`), driving
`grafting_procgen_structure_generation::region_partition`'s
`partition_cells_into_regions`/`boundary_runs`. Given a painted cell set,
a `maxRegionCells` threshold, and a seed: floods the cells into connected
regions, auto-splitting any region bigger than the threshold, then walls
every boundary run (notched where two regions share one) and caps every
cell's own floor/ceiling. This is the exact algorithm the deleted
`house-brush-tool.ts` drove one painted cell at a time, and that
`interior-wall-tool.ts` (this session) now drives with one click over an
already-enclosed footprint instead.

## Why it needs a rework, not a patch

The owner tried it against real, hand-drawn (non-grid, arbitrary-shaped)
exteriors and found the room layouts/splits it produces are not good
enough to ship, but said explicitly this needs "muitas alterações... não
dará para ser feito agora" (many changes, can't be done now) -- i.e. this
is a real design/algorithm study, not a one-line parameter tweak, and
should not be attempted inside an unrelated task's own scope creep (this
note exists instead of a rushed attempt during
`VTT-INTERIOR-WALLS-AND-DEMOLISH`).

Two concrete, already-known pressure points worth starting the study from:

1. **Cap generation has no opt-out.** `generate_and_apply_region_partition`
   always emits a floor+ceiling per cell; a caller that only wants interior
   *walls* (this session's own `interior-wall-tool.ts`, since floors/
   ceilings are not implemented in `apps/vtt` at all yet) has no way to ask
   for walls only, and today works around this by generating the caps and
   immediately `removeSurface`-deleting them again client-side
   (`interior-partition.ts`'s `isCapSurface`) -- real Rust work computed
   and thrown away every click.
2. **The algorithm always redraws its own outer perimeter.** Every boundary
   run gets a wall, including the cell set's own outermost ring -- which,
   fed an already-hand-drawn exterior, duplicates geometry that already
   exists. `interior-wall-tool.ts` also works around this client-side today
   (`isRedundantPerimeterWall`, a heuristic: a generated wall panel counts
   as a redundant duplicate if its own midpoint sits within half a cell of
   the room's true boundary polygon). This is a heuristic operating on the
   algorithm's *output*, not a real fix -- and the deeper issue is that
   `partition_cells_into_regions`/`boundary_runs` only ever reason about a
   rectilinear cell grid, with no notion of "this outer ring is someone
   else's already-real boundary, don't redraw it."

Both of these, plus whatever the owner finds specifically wrong about the
split/room-shape choices themselves, belong in one real study of
`region_partition`'s own algorithm and request shape -- not four separate
patches layered on top of the current one.

## What must happen before implementation

Study session with the owner: what does "good" interior generation
actually mean here (room proportions? a minimum room size? corridor vs.
room distinction? doorway placement rules?), and whether the fix is
(a) parameterizing the existing flood-fill/threshold-split algorithm
further, (b) a different algorithm entirely, or (c) splitting "find
regions" from "wall/cap generation" more sharply than today's single
combined call already does (`generate_and_apply_region_partition`'s own
doc already frames it as thin orchestration over `partition_cells_into_regions`
+ `boundary_runs` -- a real opt-out for caps, and real awareness of a
pre-existing exterior boundary, may belong at that lower layer instead).
