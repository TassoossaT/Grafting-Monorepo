# VTT path spine: the travel line as a stored seam

- Status: **partly implemented** — the spine, its identity scheme, and its
  edit cascade are built. Junction faces, per-corridor recipe persistence,
  and the bridge type are **not**; see "Open" below.
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
- Related: `vtt-atomic-edit-and-cloud-policy-design.md` (the role/policy
  machinery this reuses unchanged), `vtt-product-model.md`.

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

## Open

- **Junction faces.** A crossing is two spines sharing a node, and an overpass
  is two spines crossing with no shared node — the model expresses the
  difference, but the overlap does not yet become one junction face. Today
  `apply_region_overlay` consumes the earlier path and rebuilds a remainder
  with a hole, which is union, not junction.
- **Per-corridor recipe.** The spine records *where*, not *what*. Changing a
  run's type is a regeneration, and needs the recipe persisted per corridor —
  which is also the argument for each road type becoming its own surface type,
  as `wall-white` and `wall-gray` already are.
- **Bridge.** Two of three pieces are in reach: a spine station may already be
  lifted (`ALL_AXES` on the spine role), and `interactionOver` can return
  `IGNORE` so a deck does not cut what it spans. The blocker is that
  `getFootprintCoverage` is a 2D XZ query and cannot tell an overpass from a
  same-level crossing.
- **Remainder collapse.** `region_overlay.rs` folds every consumed region into
  one remainder carrying the first one's surface type. A network that loses
  surface identity on every stroke cannot be administered.
