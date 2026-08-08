# VTT wall representation: cell, edge, or free geometry

- Research date: 2026-08-08
- Status: **the evidence behind a decision that has since been made.** The
  owner chose option B; it is recorded in
  `docs/adr/ADR-0022-wall-representation-free-geometry.md` (DEC-060), which is
  the binding statement. This document keeps the comparison, including the
  arguments *against* the option chosen, because an ADR that only records the
  winning side is not reviewable
- Decision authority: none, same as every document in `docs/research/`
- Why now: the interior tileset is the next content work, and it is the first
  thing whose shape depends on the answer. Deciding after authoring a tileset
  means re-authoring it

## The question as it was posed

Is a wall *between* two cells (an edge), or does it *occupy* a cell?

A door almost certainly wants to be an edge — it is the passage between two
spaces. Choosing cells makes diagonal doors and thin walls awkward, and makes a
room's playable area disagree with the cells it spans, because the walls eat
some of them.

## Finding 1: the solver cannot decide an edge, and this matters less than it looks

Verified in `libs/domains/procgen/tileset-wfc/src/solver.rs`: an `Assignment`
is a `Vec<ModuleId>` indexed by cell. `graph.rs`'s `Link` carries `from`,
`from_face`, `to`, `to_face` and nothing else. **Nothing is ever assigned to a
link.** The solver's entire output vocabulary is one module per cell.

So a wall cannot be *decided* as an edge by the crate we have. It can only be
*derived*: a cell's chosen module declares, through its geometry and sockets,
which of its own faces are walls, and the wall people see lives on the face two
cells share. That is exactly how a facade tileset works, and it is how
Townscaper's own walls exist — as faces of chosen modules, not as separate
entities.

**Why this matters less than it looks.** The world model
(`vtt-world-model-and-grid-layers.md`, "Semantics are input to generation,
never output") already requires that semantic state be stored separately and be
authoritative, with generation a *view* over it. The authoritative record of
"there is a door here" is therefore not the solver's output under either
option. The solver's per-cell vocabulary constrains how a wall is *drawn*, not
how it is *stored* — and those had been running together in the framing.

## Finding 2: both mature VTT references store walls as free geometry

Neither reference implementation binds walls to grid cells at all.

- **Foundry VTT** stores a wall's `c` as `[x0, y0, x1, y1]` — the segment's two
  endpoints in scene coordinates. The wall tool snaps to an invisible sub-grid
  as an *authoring aid* (1/4 precision at 50px grids, 1/8 at 100px, 1/16 at
  200px), with a separate toggle to force snapping to the scene's own grid
  lines. Snapping is a convenience for the person drawing; the stored datum is
  a coordinate pair.
- **PlanarAlly** represents walls as ordinary drawn shapes carrying
  `Blocks vision/light` and `Blocks movement` flags. Vision stops at those
  shapes' borders. Again: free polygons, flags, no cell binding.

That is two independent projects, one of them the market leader and the other
the MIT codebase this project already treats as a reference, arriving at the
same answer without coordinating.

## Finding 3: the WFC literature does not address this

Checked rather than assumed. BorisTheBrave's "Wave Function Collapse tips and
tricks" — the source the map document already cites for interiors — gives a
four-tile recipe for square rooms, says room size is tuned by tile weight, and
adds "doors and corridor tiles" on top. It **does not distinguish** whether a
wall occupies a cell or sits between them; it treats walls as tiles and moves
on.

This is a genuine absence, not a gap in searching. The tile-generation
literature is about what fills a cell, because that is what those algorithms
decide. It has nothing to say about where a wall is stored.

## What the evidence actually reframes

The fork is not "edge or cell" inside one grid. It is:

**A. The wall is grid-bound** — stored as a cell, or as a `(cell, face)` pair.
Generation and semantics share one address space.

**B. The wall is free geometry** — stored as a segment or polygon in world
coordinates, with the grid used only to *author* it (snapping) and to *query*
it. Generation produces geometry; semantics reference geometry.

And B is what the three-layer model in `vtt-world-model-and-grid-layers.md`
already predicts. That document's central claim is that construction layers are
not constrained by the tabletop grid and meet it "only through queries against
geometry — does this position block movement, block sight, what is its
elevation — never through alignment." A grid-bound wall contradicts that claim;
a free-geometry wall is that claim.

Worth stating plainly: this was not the shape of the question when it was
written down, and the reframing is the main thing this document contributes.

## Finding 4: an owner constraint that is not a criterion

Stated by the owner while this document was being reviewed, and recorded here
because it changes the weighting rather than adding to it: **the mesh must stay
editable — remodelling, removing edges, re-partitioning — because procedural
generation is one of the four construction tiers, not the fixed one.**

A grid address survives vertex movement (the world model's "geometry deforms,
choices stay") but not re-partitioning. And the failure mode is worse than an
invalidated id: dissolve the edge a wall lived on, and where the wall went has
no correct answer — only a rule someone picks.

A is not thereby impossible. Its price is nameable: persistent per-element
identity instead of positional indices, plus a propagation rule for every
topological operation — subdivide, merge, dissolve. That is Blender's
custom-data-layer machinery, and it is infrastructure existing to support the
storage choice rather than anything the product ships.

This does not delete A's one real advantage, which stands: `Problem::compile`
takes `pinned` indexed by cell, so under A the semantic store and the generator
share an address space and pinning is direct. Under B that becomes a conversion
step with its own edge cases. That cost is real and is accepted rather than
argued away.

### A corollary that applies whichever option is chosen

`CellId` is an index into one solve, not an identity.
`apps/architecture-studio/src/vtt/shell-cell-graph.ts` numbers cells
positionally over materialised cells, so `withCell` shifts every id after the
one inserted. A semantic store keyed on `CellId` would be corrupted by a single
construction click, and the corruption would look random. Any grid-shaped
identity has to be `(quad, layer, face)`, which is stable under occupancy edits
though not under topological ones.

## Criteria that would settle it

Objective, checkable, in rough order of weight:

1. **Does a wall need to exist where no cell boundary does?** A diagonal
   partition, a curved wall, an imported map (Tier 2 / UVTT) whose walls were
   drawn without our grid. If yes, A cannot express it without subdividing the
   grid, and B is forced.
2. **Does the tabletop overlay have to agree with the construction grid?** The
   world model says no — they meet by spatial query. Under A the two grids must
   at least be commensurable for a room's area to make sense.
3. **What does vision-blocking consume?** Both references' visibility
   algorithms take *segments*. Under A, segments are derived from cell faces
   every time the geometry changes; under B they are the stored form already.
4. **What does a GM edit?** Dragging a wall endpoint is natural under B and
   meaningless under A, where editing means toggling cells.
5. **Cost of being wrong.** A → B is a data migration plus a rewrite of every
   query. B → A is a restriction, and cheaper.

## Risks recorded against each

**A (grid-bound)** — cannot express sub-cell geometry; imported maps must be
re-authored onto our grid or rejected; room area and tabletop movement disagree
unless the grids are commensurable; but the solver's output and the semantic
store share one address space, which makes "which cells are this room" trivial.

**B (free geometry)** — every spatial question becomes a geometry query rather
than a lookup, so it needs a spatial index to stay cheap, and "which room am I
in" stops being free; incremental generation still works, since the world model
already stores generated content as `(cell, module, rotation)` and geometry is
derived from it; but the link from a generated module's face to the semantic
wall record has to be maintained explicitly rather than being identity.

## What was not established

- **Both references are 2D, and this document's "two projects agree" argument
  is weaker than it first reads.** In Foundry and PlanarAlly a wall is a
  segment in a plane. This world is 3D with discrete layers, where a wall is a
  surface needing explicit vertical extent. Neither reference did that
  generalisation, so its cost is unmeasured and uncopyable. This is the most
  serious gap in the evidence above and is carried into ADR-0022's risks.
- Whether PlanarAlly's stored wall shape is a polyline or a closed polygon
  internally. The user-facing documentation says "shapes"; the source was not
  read in this pass.
- Whether UVTT's `line_of_sight` export is polyline-per-wall or a single
  merged set, which bears directly on criterion 1 and on the Tier 2 import
  already marked Standby in `vtt-product-scope-map.md`.
- Any measurement of query cost under B on a map of realistic size. Nothing
  here is a performance claim.

## Sources

- [Foundry VTT — Wall API (v14)](https://foundryvtt.com/api/classes/foundry.canvas.placeables.Wall.html)
- [Foundry VTT — Walls article](https://foundryvtt.com/article/walls/)
- [Foundry VTT Community Wiki — Walls](https://foundryvtt.wiki/en/basics/Walls)
- [PlanarAlly — Shapes documentation](https://www.planarally.io/docs/game/shapes/)
- [BorisTheBrave — Wave Function Collapse tips and tricks](https://www.boristhebrave.com/2020/02/08/wave-function-collapse-tips-and-tricks/)
- `libs/domains/procgen/tileset-wfc/src/{solver,graph}.rs`, read directly
