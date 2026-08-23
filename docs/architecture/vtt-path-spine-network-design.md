# VTT path spine: the travel line as a stored seam

- Status: **partly implemented** — the spine, its identity scheme, its edit
  cascade, subtypes, the bridge deck and junction *identity* (welding) are
  built. Junction **geometry** is not; see "Open" below.
- Date: 2026-08-23
- Where it lives:
  - Spine in the recipe: `apps/vtt/src/features/edit-construction/path-recipe.ts`
    (`PATH_SPINE_OFFSET`, `pathSpineSlot`).
  - Node identity: `apps/vtt/src/features/edit-construction/station-node-id.ts`.
  - Role table and cascade:
    `apps/vtt/src/features/edit-construction/structure-types/path-structure.ts`.
  - Cascade scope: `CascadeContext.related` in
    `apps/vtt/src/features/edit-construction/structure-types/structure-type.ts`,
    supplied by `composition/tabletop/tools/core/edit-region-tool.ts`.
  - Graph declaration: `composition/tabletop/tools/paths/path-patch.ts`.
  - Subtype identity: `apps/vtt/src/features/edit-construction/path-corridor.ts`.
  - The run read back as spine/contour/rib:
    `apps/vtt/src/features/edit-construction/path-cloud.ts`.
  - Declared subtype behaviour: `pathRidesTerrain` / `pathCarvesGround` in
    `path-recipe.ts`, read by `pathInteractionOver`.
  - Welding: `weldedToStandingSpines` in
    `composition/tabletop/tools/paths/path-shared.ts`.
- Related: `vtt-atomic-edit-and-cloud-policy-design.md` (the role/policy
  machinery this reuses unchanged), `vtt-product-model.md`.

## The three parts

A run is exactly three things, and this is the vocabulary the junction work
is written against:

- **Spine** — the chain at slot 0, running along the run. The travel line.
- **Contour** — a chain at an extreme slot, running *parallel* to the spine.
  One per side.
- **Rib** — the transverse run of one station, linking contour to spine to
  contour, and bounding the faces either side of it.

`path-cloud.ts` reads all three back off the graph. It is a **derived view,
never stored**: every fact is already there — the spine is slot 0, a contour
is an extreme slot, a rib is one station — and a second copy alongside would
only give the two something to disagree about. Naming a contour is what
junction work needs and what scanning for the largest `|across|` on demand
does not give.

**This version is flat and three slots wide.** The raised U edge of a road is
a detail that returns once connections work. While it was on, the terrain's
own hole reused the road's rim nodes, so the hole sat at the shoulder's
height and the terrain ramped up to meet it — a berm running the whole length
of the run. `shoulderWidth` still widens; `shoulderHeight` is unread.

## The decision

**A path's travel line is a profile point at lateral offset 0.**

That single choice makes the centreline a real shared edge chain: the two
bands either side of it meet along it, so it is stored, addressable and
editable by the same mechanism every other seam in this repo uses. No new
graph concept, no registry, and nothing for `prune_unused_edges` to collect —
the spine has face usage on both sides, so it survives by the ordinary rule.

Any further line a product wants to be first-class — a traffic lane, a rail —
is another profile point. There is no separate "one line or many" model.

## Why not a separate network structure

The obvious alternative was a road network living outside the contour
topology, with faces derived from it. It was rejected for a concrete reason:
`ContourTopology::prune_unused_edges` (`libs/graph/core/src/contour.rs`) drops
every edge no region uses, and runs at the end of every `apply_region_overlay`
and every `region_edit`. A faceless spine would be garbage-collected on the
next commit, while its nodes survived — leaving orphans. Making the spine a
seam sidesteps the whole problem instead of fighting it.

## Identity, not geometry

Node ids carry `station` and a **signed** `across` slot, spine = 0:
`{operationId}:s{station}:a{across}`.

Two facts a later edit needs — "what else belongs to this station" and "which
of those lie further out" — are facts about how the thing was *built*.
Reading them back off positions works only until the first drag moves those
positions, and fails outright for an interior that is not a grid: in a
honeycomb bed or an irregular trail, following edges outward from the spine
reaches the whole product and connectivity gives no direction at all.

Signing `across` from the spine is what makes "outward" arithmetic rather than
a lookup: same sign, greater magnitude. The outermost node's outward set is
empty by construction, so the rim needs no special case and there is no
separate contour role to keep in sync with a rib one.

## The cascade rule, in one sentence

Dragging a node carries every node of its own station that lies further out on
the same side.

The spine's "further out" is the entire cross-section; a node partway out
carries only what is beyond it; the rim carries nothing. This is the
transitive rib-then-contour propagation the owner described, collapsed into
one predicate — the two agree in outcome because every cascade here is
same-delta.

`CascadeContext` gained `related`: the regions sharing a node with the grabbed
one. A cascade seeing one region alone could reach the rib and stop short of
the rim, because a cross-section runs through every band it was built from
while the rim belongs only to the outermost. Walls do not need it and are
unaffected; the field is empty when a caller has no wider view to offer.

## Nothing is recomputed, on purpose

A drag does not re-run the recipe or re-derive the mitre frame. **The known
consequence:** a corner made by dragging the spine narrows the road there —
the cross-section stays at its old offset while constant width would demand
the mitre extension (at the defaults, 2.97 against 2.1, a ~20% pinch).

This is accepted, not overlooked. It is the model this repo already commits to
for walls — the graph is the truth and the recipe only seeds it — and it is
what keeps every cascade a plain same-delta op, which is all `RolePolicy`
supports. Recomputing would require a *scaled* cascade the model deliberately
does not have.

The remedy is in the same currency: because the cross-section is materialised
out to the rim, widening is pushing the rim outward — an ordinary edit that
works identically on a straight run, a curve and a junction, with no frame to
recompute.

## Cost

One profile point per station is one more longitudinal band: `street` goes
from 1 band to 2, `road` from 3 to 4. A product declaring travel lanes as well
would roughly double again. Deliberate, and the reason the spine is not added
speculatively to profiles that do not want one (`pathSpineSlot` returns `-1`).

## Subtypes, and why they are not types

Every preset — trail, street, road, bridge — collapses to the one `path`
surface type, shares its role table, its cascade and its editing rules. A
subtype varies the cross-section it seeds plus two declared behaviours, and
nothing else. Adding one is adding a preset, never a second set of type logic
to keep in step with the first.

The subtype rides in the corridor id (`{operationId}#{kind}`) because the
surface itself deliberately cannot say which preset built it, and a later
regeneration or junction needs to know. The marker is appended so
`parseStationNodeId` keeps treating a corridor id as an opaque prefix.

`interactionOver` gained the painted run's subtype for the same reason a role
table exists at all: so a declared behaviour can vary without a second type.

## The bridge, and the query it makes unnecessary

A deck is a subtype that declares two things: its stations do not read ground
height (`pathRidesTerrain` false, so the middle stays level between its own
two ends instead of sagging onto what it crosses), and it consumes nothing
(`pathCarvesGround` false, so `pathInteractionOver` answers `IGNORE`).

That dissolves a blocker this design kept running into. `getFootprintCoverage`
is a flat XZ query and cannot tell an overpass from a crossing at the same
level — but it never has to, because the run that spans **says so**. Intent is
declared, not inferred from geometry that cannot carry it.

Raising the deck afterwards is the ordinary spine edit: `ALL_AXES` on the
spine role, and the cascade lifts the whole cross-section with it.

## Junction identity is built; junction geometry is not

Two runs meet because they reference one spine node. `weldedToStandingSpines`
snaps a station onto a standing spine node **before** the sweep — the same
order `commitWallContour` resolves its columns in, and for the same reason: a
station that will share a node has to be built at that node's position, not
dragged onto it after. `apply_add_patch` skips a node that already exists, so
the welded node keeps its own position and both runs bound it.

What is **not** solved is the surface. Measured, and pinned by
`a_crossing_consumes_the_crossed_runs_spine_and_keeps_only_its_rim` in
`construction-wasm`'s session tests: `apply_region_overlay` rebuilds what it
consumed from the **outer boundary** of the consumed set, so rim nodes survive
and interior nodes do not. A spine is interior by construction. Crossing a
road therefore severs the crossed road's travel line exactly at the junction —
the welded node itself survives, the chain either side of it does not.

A real junction has to put the crossed spine back onto a face boundary, which
means the crossing area becoming its own face bounded by **both** runs' cross
sections rather than simply being replaced by the newer run's bands.
`i_overlay` is already a dependency of `surface-transformations` and is the
tool for computing that area.

## Open

- **Junction geometry.** Settled in shape, not written. Insert a node into
  *both* spines at the crossing; intersect the two contours; cut the four ends
  and relink them into one closed contour around the crossing, so no contour
  runs over another; the enclosed area becomes its own face with both spines
  crossing inside it, which also puts the crossed spine back on a boundary
  instead of inside a region about to be replaced. `i_overlay` is already a
  dependency of `surface-transformations` and is the tool for step two.
  **Undecided:** whether that contour is the *intersection* of the two runs (a
  simple quadrilateral) or their *union* trimmed at the four ends (the
  chamfered corners a real crossing has).
- **Regeneration.** The corridor id now carries the subtype, so the recipe is
  recoverable; nothing re-runs it yet. Still undecided: whether a hand-moved
  lateral vertex survives a regeneration that touches its station.
- **Remainder collapse.** `region_overlay.rs` folds every consumed region into
  one remainder carrying the first one's surface type. A network that loses
  surface identity on every stroke cannot be administered.
- **Closed loops** (`outer_boundary` assumes an open line) and
  **self-intersection** (criterion known: spine radius must exceed the
  half-width; the response to a violation is not decided).
- **Terrain around a run.** With the rim flat this no longer shows, but the
  hole still reuses the run's own rim nodes, so any future raised edge drags
  the terrain up with it. Whether that is cut-and-fill worth keeping or an
  artifact to correct is not decided; both references solve the same problem
  by deforming terrain deliberately.
