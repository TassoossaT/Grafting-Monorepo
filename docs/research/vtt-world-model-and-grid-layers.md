# VTT world model: grid layers, semantics, and incremental generation

Design conclusions from the 2026-08-08 session, recorded because they exist
nowhere else. Not a decision gate: nothing here is closed, and the open
questions at the end are open.

## Three layers, meeting only by spatial query

- **Terrain** — the irregular quad grid. Organic; a mountain is not square.
- **Structure** — buildings. Their own regular sub-grids (see below).
- **Tabletop** — the play grid, an *overlay*. Movement, ranges, line of sight
  are computed here.

The construction layers are **not** constrained by the tabletop grid. They meet
it only through queries against geometry — *does this position block movement,
block sight, what is its elevation* — never through alignment. A GM choosing to
snap construction to the tabletop is an editing option, not a property of the
model.

This dissolves the tension that a single grid creates: an irregular grid cannot
express "move 6 squares" (cells differ in size, and no consistent compass
labelling exists — measured at 58–93 irreducible contradictions per grid
against zero on a regular control), but it does not have to, because the rules
live on the overlay.

## A regular region inside the organic mesh

**A square house on the grid is possible.** An earlier claim in the session that
it was not is wrong and is corrected here.

The grid is not irregular by nature. It is a quad mesh that a **relaxation**
step pushes off the lattice. Excluding a region's vertices from relaxation
leaves that region regular, inside the same connected mesh, with the same
adjacency. Nothing downstream notices: `quadAdjacency` works on indices and
slots, and `placeModule`'s bilinear map is the identity on a square quad.

Two consequences worth knowing:

- **A transition ring.** A quad with four pinned corners is square; one with
  two pinned and two relaxed is trapezoidal. Regular interior with a
  regular boundary against organic terrain is not available — something has to
  absorb the difference, and the ring is where it fits best.
- **Regularity is a property of positions, not topology.** Interior vertices of
  valence other than four still exist near the boundary. Harmless: the
  slot-pair direction encoding already handles them.

## Semantics are input to generation, never output

A door has fixed behaviour; its appearance may be generated. Semantics attach
to a **region** — "the area under these cells is a door, outside it is wall" —
not to individual tiles.

This is already implemented as `Problem::compile`'s `pinned`: a semantic region
is a constraint restricting which modules may appear there, and the solver
fills in the visuals.

**The rule that must hold:** semantic state is stored separately and is
authoritative; generation is a *view* over it. A symptom of getting this
backwards is any code asking "which module did the solver put here?" in order
to decide whether something is a door.

## Generation is fixed, and grows incrementally

Once generated, geometry stays. There is no re-roll, which removes the risk of
a reseed moving a door out from under a token.

What replaces it: **a newly requested area must be consistent with frozen
neighbours.** Again `pinned` — fix the built cells, solve only the new ones,
and the solver must meet the boundary.

The authoring intuition ("unlikely to generate a door on a rock, likely beside
a wall") is exactly what a tileset already expresses: socket compatibility for
*cannot*, module weight for *likely*. No new mechanism.

### Moving points after generation

"Generation is fixed" and "points can be moved" are in tension, since moving a
vertex changes the neighbourhood the generation was conditioned on. Two ways
out; the first is recommended and already built:

1. **Geometry deforms, choices stay.** The chosen module is remapped onto the
   quad's new corners. `module-placement.ts` does this, and neighbouring cells
   still agree along a shared edge (verified over 500+ comparisons on a real
   grid).
2. Re-solve locally — at which point generation is no longer fixed.

**Therefore:** generated content is stored as `(cell, module, rotation)`, never
as baked world-space vertices. Baking breaks point editing.

## Open questions

- **Failure policy.** With neighbours frozen, some requested areas will have no
  solution. This will happen, not might. Townscaper's documented answer is
  *graceful local failure* — allow an odd or disconnected element rather than
  freezing generation. The alternatives are refusing the build, or unfreezing
  neighbours (which breaks "fixed"). This changes the API shape: if local
  failure is allowed, the solve returns a partial result rather than an error.
- **Cell or edge?** Is a wall *between* two cells (edge) or does it *occupy* a
  cell? A door almost certainly wants to be an edge — it is the passage between
  two spaces. Choosing cells makes diagonal doors and thin walls awkward, and
  this is expensive to change later.
- **"a 4×4×4×4 mesh"** from the session is not understood well enough to record
  faithfully, and is deliberately left unrecorded rather than guessed at.

## Known defect: stage 4 solves the volume, not the shell

`/lab/terrain-tileset` stacks cells to the ground and gives every cell a
module. Consequences, from reading rather than measurement:

- most of the solve decides buried geometry;
- the *visible* surface is nearly unconstrained exactly where it matters, since
  columns of different heights share no layer and therefore no lateral link;
- `hollow` (`corners [0,0,0,0]`) is coplanar with the top of the cell below,
  which z-fights.

Stage 3 had already moved occupancy from cells to **corner columns**; stage 4
regressed to cells. Townscaper's own tileset is a shell — its 500+ modules are
facade, roof and decoration. Nobody solves the interior of a solid block.
Stage 5 (decoration) does not fix this: it layers props over a solved
structure.

## Reconfirmed

`building-blocks` (bonsairobo) was raised again and remains **discarded**:
archived 2023-11-13, read-only, with the author directing users to the extracted
crates — which are `fast-surface-nets-rs` and `block-mesh-rs`, both already
verified on `wasm32` in this repository. It is also a dense-voxel library, the
opposite of the direction stages 1–4 deliberately took.

## Why a substrate change would be cheap

Almost nothing built so far depends on the grid being irregular.
`tileset-wfc` is grid-agnostic by construction (`CellGraph` is cells and links),
`discretize` operates on an arbitrary continuous signal, and the bench elements,
preview registry and geometry viewport are all generic. Only
`quad-cell-graph.ts` and `module-placement.ts` are tied to the irregular quad,
and both are small.
