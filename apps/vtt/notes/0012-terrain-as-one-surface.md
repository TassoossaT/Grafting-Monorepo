# Note 0012 — Terrain as one surface in 3D

- Recorded: 2026-10-05
- Status: approved plan (owner, 2026-10-05); implementation in TASK VTT-TERRAIN-REGEN-CALIBRATION, PR #353
- Related: note 0011 (cut before TASK-333), ground contact law, terrain regen as a brush stroke, 3D carve/fill (`solid-field`)

## Verdict

The ground is **one oriented surface in 3D**, made of `ground` regions. **No code may assume one ground height per point of the plane.** There are only two engine operations:

- **E1 `edit_surface`** — volume edit. Every tool that changes the ground's shape uses it.
- **E2 `regenerate_surface`** — relays the cells of a patch of surface, with the shape unchanged. Every repair around a structure uses it.

Patches are always chosen **by walking the surface**, never by plan coverage. The planar terrain path is deleted, not kept as a fallback.

## Why

The terrain was 2.5D: Adicionar, Remover, Aplainar and the structure regenerate laid ground as a function of (x, z). That meant plan CDT in `fillTerrain`, heights from `groundSurfaceOf` / `heightFieldOf` over all standing ground, and plan coverage from `footprint_coverage`. Cavar/Erguer 3D were added on top, with one guard (`overhangingGround`) that stops relaying overhanging faces but still lets them feed every height lookup. Where two layers share a plan point (tunnel ceiling over its floor, bridge deck over the gap), planar tools blend the layers and the upper mesh merges into the lower one. That is the owner's report, from 2026-10-05, of an Adicionar arc. The owner rejected a layer-aware patch and chose this refactor.

Owner decisions (2026-10-05):

1. Adicionar is volumetric: a volume of earth, never faces offset one by one.
2. The planar path is deleted.
3. Latency is irrelevant; always choose the best algorithm and quality.
4. Everything is in scope: structures inside caves and on earth bridges, roads over 3D ground, regenerate working in all of it.

## Invariants (tests hold every one)

- **I1. One ground mesh.** No ground edge is held by more than 2 ground faces. Open edges exist only on the map border or on a structure's contact line.
- **I2. Layers never mix.** An edit or a repair changes only faces reachable over the surface from where it acts. A face on another layer over or under the same plan point is never read for heights and never relaid.
- **I3. The preview is the contract.** E1 changes faces only within the volume's reach plus its blend, and the ghost shows that volume.
- **I4. The ring is untouched.** The nodes round a patch come back as the same nodes, with their edges unsplit except by explicit adoption.
- **I5. Contact law, measured in 3D.** Ground is cut only where a structure rests on the layer directly under it, within 1.5 m (`GROUND_CONTACT_CLEARANCE` and its siblings, unchanged). Platforms stay sealed. "Under" means the first ground hit by a ray going down from the structure, never ground anywhere in plan.
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
