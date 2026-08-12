# VTT procedural geometric surfacing with unit assets

- Status: research; no architecture decision is accepted by this document
- Date: 2026-08-12
- Scope: generating repeated visible geometry such as individual bricks,
  tiles, stones, boards, shingles, and fence modules over canonical VTT
  construction surfaces
- Related accepted decisions: `ADR-0011`, `ADR-0013`, `ADR-0014`,
  `ADR-0021`, `ADR-0022`, and `ADR-0023`

## 1. The product idea

The desired asset is not a picture of a brick wall and not one wall-sized
mesh. It is a reusable **unit prototype**, such as one brick. A deterministic
surface recipe lays out many references to that prototype over one or more
canonical construction surfaces. The renderer draws the references in
batches without copying the brick's vertex buffers for every occurrence.

This is more precise than the broad term "procedural texture". It has two
related outputs:

1. **procedural geometric surfacing** for nearby views, where individual
   units have silhouette, depth, lighting, and shadows;
2. **procedural material synthesis** for distant views, where the same recipe
   can generate or select color, normal, height, roughness, and mask data.

The two outputs should be driven by the same pattern and seed so that changing
level of detail does not visibly change the wall design.

## 2. What established tools and papers show

### 2.1 Generate placements first, instantiate prototypes second

Houdini's Copy to Points workflow separates target points and their attributes
from the source geometry. Position, orientation, and scale live on the target
points; Pack and Instance shares source geometry instead of duplicating it.
Blender Geometry Nodes makes the same distinction: Instance on Points stores
references and transforms rather than realizing a full mesh per copy.

This maps well to the VTT:

```text
canonical surface geometry
  -> stable local pattern domain
  -> procedural unit placements
  -> prototype + per-instance attributes
  -> renderer batches
```

The generator's primary product should therefore be an **instance plan**, not
a wall-sized merged mesh.

### 2.2 Architectural repetition is a grammar, not random scatter

CGA shape research demonstrates the value of context-sensitive rules when
producing architectural detail: facade elements must respect boundaries and
other elements. A brick wall needs similarly explicit rules:

- unit dimensions and joint width;
- course height;
- running-bond, stack-bond, header, or other layout rule;
- row offsets and periodicity;
- allowed prototype variants;
- boundary, jamb, lintel, and corner treatment;
- deterministic variation limits.

Random scatter is useful for stones, debris, or vegetation, but it is not the
right primitive for masonry bonds. The first implementation should expose
distinct layout kinds instead of one universal scatter API.

### 2.3 Geometry and material representations are complementary

SideFX's tile-pattern material workflow uses per-tile coordinates, masks, and
variation for bricks and grout. That supports using the same logical tile IDs
and pattern coordinates for both geometric units and a far-distance material.
It does not imply that the texture owns the wall layout.

### 2.4 Instancing is the baseline rendering representation

Three.js `InstancedMesh` renders many objects that share one geometry and
material with different transforms, specifically to reduce draw calls.
`BatchedMesh` extends batching to multiple geometries that share a material.
This suggests two useful cases:

- one `InstancedMesh`-equivalent batch per unit prototype/material/LOD;
- one `BatchedMesh`-equivalent batch when several geometric variants share a
  material.

The VTT must expose a Grafting-owned instance contract. Three.js types remain
inside `@grafting/render-3d` under the existing vendor-isolation decision.

## 3. Candidate product model

The following names and fields are exploratory, not accepted API.

### 3.1 Unit prototype

```text
UnitAssetDefinition
  assetRef
  revision
  localBounds
  anchorFrame
  physicalDimensions
  geometryVariants[]
  materialSet
  lodRepresentations[]
```

The unit asset uses a documented local frame. For a brick, the origin might be
the center of its back face, with local X along length, local Y along height,
and local Z pointing out from the supporting wall. The convention matters:
without it, every recipe needs asset-specific correction rotations and offsets.

`physicalDimensions` are layout metadata, not authoritative VTT collision.
They let a recipe calculate courses and joints without decoding renderer-owned
geometry.

### 3.2 Surface pattern binding

```text
SurfacePatternBinding
  bindingRef
  targetSurfaceRefs[]
  unitAssetRef
  layout
  frameAnchor
  joint
  boundaryPolicy
  variation
  normalOffset
  seed
  revision
```

The binding is app-owned asset policy, consistent with
`VTT-PRODUCT-MODEL-006`. It references surfaces but does not copy their node
positions, cycle, triangulation, physical flag, or mesh.

Targeting more than one surface is important. The current wall-with-door
generator represents the wall as sibling surfaces around the opening, not as
one polygon with a nested hole. Those coplanar siblings need one shared
pattern frame so brick courses continue across the jambs and lintel instead
of restarting independently on every surface.

### 3.3 Derived instance plan

```text
SurfaceInstancePlan
  bindingRef
  sourceSurfaceRevisions[]
  recipeRevision
  chunks[]

InstanceChunk
  chunkId
  prototypeRef
  materialRef
  lod
  transforms[]
  variantIds[]
  bounds
```

This plan is derived cache/render data. It is not part of the confirmed
product projection and individual units are not automatically VTT entities.

An individual brick should become authoritative only if a future gameplay
feature requires stable per-brick state, selection, destruction, inventory,
or physics. Making every visual brick an entity now would create replication,
undo, persistence, and picking costs without product value.

## 4. Proposed planar generation algorithm

The first useful scope is one planar surface or a coplanar group of surfaces.

1. Resolve canonical node cycles and positions from graph-owned state.
2. Construct one stable local frame for the binding:
   - origin anchored to a stable node or explicitly selected point;
   - U axis anchored to an ordered node pair or explicit direction;
   - V axis derived within the plane;
   - N axis from the surface normal.
3. Project every target polygon into the shared `(u, v)` domain.
4. Generate the layout lattice from unit dimensions, joint dimensions, bond
   rule, and seed over the domain bounds.
5. Classify every unit footprint against the union of target polygons.
6. Apply the selected boundary policy to intersecting footprints.
7. Map accepted centers and local frames back into 3D transforms.
8. Partition the result by spatial chunk, prototype/material, and LOD.

The pattern frame must not be inferred from unstable array positions or from
PCA alone. A small node move must not rotate or mirror the entire brick bond.
An explicit node/edge anchor also lets the editor show and manipulate the
pattern origin later.

## 5. Openings, borders, mortar, and corners

### 5.1 Door and window openings

For the current sibling-surface wall representation, a shared planar pattern
domain can generate one continuous lattice, then retain units only in the
union of the wall surfaces. The uncovered gap is the opening. This requires no
parallel topology and no invention of nested holes in graph-core.

### 5.2 Boundary policies

No one policy is correct for every asset family.

| Policy | Benefit | Cost or artifact | Suggested use |
| --- | --- | --- | --- |
| omit partial units | simplest and preserves instancing | visible gaps at edges | rough stone, vegetation, first diagnostic |
| include units by center | stable counts and simple | units protrude outside boundary | hidden or intentionally overbuilt edges |
| scale-to-fit remainder | remains instance-like | visibly deforms bricks | boards/panels where allowed, not default masonry |
| trim/cap prototype variants | good authored result and batching | requires a finite variant kit | recommended first masonry quality step |
| generate clipped unique mesh | exact arbitrary boundary | loses instancing for edge pieces and needs robust clipping | later fallback for exceptional borders |
| shader/SDF mask | cheap visual clipping | missing cut side faces and harder shadow/picking semantics | distant LOD or non-physical finish |

A practical masonry V1 can batch all full bricks and generate a much smaller
separate set of trim pieces at edges. It should not perform arbitrary CSG on
every brick.

### 5.3 Mortar/backing

The canonical surface mesh can remain visible immediately behind the bricks
with a mortar or backing material. Joints then expose that continuous backing
instead of requiring separate mortar geometry between every pair of units.
This also hides tiny numerical gaps and provides a clean far-LOD fallback.

### 5.4 Corners and seams

Two perpendicular walls cannot share one planar domain. A future connected
pattern domain needs an explicit corner grammar: butt joint, alternating bond,
corner prototypes, miter, or terminate-and-cap. Surface adjacency can be read
from canonical shared nodes/edges, but the selected architectural treatment is
asset policy and must not be hardcoded into graph-core.

Per-surface generation is acceptable for a first planar spike, provided the
seam limitation is visible and recorded rather than hidden.

## 6. Curved and non-planar surfaces

Rigid bricks cannot conform exactly to arbitrary curvature. Aligning each
brick to the sampled tangent frame still causes gaps or intersections because
the piece touches the surface only locally.

The product needs an explicit compatibility/fallback rule:

- planar or nearly planar: rigid unit instancing;
- gently curved: chart/path placement with a maximum deviation threshold;
- strongly curved: smaller units, deformable generated pieces, or a material
  representation;
- arbitrary triangulated surface: UV/chart parameterization plus seam policy,
  only after a measured use case exists.

This is a reason to make the planar wall the first benchmark. General surface
parameterization is a separate geometry capability, not a prerequisite for
proving the unit-asset model.

## 7. Determinism, invalidation, and caching

The recipe must be deterministic for the same inputs. Random variation uses a
stable seed and logical lattice coordinates, not mutable iteration order.

Suggested cache identity:

```text
hash(
  binding revision,
  unit-asset revision,
  target surface geometry revisions,
  generator algorithm version
)
```

Moving a node invalidates only bindings that reference affected surfaces.
Changing one brick prototype invalidates only bindings using that prototype.
Changing camera distance changes selected LOD batches, not the canonical
surface or pattern recipe.

A derived unit key may be based on binding, course, column, and variant. It is
useful for deterministic variation and diagnostics, but it is not persistent
gameplay identity.

## 8. Responsibility split

| Layer | Owns | Must not own |
| --- | --- | --- |
| graph/construction Rust | canonical nodes, cycles, surface identity, affected-surface queries | brick brands, materials, or renderer batches |
| generic surfacing Rust capability | planar projection, lattice/bond evaluation, polygon coverage tests, deterministic instance plan | VTT categories, Three.js objects, or GPU resources |
| `apps/vtt` | bindings, asset selection, editor operations, surface grouping, user-visible defaults | duplicate geometry algorithms or renderer vendor types |
| asset adapter/repository | prototype decoding, metadata validation, resource lifecycle | surface topology or product authority |
| `@grafting/render-3d` | generic instance buffers, batching, culling, LOD drawing, GPU disposal | concepts named brick, wall, door, or VTT asset policy |

Reusable layout math belongs in Rust under `DEC-051`/`ADR-0013`; TypeScript
must not reimplement polygon tests, coordinate-frame math, or bond generation.

## 9. Gap in the current renderer

The current `GeometryDescriptor` supports primitives, heightfields, one mesh,
segments, and sprites, but no instance-set geometry. The VTT map adapter also
uses `mergeMeshChunks`, which copies all input vertex data into one combined
mesh buffer.

That pipeline remains appropriate for canonical surface triangles. It should
not be reused for thousands of repeated unit assets. The missing generic
capability is conceptually equivalent to:

```text
InstanceSetDescriptor
  prototype geometry/visual reference
  transforms
  optional per-instance color or variant data
  bounds/chunk metadata
```

The public contract must use Grafting-owned typed arrays/value objects. The
Three backend may implement it with `InstancedMesh` or `BatchedMesh` without
exposing either vendor type.

## 10. Hybrid LOD recommendation

One representation will not be efficient at every camera distance.

| Distance band | Representation |
| --- | --- |
| near | full unit prototype instances, real silhouette and depth |
| medium | lower-poly unit variants and/or larger spatial batches |
| far | backing surface with material generated from the same pattern/seed |
| very far | ordinary simplified map surface/material |

Exact thresholds and instance counts must come from a browser benchmark, not
from an unmeasured constant in an ADR.

## 11. Recommended validation spike

Before defining a catalog or general authoring system, build one measured
brick-wall laboratory case:

1. one low-poly brick prototype plus two or three geometric variants;
2. one planar rectangular wall and one wall-with-door represented by its
   existing sibling surfaces;
3. one running-bond recipe with unit size, mortar joint, anchor, seed, and
   trim policy;
4. one Rust-produced instance plan;
5. one generic instance-set render descriptor and Three backend adapter;
6. a visible backing/mortar surface;
7. chunked rebuild after moving one wall node;
8. near unit geometry and far material fallback driven by the same recipe.

Measure at increasing scene sizes instead of choosing an arbitrary maximum:

- generator time in native Rust and Wasm;
- Wasm-to-JavaScript payload bytes and conversion time;
- GPU upload/update time;
- draw calls, CPU frame time, and GPU frame time;
- memory for prototype geometry and per-instance data;
- culling behavior as the camera moves;
- time to rebuild only one edited surface binding;
- visual transition between geometry and material LOD.

Compare at least:

1. merged duplicate geometry as a control;
2. one global instance batch;
3. spatially chunked instance batches;
4. chunked instances with the far material fallback.

## 12. Decisions that should be made after the spike

1. What is the accepted name: surface pattern, surface covering, surface
   dressing, or another product term?
2. Is planar/coplanar surfacing sufficient for V1?
3. Which first layout kinds are required: bond lattice, linear/path repeat,
   scatter, and/or fit?
4. Which boundary policy is the V1 default for masonry?
5. Must patterns continue across coplanar sibling surfaces and around corners?
6. Does V1 ever expose per-unit picking or state?
7. Is far-LOD material output generated at runtime, authored in the asset, or
   precomputed by tooling from the same recipe?
8. Which measured limits select instance chunk size and LOD transitions?

## 13. Current research conclusion

The idea fits the accepted Graph -> Mesh -> Surface -> Asset layering. It
sharpens ADR-0022's broad "replication" mode into a dedicated procedural
surfacing capability:

```text
Surface remains canonical construction identity and geometry.
Pattern binding remains app-owned asset policy.
Rust derives deterministic unit placements.
Renderer draws prototype references in spatial batches.
Material LOD uses the same recipe without becoming authoritative.
```

The first implementation should not begin with asset import, a large catalog,
arbitrary curved surfaces, or per-brick entities. The smallest decisive proof
is a planar running-bond wall with an opening, a shared pattern frame, trim
handling, chunked instancing, and a measured geometry-to-material LOD.

## 14. Primary sources

- [Three.js `InstancedMesh`](https://threejs.org/docs/pages/InstancedMesh.html)
- [Three.js `BatchedMesh`](https://threejs.org/docs/pages/BatchedMesh.html)
- [Houdini Copy to Points](https://www.sidefx.com/docs/houdini/nodes/sop/copytopoints-.html)
- [Houdini copying geometry to points](https://www.sidefx.com/docs/houdini/copy/copytopoints.html)
- [Blender instances](https://docs.blender.org/manual/en/4.5/modeling/geometry_nodes/instances.html)
- [Blender Geometry to Instance](https://docs.blender.org/manual/en/4.2/modeling/geometry_nodes/geometry/geometry_to_instance.html)
- [Muller et al., Procedural Modeling of Buildings](https://doi.org/10.1145/1179352.1141931)
- [Whiting, Ochsendorf, and Durand, Procedural Modeling of Structurally-Sound Masonry Buildings](https://people.csail.mit.edu/ewhiting/resources/pubs/WhitingOchsendorfDurand-09.pdf)
- [SideFX tile-based texture workflow](https://www.sidefx.com/tutorials/how-to-create-tile-based-textures/)
- [Khronos `EXT_mesh_gpu_instancing`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/EXT_mesh_gpu_instancing)
- `docs/adr/ADR-0022-wall-representation-free-geometry.md`
- `docs/architecture/vtt-product-model.md`
- `docs/research/vtt-asset-placeable-and-assembly-architecture.md`
