# VTT node and wall handle design notes

- Status: **discussion record; not an accepted ADR, not an implementation
  plan**
- Date: 2026-08-17
- Scope: direct-manipulation gizmo/handle behavior for the `node`, `edge`,
  and `surface` target scopes defined in
  `docs/architecture/vtt-edit-mode-and-surface-transformations.md` §3.
  First concrete case worked out: wall editing.
- Related: `docs/architecture/vtt-edit-mode-and-surface-transformations.md`
  (terms, `Effect`/`Transformer`/`TransformationPlan` contract, Phase A–E),
  `docs/research/vtt-reactive-construction-and-tiny-glade-ui-model.md`
  (Tiny Glade handle research — product-level, not code-audited),
  `docs/research/vtt-tiny-glade-open-source-ecosystem.md`.

This file records an in-progress design discussion. It intentionally has two
sections: decisions the owner has already settled, and questions still open.
Nothing here is authorized for implementation by itself — it exists so the
discussion isn't lost and so a future implementation plan can be written
against settled ground instead of re-deriving it.

## Why this discussion started

The owner flagged the existing `move-node-tool.ts` as "always badly
implemented." Investigation (recorded here, not repeated in full) found
concrete root causes, not a vague impression:

- No explicit drag-constraint model — the drag target is whatever the
  raycast hits; dragging off pickable geometry silently freezes the node
  (`apps/vtt/notes/0005-edit-mode-interaction.md`, unfixed known gap).
- `moveNode` commits on every pointer-move tick instead of once on release,
  contradicting the gesture lifecycle already specified in the edit-mode
  doc §7.
- Undo/redo re-issues absolute float positions and has a documented
  precision-drift bug (`apps/vtt/notes/0007-render-correctness-follow-up.md`),
  instead of replaying a captured semantic effect.
- `move_node` in `libs/graph/core/src/construction.rs` performs zero
  geometric validation (its own doc comment: "cannot fail for any reason but
  the node not existing") — a drag can silently produce a non-planar ring
  that breaks `surface-mesh`'s `earcut` triangulation with no surfaced
  error.
- Shared nodes (T-junctions) propagate to every referencing surface
  mechanically, with no consistency check and no signal to the user of how
  many surfaces a drag is about to affect.

Two prior worktree attempts at gizmo/handle work
(`VTT-TINY-GLADE-DIRECT-GIZMOS`, `VTT-TINY-GLADE-FLOATING-ARROWS`) are
considered failed experiments by the owner and are **not** being
reconciled — only the two research docs above remain valid inputs, plus
whatever this file records going forward.

The owner wants node/edge/surface handles designed together, not as
separate narrow slices, because wall (surface-scoped) editing turns out to
be node editing plus a coupling layer, not a separate mechanism — see
below.

## Settled: wall node roles

A wall's vertical run has a bottom node and a top node per corner (the
existing 4-node cycle per `SurfaceCurvature`'s doc in
`libs/graph/core/src/surface.rs`). The two nodes have different, asymmetric
degrees of freedom:

- **Bottom node:** XZ position is user-controlled (dragging repositions
  that corner in plan). Y is **never free** — it is always resolved by
  snapping to the nearest base surface directly below (terrain, a floor, the
  top of a lower structure, etc.). A wall can never float; if there's no
  valid base below, there's no valid position there.
- Moving the bottom node **preserves the current bottom-to-top distance**
  (wall height at that corner) — the top node is carried along at a
  constant vertical offset. The bottom node cannot change that distance
  itself.
- **Top node:** its one job is controlling that distance (wall height at
  that corner) — it can increase or decrease it independently per corner,
  enabling sloped/uneven wall tops (e.g. following a roofline).

## Settled: directional handle family (not a free 2D/3D gizmo)

Handles surrounding a wall are each locked to the axis that's semantically
meaningful for that part of the wall, not a free-drag gizmo:

- **End/tip handles** (the corner handles): move along the wall's own run
  axis — extend/shorten/reposition that end, following the wall's own
  direction.
- **Top handle:** always the vertical axis (height, per corner node role
  above).
- **Side handles** (perpendicular to the wall, one per side, `<- | | ->`):
  each locked to its own perpendicular axis, moving in whichever direction
  it's pulled. This is the "pull the wall sideways" gesture that bows it
  into a curve.
- A **middle-of-wall handle** is not a distinct mechanism — it's the two
  end handles operating together (e.g. raising both corners' height at once,
  or moving the whole run).

## Settled: node identity / topology rule (generic, not wall-specific)

One rule covers every case, not separate rules per scenario:

- If a handle's resolved position lands on an **existing node**, it reuses
  (welds to) that node — this covers two walls meeting at a corner or
  T-junction identically to any other coincidence.
- If a handle's path **crosses the interior of an existing surface**
  (e.g. a wall drawn straight across the middle of a terrain face), that
  surface must be **split**: new boundary nodes/edges are minted only where
  the crossing actually cuts through, existing boundary nodes are reused
  where they still connect to unaffected geometry, and the surface is
  divided into the resulting fragments.

This second case is explicitly **the same capability already implemented
for the path-brush's Phase B** (surface-transformation `Transformer`,
already complete per the owner — see
`docs/architecture/vtt-edit-mode-and-surface-transformations.md` §5.1). The
owner's explicit intent: this "cut a surface where something crosses it"
capability must be a **generic, reusable Rust capability**, not code
specific to terrain→path. Wall editing, and — named explicitly as future
uses — irregular-terrain correction/regeneration and floor/interior editing
(future cloud-type edit modes) are all expected to reuse the same
underlying split-on-crossing engine, each only supplying its own resulting
surface type and formation profile on top.

**Action item for whoever owns the in-progress Phase B work:** confirm the
surface-crossing/split capability is factored as a generic function of
(surface polygon, crossing region) → fragments, not hardcoded to
terrain-becomes-path, so it can be reused here without rework. This wasn't
verified against the actual Phase B code as part of this discussion — it's
a request based on the contract's stated intent, not a confirmed fact about
the current implementation.

## Settled: map-bounds constraint

Dragging a handle must never be able to place a node outside the map
bounds. (Exact mechanism — clamp to nearest valid position vs. reject the
gesture — is still open, see below.)

## Open questions

1. **Map-bounds behavior at the limit.** Does the handle clamp to the
   nearest valid position at the boundary (continues tracking the pointer
   but stays pinned to the edge), or does crossing the boundary
   cancel/reject the whole gesture?
2. **Wall height limits.** Does the top node's height-adjustment have an
   explicit min/max, or is it unconstrained beyond generic geometric
   validity (non-zero/non-negative distance, no self-intersection)?
3. **Generic (non-wall) node handle.** Wall corner roles are a coupling
   layer on top of a plain node move. What does dragging a node that
   belongs to no wall (a loose terrain vertex, a future floor vertex) do —
   does it inherit the same "snap Y to nearest base below" rule, or is that
   specifically a wall-role behavior?
4. **Curvature control detail.** Side-pull bows a wall into a curve
   (existing `SurfaceCurvature`/`ArcBulge`, PRs #143/#139). Is the resulting
   angle purely derived from how far the handle is pulled, or is there a
   separate numeric angle/degree control in addition to the visual pull?
5. **Scope of this role model beyond walls.** Should terrain and future
   floor/roof surfaces get their own top/bottom/side role definitions as
   part of this same design pass, or does this pass finish walls first and
   let other surface types define their own roles later on the same
   generic foundation?
6. **Handle visibility/visual design.** How many handles are shown at once
   when a wall is selected (all simultaneously, or contextually as the
   pointer nears each part), and how a wall-role handle is visually
   distinguished from a plain node handle.
7. **Composite preview.** A wall drag can simultaneously weld to a
   neighbor's node and split a crossed face. How does the preview represent
   both consequences before the user commits, and how does the resulting
   `TransformationPlan`/undo entry read as one semantic operation covering
   all of it?

## Explicitly not decided by this file

- Any implementation plan, file list, or build order.
- Whether `cloud`-scoped operations (explicit whole-cloud regeneration, per
  edit-mode doc §10) are affected by any of the above — they remain a
  separate, explicit action, not a drag handle.
