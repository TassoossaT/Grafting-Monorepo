# Note 0012 — Terrain as one surface in 3D

- Recorded: 2026-10-05
- Status: implemented 2026-10-06 (TASK VTT-TERRAIN-REGEN-CALIBRATION, PR #353); see **As built** for where it differs from the plan, and **Open** for what is left
- Related: note 0011 (cut before TASK-333), ground contact law, terrain regen as a brush stroke, 3D carve/fill (`solid-field`)

## Verdict

The ground is **one oriented surface in 3D**, made of `ground` regions. **No code may assume one ground height per point of the plane.** There are only two engine operations:

- **E1 `edit_surface`** — volume edit: the edits that change what is solid. The brush's ball uses it off flat ground (a flank, a cliff, a ball on the last ball).
- **E3 `layer_surface`** — the surface moved. The ball as a cap on ground facing up, Aplainar, and **the ground brought to rest under structures** (beds, 2026-10-07) use it.
- **E2 `regenerate_surface`** — relays the cells of a patch of surface, with the shape unchanged. No longer used by structures since the rest law (2026-10-07); still inside E3 for ground folding over itself.

**Rest law (2026-10-07, owner):** a structure never cuts the ground. The ground is brought to rest just under it (see **Rest law** below); the ground stays one surface with no hole and no side shared with a structure.

Patches are always chosen **by walking the surface**, never by plan coverage. The planar terrain path is deleted, not kept as a fallback.

## Why

The terrain was 2.5D: Adicionar, Remover, Aplainar and the structure regenerate laid ground as a function of (x, z). That meant plan CDT in `fillTerrain`, heights from `groundSurfaceOf` / `heightFieldOf` over all standing ground, and plan coverage from `footprint_coverage`. Cavar/Erguer 3D were added on top, with one guard (`overhangingGround`) that stops relaying overhanging faces but still lets them feed every height lookup. Where two layers share a plan point (tunnel ceiling over its floor, bridge deck over the gap), planar tools blend the layers and the upper mesh merges into the lower one. That is the owner's report, from 2026-10-05, of an Adicionar arc. The owner rejected a layer-aware patch and chose this refactor.

Owner decisions (2026-10-05):

1. Adicionar is volumetric: a volume of earth, never faces offset one by one.
2. The planar path is deleted.
3. Latency is irrelevant; always choose the best algorithm and quality.
4. Everything is in scope: structures inside caves and on earth bridges, roads over 3D ground, regenerate working in all of it.

## Invariants (tests hold every one)

- **I1. One ground mesh.** No ground edge is held by more than 2 ground faces. Open edges exist only on the map border (since the rest law: never round a structure).
- **I2. Layers never mix.** An edit or a repair changes only faces reachable over the surface from where it acts. A face on another layer over or under the same plan point is never read for heights and never relaid.
- **I3. The preview is the contract.** E1 changes faces only within the volume's reach plus its blend, and the ghost shows that volume.
- **I4. The ring is untouched.** The nodes round a patch come back as the same nodes, with their edges unsplit except by explicit adoption.
- **I5. Rest law, measured in 3D** (replaced the contact law 2026-10-07). Ground within 1.5 m under a structure (`GROUND_CONTACT_CLEARANCE`) or up to 6 m rising through it is brought to rest 8 cm under its faces, eased back over a shoulder; never through another sheet of ground (a tunnel's ceiling, a deck's underside). Ground farther off is untouched.
- **I6. Stable counts.** Moving a structure back and forth, or repeating a stroke, does not grow the face count; the stroke-margin rule from the regen brush-stroke work carries over.
- **I7. Determinism.** Same input gives the same output. Iterate in sorted order; never rely on HashMap order.

## Engine (Rust)

### E1 `edit_surface` (crate `solid-field`, exists — extend)

The current steps stay:

1. Signed distance of the patch plus context.
2. CSG with the shapes.
3. Surface Nets read: clean read at two grids, mend as a last resort.
4. Zipper to the ring.
5. Isotropic remesh with the ring locked.
6. Irregular-grid pair, ortho and weld.
7. Per-cell relax, settled onto the surface.

Extensions:

- **Shapes.** Shapes are signed-distance primitives combined by CSG. The current capsule-chain carve and fill stay. New ones:
  - `mound` (Adicionar): a swept volume along the stroke whose cross-section follows today's cosine profile (`height`, `radius`) plus seeded noise. It is unioned, resting on the surface the stroke hit: its base is placed by the hit points, not by a plan height.
  - `dig` (Remover): the same profile, subtracted.
  - `flatten` (Aplainar): inside the stroke's swept prism, intersect with the half-space under the target plane, then union with the slab up to it.

  All shapes expose `distance` and `bounds(blend)`, so the reach and the ghost come from the same data.
- **Table floor.** The table is solid below y = 0. It is a field term that is never meshed: a triangle of the read lying on the plane outside the patch is dropped. An Adicionar on an empty table gives a mound whose rim rests on the table, not a closed blob.
- **Constraints.** Structure-held nodes and edges inside or on the patch are locked through remesh and relax, like the ring, so an edit beside a structure keeps its contact. A shape may not move a structure's node: such a node is clamped and reported, never an error after release.
- **Empty patch.** A shape over bare table becomes E1 with an empty patch: the ring is the read's own border on the table plane.

### E2 `regenerate_surface` (new, `solid-field` or a sibling crate)

The input is a patch that is a topological disk (or a disk with holes), its ring, and the structure rings to meet (constraint rings plus sources, as the current `ConstraintTable`). The output uses the same contract as E1 (`EditedSurface`: vertices, faces, ring `source`).

1. **Chart.** Map the patch to the plane:
   - first try projection along the patch's area-weighted mean normal, accepted only if every projected triangle keeps its orientation (injective);
   - otherwise use a Tutte / mean-value embedding with the ring on a circle by arc length, which is injective by Tutte's theorem.
2. **Constraints into the chart.** Locate structure contour points on the patch (closest point, then barycentric coordinates) and map them into the chart. Contact areas become holes; sources keep their node ids.
3. **Generate** with the existing constrained irregular-grid generator (`irregular-grid/constrained.rs`, the same one behind `generateIrregularQuadGrid`), at the face size measured in 3D: the chart's local scale corrects the target size per triangle.
4. **Lift.** Map chart points back through the old patch triangulation (piecewise linear). Sources take their exact node position. Then relax per cell in 3D, settled onto the old surface.
5. **Non-disk patch** (Euler characteristic and border count say a handle, e.g. a ring round a tunnel through a hill): run E1 with no shapes, i.e. a pure remesh with constraints locked.

### Queries (in the session, Rust)

Selection runs where the graph lives; TS never pulls every face to search it.

- `terrain_patch(seed, reach)`:
  - `seed` is a hit face (`PointerSample.surfaceRef`), a volume (shapes plus blend) or a structure's footprint;
  - grow over shared edges while a face is within `reach` in 3D;
  - return the patch faces, the ring, and the context faces (a band round the patch) for E1's distance field.
- `ground_below(points, max)`: for each point, the first ground face hit going down, with its height and key. A BVH or bucket grid over ground triangles. This replaces `groundSurfaceOf` for contact, `structures.heightAt`, roads and creation interaction.
- `footprint_coverage` is no longer used for ground. Structures keep their own uses of it.

## App (TypeScript)

- **Tools** (`terrain-sculpt-tool.ts`). Adicionar, Remover, Aplainar, Cavar 3D and Erguer 3D all build a shape and commit through one function, the successor of `commitTerrainVolumeEdit`, in one transaction. Previews are volume ghosts drawn from the same shape: the shapes' outer surface as wireframe, in the existing look, with no new colours.
- **Regenerate** (`terrain-lattice-reaction.ts`, `terrain-regenerate.ts`, `structure-contact.ts`):
  1. The reaction still decides what changed, which faces were consumed and dragged, and where the structure was vacated.
  2. The repair area is the stroke round old plus new footprint (`STROKE_MARGIN`), selected on the layer under the structure via `ground_below`, then grown by surface walk.
  3. `meetStructures` keeps its job (contact area, shared and sealed loops, resting nodes, sealed-side heights) but reads ground through `ground_below` and expresses contact rings in 3D.
  4. The constraint table goes to E2.
  5. Removal repair (something deleted) relays the vacated faces with E2.
- **Commit.** Keep the half of `fillTerrain` that registers faces: the minting, replacement, adoption of contour nodes (splitting a neighbour's edge where a node landed on it) and seeds, generalised to 3D distances. The plan generation half goes away; geometry comes back from E1 or E2.
- **Roads** (`path-cloud-transaction.ts`, road cloud regeneration). Spine heights come from `ground_below` at the spine's own hit points. A road drawn on a bridge deck stays on the deck, and one through a tunnel stays on its floor. The road cut into the ground uses E2 with the road's contour as a constraint.
- **Creation interaction / ground contact** (`creation-interaction.ts`, `topology/ground-contact.ts`): `groundContactOf` measures against `ground_below`.

## Render

`construction-wasm/src/mesh.rs` triangulates each region in its own plane (Newell normal, then a 2D frame), not in the plan. Non-planar polygons are fan-split by ear clipping in that frame. This ends the "no mesh derivable for analytic region" failures on 3D-made faces.

## Deleted

Delete these, together with their tests or with the tests rewritten against the new behaviour:

- the plan generation half of `terrain-fill.ts`;
- the planar paths of `terrain-cut-executor.ts` (convex, concave, regenerate profiles, `growing for room`, plan `targetPolygon`);
- `constraint-rings.ts` plan resampling where E2 replaces it;
- `terrain-restack.ts`;
- `terrain-overhang.ts`;
- `heightFieldOf`;
- `groundSurfaceOf` as a ground-height source;
- the sculpt brush's `brushSweptOutlinePolygons` / `getFootprintCoverage` use for ground;
- `structural-cut.ts` `calculateProfile*` once nothing reads them.

## As built (2026-10-06)

Read this before the plan sections above; where they disagree, this wins.

- **No new session queries.** `terrain_patch` and `ground_below` were not added to the Rust session. Selection walks the surface in TS over bounded region queries:
  - `ground-surface.ts` holds `walkSurface`, `closedPatch` and `surfaceComponents`;
  - `closedPatch` takes in the faces round a pinched corner, steps one ring out where a structure's hole meets the border, and takes in islands of ground the patch rings round.
- **Layered contact law** (I5). The sunk-or-resting decision lives in `ground-contact.ts`:
  - `groundSurfaceOf(ground, own)(point, reference)`, with `groundLayerAt` choosing the layer;
  - the first surface over the reference counts when it faces up, because the thing is sunk there; otherwise the first surface under it counts; a ceiling alone over it means no ground;
  - `facesUp` is read from the tabletop winding, whose right-hand normal points down.

  `groundContactOf` passes the structure's own height at each sample, and the reaction's departing-contact read uses the same rule.
- **Regrow** (`terrain-regrow.ts`), which replaces `repairTerrainCut`:
  1. Band: the structure's heights, from the contact reach below to 1.5 faces above.
  2. Faces with an open side inside the vacated area always join, whatever their height. A floor half sunk in a hill leaves a rim that climbs over the band; a ceiling holds no such side.
  3. Dragged faces are replaced but never read as the surface. They are ringed by neighbours, so the hole they leave is capped.
  4. Contact rings come straight from `meetStructures().area`, never resampled.
  5. Face size is the median side of the square of each face's area, measured in 3D and clamped to 2–6 m.
  6. One E2 call runs per connected piece.
- **E2** (`solid-field/src/regenerate.rs`):
  - Faces are ear-clipped across the patch normal; a fan would turn concave contour cells over.
  - Holes are capped by ear-clipping the rim; concentric rings are the fallback.
  - The chart is the projection when its rim is simple and at most 1% of the area turns over; otherwise it is a mean-value embedding solved by plain Gauss-Seidel. Over-relaxation diverged on these non-symmetric weights.
  - The ground is computed in the chart as the rim minus the holes, by `i_overlay`, with collinear rim corners restored. Raw overlapping constraints panicked spade, and in wasm that panic kills the session.
  - A corner landing on a side is lifted through the chart and projected onto the side in 3D. It is dropped as a landing when it lies more than a face away.
  - There is no 3D relax: it measured no better and folded a cell at a structure's corner.
- **E1** (`edit.rs`, `field.rs`, `table.rs`):
  - Adicionar and Remover are `Effect::Raise` / `Effect::Lower` with `Form::Profile { height }`. The surface moves out or in by a cosine layer, with its depth read at the point's foot on the old surface.
    - A squashed capsule was tried first. It overhung on slopes and stood vertical at its foot.
    - Faces are refined to `min(r, 2r²/(πh))` for sharp ridges.
  - Aplainar is two `Form::Column` shapes: a fill below and a carve above the stroke's first height, reaching `max(2·step, radius)` either way.
  - The table floor is solid below y = 0 only where no ground covers the plan point. There the ground distance counts as unsigned, because the sign past an open border lies.
  - A free border side is released only where a shape reaches it. The read's foot is set down on the table and locked.
  - Ring chains handle partly held rings, stitched with `zipper_open`.
  - Structure faces arrive as `neighbours`: their sides are held, but they are never solid.
  - A layer's depth is read across the ground at the nearest point of the path, using the ground's normal there. The along-normal offset is left out, so a point over the path gets the whole depth.
  - The read keeps only what lies inside the ring, nearer the patch than the ground round it.
  - Rings are paired with borders by the mean gap measured both ways.
  - The stitch picks its diagonal by length alone. A preference for the triangle facing out of the solid drifted it out of phase and fanned triangles 13 m across.
- **Volume-edit patch** (`terrain-volume-edit.ts`): it grows over the surface from the face nearest each point of the stroke, never from whatever lies near in 3D. Through a thin roof, a tunnel's ceiling lies a metre under the hill.
  - When the engine refuses, the patch grows inward from its holes, one ring of faces at a time, twice at most. This covers a layer laid across a gap cut in a tunnel's roof, which the edit closes over. A grown patch no larger than the last one tried is never sent again.
  - `unfold` runs before the remesh, which then evens out the corners it drew close together. Run after the remesh, it left micro-edges that the commit dropped as faces with repeated corners, opening holes.
  - A layer reaches a quarter face past its radius.
  - A level reaches one face.
  - A bore or an arch reaches two faces.
- **E1 cost.** A stroke over existing ground takes 0.01–0.3 s native. The fourth crossing stroke of a recorded session took 4.7 s and was refused at 3.9–6.5 s before that.
  - `MeshDistance` is a dense bucket grid searched shell by shell. Buckets, and then triangles, whose box lies farther than the nearest point found so far are skipped. A field read went from about 7 µs to 1.7 µs natively, with the same results. Erguer 3D strokes in wasm went from 0.27–2.5 s to 0.12–0.85 s. It is exact only within `EditField.reach`; a grid read uses 4 cells + blend + layer height. Past the reach, the nearest triangle middle stands in: the sign is right, the size is not.
  - A grid read samples every other point first. The rest are read only where the read corners round them disagree in sign or lie within a cell's diagonal + 1.75 cells of the surface. The field is 1-Lipschitz (squash is scaled to keep it so), so the surface comes out the same wherever the field is continuous.
  - Each grid is read once per edit, whatever mending is asked of it. The winding vote reads at most about 256 triangles.
  - `untangle` and `unfold` ask the field which way a triangle faces once, then again only for triangles a flip or a move touched. Corners move one after another, each to where its neighbours stand now. Moving them all from the old positions changed the tunnel results.
- **Faces read both ways** (`EditField::untwist_faces`). A trough narrower than a cell, running slantwise through the grid, gives checkerboard cell faces, which Surface Nets reads as edges four faces hold. An example is the uphill foot of a narrow, tall layer on a hill.
  - The field at the face's middle says which pair joins; the weaker corner of the other pair is turned over.
  - The clean tiers reject a read that needed this, because it signals detail finer than the grid, which a finer grid may read cleanly. The last tier uses the settled read instead of pruning and fanning, which folded that foot.
  - The read box comes from the shapes' plain bounds. An oriented box for layers shifted the grid's phase, and with it which troughs read both ways: that was luck, not a fix.
- **Regrow walks restable ground only.** It takes faces whose outward normal points up by at least 0.2, plus the vacated rim and dragged faces, so a tunnel's walls and ceiling are never relaid. `test/terrain-layers.test.mjs` holds this for a floor laid in a tunnel, the same floor moved, and a layer laid on the tunnel floor.
- **Determinism.** `indexedFaces` orders faces by key. Wasm `HashMap` order shifts with process history, which changed region order from the session and, with it, the meshes.
- **Render.** A fan fallback covers a single-loop face that flattens onto no plane. Surfaces were already double-sided, so orientation needed no change.
- **Roads.** Spine heights come from pointer hits, which are already layer-correct; nothing changed.
- **Deleted** with their tests: the planar executor, `terrain-regenerate`, `terrain-fill`, `terrain-restack`, `terrain-overhang`, `terrain-diagnostics`, `terrain-neighborhood`, `structural-cut`, `buildConstraintRings` and the plan halves of `terrain-constraints`.

- **E3 `layer_surface`** (`solid-field/src/layer.rs`, wasm `layer_terrain_surface_json`, port `layerTerrainSurface`). Through E1, a layer was refused on the bare table beside other ground, wiped the hill it was laid over, and folded or refused crossing strokes. It now never reads a grid:
  - Patch flat in plan (turned share ≤ 1%, or empty): the plane's own `ground_grid` over the patch's rings, lifted to the old surface (vertical lookup on the patch) or the table, then moved: a layer by its cosine profile at the plan distance to the path, a level by pulling heights to it within its column, easing over `blend`.
  - With a table, a raise runs on past the patch onto the bare table: one boolean, (patch ∪ reach) less the ground and structures round it. Two booleans in a row left slivers along the rim. Corners are named by the patch ring, ground and structure vertices they stand on (`Origin::Given` indexes the context's vertices, then the neighbours'), so new ground meets ground beside it on its own nodes. Spikes and boolean corners closer than 0.15 face to another are dropped.
  - Patch folding over in plan (a cave's wall): refined without splitting the rim, moved along the ground's normal at the path, laid again by E2 with the patch's holes passed as holes.
  - **The ring comes back whole** (`rim_unsplit`). A corner the grid put on a ring side whose two ends both came back is dropped, and the cells round it merge. Splits used to make the graph adopt dozens of nodes when the grid lost its seams, and that adoption refused the commit.
  - Cells the relaxation turned over in plan are smoothed back: free corners move to their neighbours' middle.
  - Cost: 10–60 ms per stroke in wasm over 20 strokes, against 0.1–4.7 s and refusals through E1.
- **Face size is the brush's.** Strokes pass the tool's face size. Read off the patch's median side instead, each stroke laid finer than the last.
- **Timing.** A brush stroke is one `timeCommit("terreno: <mode>")`, with the engine call a phase of it. The debug panel showed only the nested patch replacement before. Engine refusals now log their reason (`[terreno] o núcleo recusou ...`).
- **Wasm cache.** `construction-wasm:build` now takes every `libs/domains/procgen/*` crate as input. Before, a change to `solid-field` restored a stale cached `pkg/`, so the app ran old engine code.
- **E1 never erodes an open border.** The remesh's collapse never loses a corner of an open border (the new ground's foot, a hole the read left) into the inside, and its smoothing draws such a corner only along the border. Before, every round crept the border inward. An Erguer 3D over a pile ate its ends: 22–80 sample points of ground lost past the reach per stroke, now 0–2. A first try that freed the table-resting rim of the patch made it worse and was dropped.
- **Layers stay off undersides.** A layer's patch never takes a face turned down, such as the underside of an arch. A flat patch must also not overlap itself in plan: a tunnel's floor under the hill both face up, and laid in plan they were cut apart.
- **Earth bridges.** Erguer 3D with a small brush and a tall rise (radius 2, rise 6) stands hollow: ground, underside and deck one over another. At the defaults (radius 6, rise 2) it is a solid mound.
  - **A layer stays on the surface it was drawn on.** Its reach (`shapeDistance` for raise/lower) goes up or down only by its depth, the slope and 1 m of slack, so the ground under a bridge is not taken into a layer laid on the deck. Taking it in overlapped the deck in plan, and the graph refused the commit ("already used 2 times").
  - **A layer the engine refuses goes through the volume edit** in the same attempt: an arch's flank folds every which way, and the surface chart needs a disk.
  - **E1 merges corners closer than 1 µm** and drops cells left with fewer than three, ring corners first. A collapsed four-corner cell was unmeshable, so it rendered as a hole ("no mesh derivable").
  - A plan layer can keep one zero-area sliver the irregular grid lays along a straight contour, with its corners in a line. Dropping it opened the border, and refusing the layer sent it to E1, which was worse. The tests count only turned faces with area to show.
- **Debug panel keys** by its own record counter. A refused stroke is timed but leaves the revision where it was, which gave two entries one key.
- **E1 on the bare table beside ground.** With an empty patch, the read is kept wherever it lies off the ground round it. Before, nothing passed the inside-the-ring test, so every fill there was refused.
- **An arch closed back down onto the ground** (a C made an O) was refused: "a superfície nova tem um buraco grande demais dentro da região". There were two causes, both fixed:
  - **The sign comes from the band** (`volume.rs::signed_from_the_band`). The ground's sign is right only near its mesh. Past a folded cell, the nearest face points the wrong way, and the grid read a ghost surface metres off the ground, joined to the real one. Now every sample further than 1.5 cells from the surface takes the majority sign of the band samples round its pocket. A pocket never crosses a sign jump whose nearest point is the ground's open border with no table under it, because that jump is real: the top and the underside of an open sheet.
  - **Layer cells never pinch** (`layer.rs::rim_unsplit`). Merging the cells round a dropped rim corner could wrap one cell round another, walking one corner twice. The commit dropped that face, which left a hole at the foot of a tall layer (radius 3, rise 8, on a hill). The cells it wraps now go into it. The commit (`ground-commit.ts::loopsOf`) also splits any ring through one node twice into its loops instead of dropping it.
- **E1 relaxation is bounded.** Each step is at most half the corner's shortest side, and a step that turns one of its cells over is undone. Before, a corner drawn on too far was settled onto another sheet, such as an arch's underside over the ground, and its cells spanned the gap. A dig on a narrow spike went from about 13,000 crossing triangle pairs to about 3,000.
- **An arch built ball by ball** (Erguer 3D clicks from both ends) closed into a solid wall, and the balls laid on it were refused with "its one free side faces the other way". There were four causes, all fixed (`test/terrain-bridges.test.mjs`):
  - **A ball stands out of the surface clicked.** Its centre is half its radius out along the face's normal, on the side the pointer sees (`fillShape`'s `outward`, read from the sample's face and ray). Sunk to its middle, a radius-6 ball reached the ground under the side of the ball it was set on, and the gap left was thinner than one cell, so the grid filled it.
  - **The patch starts from every face a bore or an arch blends into** (`terrain-volume-edit.ts`, `touched`), not only from under the stroke. The tip of the other half arch, reached over the gap, joins the surface under the click only at its foot, far away. Left as context, the new surface stopped short of it and left a hole too big to close.
  - **A chain round nearly its whole ring is stitched to the whole border** (`edit.rs`). Both ends beside one corner stitched the chain to that corner: a fan of long triangles, with the rest of the border hanging open in the air.
  - **The zipper keeps its two sides in step** (`trimesh.rs::in_step`). Neither side runs more than 15 % of its length ahead of the other. Left to the nearer corner, a small border far from its ring was fanned round one ring corner and then the ring round one border corner: two fans over each other, with every side walked twice, so a face came back turned.
- **Roads under and over an earth bridge.** The second road was refused with "faces the other way". Its regrow read the structures resting on the layer being relaid from that layer alone, so the road under the arch lay 8 m under the deck, read as sunk in it, and the deck got a hole with corners down on that road. `meetStructures` now keeps only the structures resting on that layer: the ground each one rests on is the nearest of all the ground in the box. Where none answers, because the structure stands in the hole it cut, the layer must lie no higher than the contact law lets a structure rest under it.
- **The regrow round structures** (sweep on brush-laid ground: a road over a hill dragged three times, one along its flank, one across it, one at the cloud's edge; floors on a slope and on an earth bridge's deck and under it; `test/terrain-regrow-roads.test.mjs`). Most strokes were refused or laid faces 10-14 m long. Causes, all fixed:
  - **A road's side over a hill was one chord.** `restoreHeightVertices` (`contour-patch.ts`) never walked the side closing an open ring, and it densified a side only where a ribbon sample lay within 1 mm of it. One side of every road ran straight from foot to foot, buried in the hill. The ground meeting it took that chord's heights, with vertices at 0 m in the middle of the hill. Now the closing side is walked, and gaps are filled every 1.6 m. Heights come from the curve; the 3D simplification drops the points the slope does not bend.
  - **E2's chart fell back to a circle.** The step at a road's edge folds over in plan, so the rim's projection crosses itself and `chart` took Floater's embedding on a circle. A long strip mapped onto a circle comes back with faces metres long and turned over. Now the projection is mended where it folds (`mended_projection`): rim corners that cross are drawn along the rim, and the corners near a turned face are settled by mean-value weights, ring after ring, until no more is turned than the projection itself tolerates. The mended chart must keep half the projection's extent. The embedding, when still needed, rings its rim on the hull of its projection, not a circle (`rim_on_hull`). A chart scaled more than 20 times is refused. A degenerate chart triangle weighs nothing in `Locator`, where it gave NaN corners.
  - **A landing must lie on its side** (`LANDING_REACH`, a quarter of a face, where it was a whole face). In plan, the foot of a step lies on the side along its top a metre over it. Taken for a corner on that side, it split the side under a face that ran the whole of it.
  - **Holes per piece.** One painter's cloud can stand on two layers, such as a floor on the deck and one under it. Every piece got both holes, at the wrong height. Each piece now gets only the structures resting on it (`meetStructures`'s `restingOn`).
  - **Corners on straight sides.** The contact area's boolean drops structure corners lying straight between their neighbours. They are put back on each hole side (`withCornersOnSides`), so the ground meets the structure at its real heights.
  - **Commit** (`ground-commit.ts`):
    - A landing on a side that two faces beyond already hold is interior ground beyond, not the rim, and is not adopted.
    - A new side between two standing nodes that the ground beyond already joins is split at its middle. That is a chord across a notch, which would be one edge held three times.
    - A face running the whole of a side that other corners split runs through those corners.
  - **Each regrow piece reads the ground round it again.** The faces an earlier piece of the same stroke laid share sides with it.
- **Roads over a valley** (a U dug in a hill; `test/terrain-regrow-roads.test.mjs`). A road from rim to rim left 49 open sides of ground, and a road down into the valley and up again was refused. Causes, all fixed:
  - **The partly-clear cut was a hair wide.** A road along a crest has the ground falling about 10 cm under each side. `GROUND_THROUGH_TOLERANCE` was 5 cm, so the ground counted as rising through only down the middle: it was cut in a strip there, and ran on under the road's sides, meeting nothing. The tolerance is now 30 cm. Where the road stands clear, the ground still runs on under it, and where it is cut it meets the road's underside with no wall E2 cannot lay.
    - Cutting at the resting line (1.5 m) was tried. It made the ground climb up to 1.5 m to the underside at the cut line. That wall folds in plan, so E2 laid faces the wrong way round, and the tests holding the partly-clear floor broke.
  - **A rim touching itself at a corner** (ground gone round a road's end, meeting itself at its corner) was no disk to E2. E2 now takes that corner once per fan of faces round it (`unpinched`), and every copy comes back as that corner.
  - **One triangle laid both ways** by two faces sharing two sides in a row cancelled out and left the patch no disk. `without_cancelling` drops such pairs.
  - **Each piece's holes are clipped to a window round it.** The three roads' contact as one area reached far past a small piece, where its corners are charted by guesswork, and the ground laid fanned out from them. Two area corners a hair apart, both the same structure corner, are taken once.
  - **Layered ground is read near the structure's height.** A hole corner on no structure node read the ground with no reference height, and on an earth bridge it could take the arch's underside 4 m over the floor. The resting test and a sealed side's height had the same fault.
- **Blocks between crossing roads are ground.** The structures' contact area is one polygon for every road at once, with a ring inside it round each block the roads close round. The regrow sent only the outline, so each block was taken for road, and the ground laid there came out turned and refused. Now every ring goes to E2. A block's ring is wound against its outline, and E2's non-zero boolean takes it back out of the hole, while holes overlapping still join. A ring round ground still under a structure, where a road stands clear and the ground runs on under, stays hole.
  - Even-odd was tried first. It gave back the sliver where two holes overlap.
- **Open: many crossing roads still refuse.** In a sweep of nine roads crossing, joining and running parallel (`many roads`), the regrow refuses from the third road on over a valley, the fifth over a hill, and the seventh on flat ground. Two causes are left, both in E2's chart:
  - **Deep cuts.** The road's grade limit leaves it up to 3 m under the ground it crosses. Hole corners are charted at the nearest point of the surface, which slides down the slope. The hole then lands beside the road in the chart, and ground is laid over the road.
    - Taking corners straight down or up instead (tried) fixes that case. But it broke the ramp's raised end and the hill road.
  - **The fix to try:** lay the regrow in plan, as `layer_in_plan` lays a layer, wherever the patch lies flat in plan. There the rim and the holes are exact, and nothing can come out turned. Keep the chart only for ground folding over itself (caves, arches).
- **Open: a structure face is still read as its best plane** (`surfaceHeightOf`). A road is one face, so down a curved valley floor it reads up to a metre off, and a few open sides of ground are left along it (7-14 in the sweep). Reading it through its own outline in plan (`bentSurfaceHeightOf`, tried) finds the right heights. But it puts cut lines inside the road whose corners sit off the ground being laid, and E2 then turns faces at them and the commit refuses them. It waits on E2 meeting given corners off its surface.



## Rest law (2026-10-07)

Owner: the regrow is a dig/raise stroke with the tools that exist; holes between meshes must go. Industry does the same (BeamNG terraform, EasyRoads3D, AoE deform along spline: the terrain conforms under the road, nothing is cut).

- **Where:** `terrain/terrain-conform.ts` (`conformGround`), the default executor of the `"lattice-regenerate"` reaction (`terrain-lattice-reaction.ts`). `terrain-regrow.ts` and `structure-contact.ts` are no longer reached by production code (only by tests); delete in a follow-up.
- **Engine:** `solid-field/src/bed.rs`, a `Bed` per connected structure handed to E3 (`LayerEdit.beds`, wire `beds` on the layer request).
  - Target height: the structure's faces in plan, triangulated by **shortest-diagonal ears** (a road is one long face; any other ear ran end to end and read metres off), minus `sink` 0.08.
  - Full pull within `below` 1.5 (ground under) / `above` 6 (ground rising through), easing to nothing a third past it.
  - Shoulder: flat for `margin` (one face) past the rim, then a smoothstep `max(1, 1.5 × |move|)` wide.
  - Beds that disagree: eased in from the highest target down, so the lowest wins — a road under another gets its cutting, the upper one is a bridge.
  - Never through another sheet (`Sheets`): at the point itself any sheet between blocks; on the shoulder only a sheet facing down at the rim blocks (the slope the shoulder runs up faces up and blocks nothing).
  - After laying: `settled_under` lowers corners at rest (≤ 0.3 m) where a face rises through a structure between them (a road's crossfall twisting at a junction), only from samples whose corners are all at rest.
- **TS side mirrors the engine's pull** (same triangulation, fade, shoulder, sheets) only to pick the faces that move ≥ 2 cm; the patch is closed (`closedPatch`) and taken past rim spikes and faces wedged into notches (`withoutSpikes`) — both made the engine bridge across and leave a hole.
- **Measured:** the old many-roads sweep (hill, valley, flat, 9 roads each) went from refusals at the 3rd–7th road to 27/27; conform 70–210 ms a road; ground through a road ≤ 8 cm in the end state (13 cm transient).
- Layer rings are now read off the patch's faces (fanned), not their ear-clipped triangles: a face folded on itself clipped to nothing and read as a hole.

## The brush's ball (2026-10-07)

Owner: one tool for 2D and 3D, building and destroying with the ball. The dock offers **Adicionar**, **Remover** (both the ball) and **Aplainar**; Cavar 3D / Erguer 3D are gone from the dock (`"carve"`/`"fill"` modes stay callable by name: tests build tunnels and arches with them).

- `ballShape` (`terrain-volume-edit.ts`): ball `brushRadius` round, standing `elevationStep` out of the surface the pointer sees (dug that deep for Remover), at most 0.9 × its width. On ground facing up (`outward.y ≥ 0.75` at every sample) and no higher than its radius it is a **cap** (E3 raise/lower, footprint = radius, height = step: at step = radius the half ball, so cap → ball has no jump); otherwise the ball itself through E1. Preview: the ball, rolled along the stroke.
- **Edge erase fixed:** E1 with a ring partly held (a shape crossing the ground's open border onto the table) dropped a half disc of the new surface round each free end of the held chain (the ring clearance), and nothing covered it. Sparing that clearance in E1 broke the arch built ball by ball, so the tool instead **runs the ground on over the bare table first** (`groundRunOn`: a 2 cm E3 layer `radius + 3 faces` round the ball, only where some of that is bare). The ball then meets ground all round. Two undo steps.

## Open

- **Rest law:** a floor raised off flat ground and moved back and forth leaves a bank each time; the ground round it grows ~5 faces a move (204 → 247 over eight), slowing. Legacy ground cut before the rest law keeps its holes (nothing fills them). A structure removed leaves the ground shaped (earthwork), by design.
- **E1 stitch at a partly held ring** still drops the band past a chain's free end when called without `groundRunOn` (legacy `"fill"` over the edge).
- **Shared wasm `pkg`:** `libs/domains/procgen/construction-wasm/pkg` is a junction shared by every worktree and the main checkout; any session's `construction-wasm:build` overwrites it with its own branch's engine. Tests and the dev server load whichever built last.
- A few strokes in 20 leave one sliver cell at a cloud's rim on the table, turned over in plan, where the reach meets the old rim nearly tangentially.
- **E1 can return a surface that crosses itself.** A bridge leaves a few dozen crossing triangle pairs at its flanks. Digging 6 m into a narrow spike under an arch leaves thousands, takes 1–2 s, and goes through E1 because the layer refuses a patch that is not a disk. The crossings start at the stitch: the zipper joins the ring to a read border that runs metres off it, and unfolding doubles them. Since the sign comes from the band, later strokes are no longer refused over such ground. Refusing on the stitch's longest side was tried and dropped, because an ordinary bridge stitches across 14–17 cells at a corner of the map and the remesh mends it. The fix is the one under the ridge item below: cut the read mesh along the ring.

- The heightmap noise the planar Adicionar added was dropped; the layer is smooth.
- A raise beside a structure keeps its contact edges but does not re-run the contact law: ground raised under a floor standing clear is not cut.
- A ridge steeper than 45° (a layer taller than its radius) can fold up to about 2% of its sides where the stitch meets the ring. The remaining inversions start at the concave corners of the ring of square faces, which the read's smooth border cuts across; no flip of a locked ring side undoes them.
  - The fix is to cut the read mesh along the ring itself instead of stitching a strip between two loops.
  - `untangle` (flips) and `unfold` (free corners to their neighbours' middle) already take it from about 2.5% down to well under 1% at default settings.
  - The arc tests allow 2% for such ridges.
- The arc that nearly closes now goes through E1, which has no plan outline to slit. The arc tests' wide C (1.7π) and closed ring (2.05π) hold it on the empty table, on flat ground and over a hill.

## Order of work (one task, one PR)

1. E2 in Rust (chart, constraints, generator, lift, non-disk fallback) with native tests on synthetic patches: flat, hill, cave floor beside a ceiling, ring round a tunnel.
2. Session queries `terrain_patch` and `ground_below`, with bridge JSON and tests.
3. E1 shapes (`mound`, `dig`, `flatten`), table floor, locked structure constraints.
4. Tools on E1, with volume ghosts.
5. Regenerate on E2: contact law via `ground_below`, `meetStructures` in 3D, commit half kept.
6. Roads on layers.
7. Render in own-plane frames.
8. Deletions, then the real-engine scenario tests:
   - tunnel through a hill, a platform inside it, moved in and out (I1, I2, I5, I6);
   - earth bridge with a road over it and a ramp under it;
   - Adicionar arcs (half circle, nearly closed C, S) on flat ground, next to a tunnel and over a bridge: no merge, no slit;
   - Remover and Aplainar next to an overhang;
   - empty-table Adicionar;
   - determinism (I7).
