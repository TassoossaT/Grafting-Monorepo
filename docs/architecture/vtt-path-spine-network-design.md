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

## Junction identity is built first

Two runs meet because they reference one spine node. `weldedToStandingSpines`
snaps a station onto a standing spine node **before** the sweep — the same
order `commitWallContour` resolves its columns in, and for the same reason: a
station that will share a node has to be built at that node's position, not
dragged onto it after. `apply_add_patch` skips a node that already exists, so
the welded node keeps its own position and both runs bound it.

The surface that identity leaves behind is what the next section is about.

## The road is built in the application; Rust registers it

The sweep used to be a call into Rust, and that was the wrong side of the
line. Rust's job here is to validate and execute what the application decided
-- `wallPatch` and `pathPatch` both say so, and a wall is built entirely in
TypeScript for exactly this reason. A sweep is not execution. It decides
where every vertex of the road goes, which faces exist, and **which rim is
the outside of it**.

That last one is the whole of the contour problem, and it was being decided
by index arithmetic over a station-by-slot grid: first column down, last
station across, last column back. That is the true rim of a road standing
alone and it cannot be anything else, because the code producing it has never
heard of a junction, a cloud, or a surface type. All of that lives in the
application. So the rim came back describing a road with no junctions in it,
and the application had no seam at which to correct it.

`sweepFormation` is the same maths on this side -- frames, mitre limit,
boundary walk, unchanged. What changed is who may alter them: `sweptBoundary`
is exported so the side that *does* know about junctions can walk it, compare
against it, or replace it outright.

## What a contour is, and the definition that was wrong

A road is built as a sweep: a reference line of stations, a profile of three
slots, and one face per station gap per side. Nothing in that declares a
contour. The contour was **derived**, by reading node addresses -- the chain
of nodes at the outermost slot, in station order.

That is true of a road standing on its own and false the moment another road
joins it. The nodes keep their addresses while the stretch between two of them
stops being rim and becomes the mouth of a junction, so read by address it is
still a rim and it draws as one: a line straight through the middle of the
road. No contour may run inside a road, and address-derived contours will
keep doing it, because an address records how a node was built and the
question is about what it bounds now.

There is one definition that survives a junction, and it is the graph's own:

> An edge with a face on both sides is interior. An edge with a face on one
> side is contour.

`perimeterOf` is that, and `pathCloudPerimeter` is it asked of a whole cloud
-- which is the right unit, because a junction merges runs and the contour of
a junction is the perimeter of everything joined at it. It is one named
reading in one place on purpose: every question about the outside of a road
network is a question about that loop, so changing any of them stays local.

The drawing follows the same rule. A structure type names an edge from one
face and one face cannot see the other, so a role that claims to be a rim is
only kept while the graph still shows a single face; otherwise it is drawn as
an interior seam. That is also the fastest way to see whether a junction
really closed or only looks closed.

## Contour fusion: two shapes, one construction

Sharing a spine node makes two runs one graph. It does not make them one
road: their outer contours still ran straight through each other, each
leaving an end inside the other's surface bounding nothing. Three rules from
the owner settle what that should become.

1. No outer contour may cross another without fusing into it.
2. Two runs joined at one spine node must have their contours joined too --
   the L bend.
3. A T must not become a triangle: the fusion happens **only** where a real
   crossing occurred, never by linking regions that never met.

Both are the same construction: a rim keeps the direction its own spine gave
it until it meets the rim it is joining, and there the two become one. What
differs is only **where on the standing run the arrival landed** -- at one of
its stations, or between two of them -- and that difference decides whether
the standing run's faces can stay as they are.

### Met at a station: the mitre, and it is free

Two runs that meet at a station share that station's whole cross-section, so
their end ribs are not two ribs. They are one rib, running between the two
places the outer rims meet. Each rim keeps the direction its own spine gave
it until it reaches its opposite number; on the outside of the bend the two
cross ahead of themselves, on the inside behind, and both are the same
intersection of two infinite lines. No case analysis, and no new face: the
standing run's rim node is *moved* onto the corner and the run being
committed welds its own rim node to it.

That last step is the whole trick, and it is the wall's trick. Because
`pathPatch` names an edge after the pair of nodes it runs between, two runs
that reference the same corner node and the same spine node declare **the
same edge id** -- so the shared rib is literally one edge with two faces on
it, which is exactly what `refuse-when-full` allows. Identity, not
coincidence.

Pairing the sides needs no case analysis either. One run's direction points
out of the joint and the other's points into it, so two rims lie on the same
hand of a traveller passing through precisely when `sideOf` gives them
opposite signs.

Two things had to be fixed before an L could even be *seen*. An arrival was
measured against the infinite line through a spine segment and thrown away
for `t > 1`, so an end drawn a few centimetres past the other run's last
station -- the commonest way anyone draws an L -- found nothing at all. And
an arrival that did land near an existing station still split the edge beside
it, minting a second node centimetres from the one it meant to meet. Both are
`resolveColumn`'s cases, and both are now answered the way walls answer them:
clamp, then weld to the station that is already there.

### Met mid-run: the T is two bends and a hole

An arrival that landed between two stations cannot be mitred: that rib has
road on both sides of it and cannot be rotated onto anything. But the bends
are the same bends. Each arriving rim runs on until it meets the standing
rim, and there it turns and becomes that rim -- two L joins, one per side.

What is different is the **hole** between them. The stretch of standing rim
between the two corners is not rim any more: it is the mouth of the road that
just arrived. Left in place it draws as a kerb laid straight across the
junction, which is what a T looked like -- the two arriving rims as uprights
and the standing rim as a crossbar.

That stretch cannot simply be deleted, because it bounds the standing run's
band and taking it away leaves the band open. So the band goes with it, and
two **wedges** replace it -- one either side of the arriving road. Each runs
from the arriving road's corner along what is left of the old rim to where
the band used to end, back down the spine to the junction node, and closes on
the arriving road's own end rib.

That last edge is the whole join. The rib between the junction node and a
corner is named after the pair of nodes it runs between, exactly as the
road's own patch names it, so the wedge and the road's last band walk **one**
edge with a face on each side. The two roads are joined because they bound
the same edges, not because they touch -- and the arriving spine reaches the
junction node on a seam that bounds something, so it survives
`prune_unused_edges` and travel connectivity and surface tidiness stop
pulling in opposite directions.

`pathMouthsInto` finds the mouth, `junctionWedges` rebuilds the flank, and
`junctionRemovals` takes the old faces out. Order matters in the commit: the
flank is removed before the road that opens it is declared, and the wedges go
in last, because they bound edges the road itself has only just minted.

### Joining is asked by identity, and that had to be fixed twice

Which faces a stroke *joins* rather than replaces used to be a purely
geometric question: does the new footprint contain one of that face's spine
nodes? That was the only question available before junctions existed, and
closing a junction is exactly what broke it. Once the arriving road is cut
back at the other road's rim, its footprint no longer reaches that road's
travel line at all -- so the geometric answer flipped to "replace" for the
very runs the stroke had just joined, and consuming those bands takes the
crossed run's spine with them.

A run that welded a node onto another run's spine has joined it, and every
face of it, full stop. The geometric rule stays for the case identity cannot
see -- a footprint laid over a travel line with no junction made -- but it is
the second question now, not the first. `identity, not geometry` keeps being
the same lesson in a new place.

### The graph a junction reads has to be the graph it is about to edit

Twice now the same mistake, in two costumes. A junction is decided from a
reading of the table, and between the reading and the edit the table moves.

The first costume was geometric: whether a face is joined or replaced was
asked of the footprint, and cutting the road back at the rim changed the
footprint out from under the answer. The second was plain staleness: the
faces to rebuild were chosen before the overlay ran, and the overlay consumes,
creates and prunes surfaces -- so the ids named a table that no longer
existed, and the removal asked the graph for a region that was gone.

So the run is read again, per mouth, immediately before its junction is
closed. What does *not* need re-reading is the mouth: where two rims crossed
is a fact about positions, and nothing in the overlay moves a node. Identity
goes stale; geometry does not.

### One name for an edge, wherever it is minted

None of this works unless a split edge and a declared edge over the same pair
of nodes are the *same* edge. Splitting one used to mint halves named after
the edge that was split, so a face declared later over one of those pairs got
a second, coincident edge lying on the first -- two lines, one drawn over the
other, and no face sharing either. `sharedEdgeId` is now the single rule, and
`insert-vertex` names its halves with it.

## Open

- **The X.** A run passing clean *through* another still crosses it. There is
  no arrival and no loose end: the rim goes in one side and out the other, so
  there is no corner to bend and no mouth to close. The construction is the
  same one at four corners instead of two, with the crossed run's flank
  rebuilt on both sides, and the crossing area itself becoming faces divided
  by both spines.
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
