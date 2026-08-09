# VTT terrain surface continuity: why stage 4 steps, and what the field does

- Research date: 2026-08-08
- Status: **evidence for an open question**, prompted by the terrain tileset
  trial rendering as vertical walls rather than a landscape. Closes nothing
- Decision authority: none, same as every document in `docs/research/`
- Scope: how the visible terrain surface crosses a change of height, in
  `/lab/terrain-tileset` (stage 4). Not about the tileset's art, the shell
  graph, or the wall-representation decision in `ADR-0022`

## The symptom, measured

At `trianglesPerSide: 4`, `Discrete levels: 4`, seed 1 (200 quads, 376
adjacent column pairs):

| height difference between neighbouring columns | pairs |
| --- | --- |
| 0 | 126 |
| 1 | 191 |
| 2 | 56 |
| 3 | 3 |

Two thirds of neighbouring columns differ, and each difference renders as a
bare vertical face. Of 270 lateral solid-solid links, only **126** join two
roofs — exactly the same-height pairs.

## What is actually happening

1. **Height is decided before the solver runs.** `discretize(sampled, levels)`
   bins noise into levels, with nothing limiting the jump between neighbours.
2. **The shell graph links cells by layer.** Two adjacent quads are linked at
   each layer both occupy. A column of height 4 beside one of height 2 links at
   layers 0 and 1 only.
3. **Their roofs are therefore never linked.** The tall column's roof is at
   layer 3, the short one's at layer 1. What *is* linked is the short column's
   visible roof to the tall column's **buried interior** cell.
4. So `RISE`/`FALL`/`HIGH`/`LOW` — sockets whose whole purpose is to say how a
   surface continues across a boundary — can only fire between cells at equal
   layers, which is precisely where no step exists. Where a slope is needed
   there is no link to carry one.

## Finding 1: this repository already solved this, and stage 4 did not adopt it

The decisive evidence is internal. `apps/architecture-studio/src/vtt/transition-shapes.ts`
(stage 3, trial `/lab/terrain-transitions`) opens with:

> The move that does the work is not the mesher, it is the change of model.
> Stage 2 attaches elevation to **cells**, so each cell is a box and two
> neighbours at different levels meet at a vertical face. Here occupancy
> attaches to **corner columns**.

A corner takes the highest level of the cells meeting at it, and the rendered
surface is the boundary of that union — so it passes *between* samples instead
of through them, and a step comes out chamfered rather than square. Extracted
with marching tetrahedra (chosen over marching cubes because a tetrahedron's
sixteen corner states derive in a few lines, while the widely-copied 256-row
marching-cubes table has no clear licence).

Stage 4 was built on stage 2's per-cell model and inherited the exact defect
stage 3 exists to remove. The registry already said so about stage 2, in
advance: *"neighbours at different levels meet at a hard vertical step;
smoothing those steps ... is a later stage, not a defect of this one."* It is a
defect of stage 4, which had the later stage available and did not use it.

Run the two trials on the same seed and the difference is not subtle: stage 3
renders a continuous landscape, stage 4 a palisade.

## Finding 2: the technique has a standard name and a standard size

Externally this is the **dual grid** (or corner/vertex) tileset, and it is the
conventional answer rather than an exotic one.

- The data lives on cell **corners**; the drawn tile is chosen by the four
  corner values of the quad it sits in — 16 configurations, collapsing to about
  6 canonical cases under the square's symmetry group.
- Tile counts are the headline: a dual-grid set needs **15–16 tiles** where the
  per-cell "blob" equivalent needs **47+**, and the corners come out better.
- **Marching squares is the same idea**: assign values to corners, then draw a
  contour through the cell. Dual-grid autotiling swaps the contour for a
  pre-drawn tile. Stage 3's marching tetrahedra is the 3D member of that family.

BorisTheBrave's classification is worth reading before authoring anything: it
labels these families (`S-V2` for square/vertex/two-value, `S-E2` for edges) and
is careful that neither is universally better — the same classification can
produce different looks depending on matching rules. The reason to prefer
corners *here* is not aesthetics, it is that our problem is a step between
heights, and a corner is the only thing two columns of different height share.

## Finding 3: Townscaper does it on corners too

Reported technique: a quad's tile is chosen by its four corner values, and the
geometry is effectively 2.5D — a 2D corner grid extruded into columns — so the
per-floor logic stays the small 2D case set plus vertical connectors, rather
than full 3D marching cubes.

This matches what stage 3 already recorded: *"Townscaper gets the same result
from a hand-authored set of about fifteen shapes; the fifteen shapes are art on
top of this model, not a different one."*

That sentence is the whole answer to what the WFC pass should be doing. The
surface's *shape* comes from corner occupancy. The tileset chooses the *art* for
each corner configuration. Stage 4 currently asks the tileset to do both, and
the socket vocabulary cannot express the second.

## Finding 4: there is nothing to substitute — the survey is already done

Checked against `docs/research/RESEARCH-DECISIONS-REGISTRY.md` rather than
re-researched:

| Candidate | Status today | Bearing on this problem |
| --- | --- | --- |
| `wave-function-collapse` (AustinHeller) | **Adopted**, behind our `ConstraintSolver` seam | Stays. Nothing here is the solver's fault |
| `ghx_proc_gen` | Superseded for the irregular grid | Its AC-4 needs globally fixed direction indices our grid cannot provide |
| `fast-surface-nets-rs` | **Decided**, narrowed to heightmap seeding and background scenery | Surface extraction from a scalar field — the same family as stage 3, but stage 3's marching tetrahedra already covers the buildable area and is licence-clean |
| `block-mesh-rs` | Standby | Blockier alternative, only if stepped is the wanted look |
| `sketchpunklabs/irregular_grid` (MIT) | Reference only | The one usable code reference: JS + Three.js, half-edge, grid generation *and* marching-cubes meshing. Not copied from; adapting any of it needs a `THIRD_PARTY_NOTICES.md` marker |
| Sylves, DeBroglie (BorisTheBrave, C#) | Reference only (concept) | Sylves ships a marching-squares tutorial; C#, so concept reference only under DEC-001 |

So "which library replaces this" has no answer, because the missing piece is not
a library. It is that stage 4 reads stage 2 instead of stage 3.

## The options

**A — put stage 4's tileset pass on corner occupancy.** Feed the tileset the
corner-column model stage 3 already produces, and let the surface shape come
from the corner configuration while the tileset chooses art per configuration.
No new dependency; `transition-shapes.ts` exists and is tested. Cost: the
tileset's socket vocabulary is rewritten around corner configurations, and the
shell graph and the corner model have to be reconciled rather than coexist.

**B — smooth the seed.** Post-process the heightfield so neighbours differ by at
most one level. Removes the 56 two-level and 3 three-level cliffs, so the
picture improves markedly. Does **not** fix the missing link — roofs still sit
at different layers — so the tileset still cannot shape a step. Honest as a
stopgap if labelled one.

**C — accept stepped terrain.** If the wanted look is blocky, the current render
is not wrong: it is the correct rendering of a discrete heightfield, and
Minecraft looks like this deliberately. Then the work is polish — cap the step
at one level, give the vertical face its own material — and `block-mesh-rs`
becomes the relevant crate rather than a smooth-surface one.

**D — make the height an output of the solver.** Stop imposing elevation; let
the tileset decide where terrain steps, with the heightfield as a weight.
Adjacency then is always same-layer because layers become a result. Closest to
Townscaper, which has no heightfield at all — the player builds. An
architectural change, not an adjustment.

A is what the evidence points at, and it is cheaper than it sounds because the
model and the mesher are already written. But **C is a legitimate answer to a
different question**, and which question is being asked — stepped or smooth —
has not been decided anywhere in this repository. That is the owner's call and
it should be made before any of this is built.

## What was not established

- No measurement of what the corner model costs at the shell graph's scale, or
  how the two graphs reconcile. Stage 3 meshes; it does not solve a tileset.
- Whether the ~15-shape art layer can be authored against corner configurations
  with the sockets/rotation machinery `tileset-wfc` already has, or whether that
  layer wants a different mechanism entirely.
- Nothing here measures performance. The cell counts quoted are structural.

## Sources

- `apps/architecture-studio/src/vtt/transition-shapes.ts` and
  `docs/research/RESEARCH-DECISIONS-REGISTRY.md`, read directly
- [How Townscaper Works (Game Developer)](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making)
- [BorisTheBrave — Classification of Tilesets](https://www.boristhebrave.com/2021/11/14/classification-of-tilesets/)
- [BorisTheBrave — Quarter-Tile Autotiling](https://www.boristhebrave.com/2023/05/31/quarter-tile-autotiling/)
- [Sylves — Marching Squares tutorial](https://www.boristhebrave.com/docs/sylves/1/articles/tutorials/marching_squares.html)
- [Red Blob Games — Autotiling](https://www.redblobgames.com/articles/autotile/claude/)
- [Excalibur.js — Dual Tilemap Autotiling Technique](https://excaliburjs.com/blog/Dual%20Tilemap%20Autotiling%20Technique/)
- [TileMapDual (Godot, MIT)](https://github.com/pablogila/TileMapDual)
