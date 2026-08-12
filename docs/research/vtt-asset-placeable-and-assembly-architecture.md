# VTT asset, placeable, and movable-assembly architecture

- Research date: 2026-08-12
- Status: **raw research and proposed epic breakdown**. This document closes
  no decision, adopts no dependency, and is not an ADR.
- Scope: authored and procedural visual assets, asset application to
  construction surfaces, independently placed scene objects, and movable
  structures with editable internal topology.
- Authority preserved: `DEC-049`, `DEC-051`, `DEC-052`, `DEC-060`,
  `ADR-0011`, `ADR-0013`, `ADR-0014`, `ADR-0022`, `ADR-0023`,
  `VTT-PRODUCT-001`, and `VTT-VISIBILITY-001`.

## 1. Why this needs its own work

The VTT can generate graph-backed construction surfaces and can render raw
mesh buffers, but it has no asset repository, asset ingestion contract,
surface-to-asset binding, prop/placeable model, or movable-assembly model.
Those are different problems and should not be hidden inside the map graph or
the renderer.

The existing accepted construction stack is:

```text
Graph topology -> derived Mesh -> Surface semantics -> Asset presentation
```

`ADR-0022` applies that stack to the generated structural map. The earlier
research also records the owner's explicit direction that furniture and props
do not reuse it: they belong to a separate placement system. This document
keeps that separation and names the missing boundaries.

## 2. Current repository baseline

Already present:

- stable graph nodes and construction-surface identity;
- surface mesh derivation being implemented by `VTT-MAP-PRODUCT-MODEL`;
- `AssetRef` as an opaque app-owned identity in `VTT-PRODUCT-001`;
- generic raw mesh, material, texture-source, transform, picking, and scene
  item contracts in `@grafting/render-3d`;
- a VTT-owned adapter that renders map chunks without leaking Three.js types.

Not present:

- an `AssetDefinition` or asset revision model;
- a repository/import port;
- glTF/GLB or another authored-model ingestion path;
- asset validation, preview, bounds, anchors, sockets, or LOD metadata;
- a binding from a `SurfaceRef` to visual content;
- a placeable identity separate from tokens;
- a movable assembly with local coordinates and one world transform;
- persistence or transport contracts for any of the above.

The existing renderer support is capability evidence, not a reason to make the
renderer authoritative for product state.

## 3. Three distinct consumers of visual content

### 3.1 Surface asset binding

A construction surface already has canonical topology and semantics. A visual
binding selects how an asset fills it without copying its nodes, mesh, or
physical flag.

Candidate shape, not accepted:

```text
SurfaceAssetBinding
  surfaceRef
  assetRef
  mode: repeat | fit
  parameters
  revision
```

- `repeat` distributes reusable units along or across the derived surface;
- `fit` adapts one visual object to the resolved surface dimensions;
- replacing the binding changes presentation, not graph topology;
- moving a graph node invalidates derived placement, not asset identity;
- the binding must not store a second authoritative surface mesh.

UV generation, seam policy, repetition axes, corner handling, and acceptable
deformation are still open.

### 3.2 Independently placed object

Furniture, vegetation, containers, decorations, lights, and similar objects
need stable scene placement independent from map construction.

Candidate shape, not accepted:

```text
PlaceableDefinition
  definitionRef
  assetRef
  metadata/proxy references

PlaceablePlacement
  placementId
  sceneId
  definitionRef
  transform
  revision
```

The definition is reusable. The placement owns position, orientation, scale,
scene membership, and placement revision. Neither record contains a renderer
object. Rules subjects, ownership/capabilities, open/closed state, inventory,
or hit points are separate optional bindings rather than an arbitrary property
bag.

A token remains its already-decided scene-placement concept. A new placeable
must not silently replace or broaden `Token`; the exact relationship is an
open owner decision.

### 3.3 Movable assembly with editable faces

A rigid object that only needs to move can remain a normal placeable. A
structure whose internal faces must remain editable needs a different
definition boundary:

```text
AssemblyDefinition
  definitionRef
  local graph
  local surfaces
  asset bindings
  definitionRevision

AssemblyPlacement
  placementId
  sceneId
  definitionRef
  worldTransform
  placementRevision
```

Local node positions describe the assembly. The placement's world transform
positions the complete assembly:

```text
world vertex = assembly world transform * local node position
```

This prevents a rigid translation or rotation from rewriting every node and
re-deriving every unchanged face. It also permits multiple placements to
reference one immutable definition.

This is **not** permission to reinterpret the existing map graph. Its node
positions remain the canonical spatial construction state governed by
`ADR-0022`. A local-space assembly is a separate aggregate and requires an ADR
before implementation. Attaching/baking an assembly into map construction, if
ever supported, must be an explicit operation that creates new map-owned node
and surface identities.

## 4. Coordinate and transform ownership

The model needs one transform authority per object:

| Object | Geometry coordinates | World placement authority |
| --- | --- | --- |
| Map construction | canonical map-node positions | map graph itself; no parallel transform |
| Surface visual | derived surface coordinates | derived from the owning surface binding |
| Placeable | asset-local coordinates | `PlaceablePlacement.transform` |
| Movable assembly | assembly-local node positions | `AssemblyPlacement.worldTransform` |
| Renderer object | disposable backend representation | never authoritative |

Open transform decisions include quaternion versus Euler persistence,
non-uniform scaling, parent/child transforms, pivot definition, units,
coordinate handedness at ingestion, and transform normalization.

## 5. Asset definition and ingestion boundary

An imported file is a source artifact, not the VTT's public model. A candidate
pipeline is:

```text
source bytes
  -> format adapter and validation
  -> normalized asset metadata
  -> immutable content-addressed or revisioned artifact
  -> app-owned AssetRef
  -> renderer-owned decoded resources
```

Candidate `AssetDefinition` responsibilities:

- stable `AssetRef` and explicit content/metadata revision;
- source provenance and license metadata;
- normalized units, orientation, pivot, and bounds;
- visual variants and material slots;
- optional anchors/sockets expressed as named local transforms;
- optional LOD references;
- optional candidate collision and visibility proxy references;
- supported surface-fill modes and their parameters.

It must not contain Three.js objects, browser handles, GPU resources, a URL as
identity, or untyped vendor `extras`. Vendor parsing remains inside the owning
adapter. App metadata requires a versioned Grafting-owned schema.

### glTF/GLB evidence

glTF 2.0 is a strong candidate for the first authored 3D delivery boundary,
not an adopted choice. The Khronos specification defines an API-neutral
runtime asset-delivery format with scenes, node hierarchies, local transforms,
meshes, materials, textures, skins, and animations. GLB can package JSON and
binary data together. The official validator and sample assets provide a
conformance path.

Relevant optional evidence:

- `EXT_mesh_gpu_instancing` defines per-instance translation, rotation, and
  scale, but explicitly distinguishes transport-time GPU batching from general
  data instancing. The VTT model should therefore express placements first and
  let the renderer choose batching.
- `KHR_texture_basisu` provides ratified KTX2/Basis texture delivery and
  runtime transcoding. It is a later optimization choice, not a V1
  prerequisite.
- Three.js `GLTFLoader` supports glTF plus several compression/material
  extensions, but it belongs behind a VTT adapter. Its returned `Group`,
  parser, materials, and animation clips must not leak through app ports.

The first ingestion spike should compare at least standalone `.gltf` plus
external resources against `.glb`, and record upload, validation, caching,
disposal, and failure behavior before choosing one as the product input.

## 6. Assets generated by the product

"Procedural asset generation" covers several independent outputs:

1. surface-derived visual placement, such as repeated wall modules;
2. authored or generated mesh definitions;
3. generated materials and textures;
4. kit metadata used by terrain/building/interior generation;
5. automatic prop/placeable layouts.

They should not share one opaque generator API. Reusable geometry, layout
math, graph algorithms, and deterministic generation belong in Rust under the
smallest generic capability. `apps/vtt` owns prompts, workflows, categories,
selection policy, and mapping results to VTT entities. Asset decoding and
renderer translation remain adapters.

No model-generation service, image-generation service, procedural texture
tool, or crate is selected here.

## 7. Anchors, sockets, and groups

Anchors/sockets are local coordinate frames used for optional snapping. They
do not imply graph adjacency or physics constraints.

Candidate separation:

- asset/definition declares available named anchors;
- placement stores the chosen parent/anchor relationship, if hierarchical
  placement is accepted;
- a placement feature computes preview and emits one semantic operation;
- physics later validates grounding/collision when that capability exists;
- renderer consumes the resolved world transforms.

Grouping and assembly must not be conflated:

- a selection group may be transient editor state;
- a persistent placement hierarchy shares transforms but not necessarily one
  editable definition;
- an `AssemblyDefinition` owns editable local graph/surfaces;
- a physics joint is authoritative simulation state and belongs to Epic 6.

## 8. Collision, visibility, and behavior

The asset may provide candidate geometry or proxies, but supplying geometry is
not the same as deciding behavior:

- `Surface.physical` remains the accepted structural fact for construction;
- authoritative movement/collision remains deferred to the physics slice;
- asset composition may select vision-relevant geometry under `ADR-0022`;
- `VTT-VISIBILITY-001` still governs viewer-safe disclosure and authority;
- renderer picking is presentation input, never authorization;
- open/closed, locked, trapped, destructible, inventory, and similar state
  belongs to explicit product/rules features referencing stable identities.

## 9. Revisions and invalidation

Independent revision scopes prevent unrelated work from rebuilding everything:

- asset-definition revision: source/metadata changed;
- surface-binding revision: visual selection or fill parameters changed;
- placeable-placement revision: transform or scene membership changed;
- assembly-definition revision: local topology/surface/binding changed;
- assembly-placement revision: only the world transform changed.

Changing an assembly placement must not recompute its unchanged local mesh.
Changing one asset definition invalidates consumers of that asset, not every
scene object. Renderer resources remain caches keyed from app-owned identity
and revision, never the canonical records themselves.

## 10. Proposed epics and executable slices

### Epic 4 — Asset pipeline and surface presentation

| Task | Outcome | Dependency |
| --- | --- | --- |
| E4.1 | Research and decision record for source formats, metadata schema, licenses, bounds, materials, textures, and lifecycle | none; decision task |
| E4.2 | App-owned `AssetRef`/definition/repository contracts plus one in-memory fixture catalog | E4.1 |
| E4.3 | One validated authored-asset ingestion and preview slice behind an adapter | E4.2 |
| E4.4 | `SurfaceAssetBinding` spike proving `repeat` and `fit` on existing generated surfaces | E4.2 and map rendering |
| E4.5 | Texture/material delivery and disposal measurements | E4.3 |
| E4.6 | Tileset/module metadata authoring for generation systems | E4.2; content-dependent |
| E4.7 | Procedural mesh/material/texture research split by output family | E4.1; research only first |

### Epic 7 — Placeables and movable assemblies

| Task | Outcome | Dependency |
| --- | --- | --- |
| E7.1 | Decide placeable identity, transform, token relationship, hierarchy, and lifecycle | none; decision task |
| E7.2 | Placeable definition/projection/operations and one primitive or fixture asset | E7.1 and minimal asset contract |
| E7.3 | Select/place/move/rotate/delete workflow with preview-then-one-commit gestures | E7.2 |
| E7.4 | Snapping/grounding preview using anchors and map queries, without authoritative physics claims | E7.3 |
| E7.5 | Decide whether editable movable assemblies are a real V1 requirement; write an ADR if yes | E7.1; owner gate |
| E7.6 | Local-space assembly definition plus world-space placement spike | accepted E7.5 only |
| E7.7 | Rendering/picking/instancing measurements with realistic scene counts | E7.2; optimization evidence |
| E7.8 | Collision and rule-state integration | Epic 6; deliberately deferred |

E4.1 and E7.1 can proceed while `VTT-MAP-PRODUCT-MODEL` is active because
they are decision/research work and do not modify its runtime or construction
contracts. E4.2 and E7.2 should begin only after their decisions are accepted.

## 11. Owner decisions still required

1. Is glTF/GLB the first supported authored 3D input, or only a spike
   candidate?
2. Are V1 assets repository-owned files, user uploads, remote references, or
   more than one of these?
3. Does V1 need both `repeat` and `fit`, and which surface categories exercise
   each first?
4. Are custom materials editable in V1, or are assets immutable bundles?
5. Are sockets authored in the source file, in sidecar metadata, or in a VTT
   authoring tool?
6. Is `Placeable` a new base scene concept, with tokens as a separate peer, or
   should both share a narrower common placement value object only?
7. Does V1 permit non-uniform scale and parent/child placement hierarchies?
8. Are editable movable assemblies a V1 product requirement or future work?
9. If assemblies exist, can multiple placements share one definition, and how
   does an editor create a unique editable copy?
10. What is the explicit operation for baking/attaching an assembly into map
    construction, if that workflow exists at all?
11. Which collision and visibility proxies are authored metadata versus
    derived data, without moving authority into the asset or renderer?
12. What performance scale should the first instancing and disposal benchmark
    target?

## 12. Recommended first validation

Before building a full catalog or authoring tool, one vertical spike should:

1. validate and import one license-clear 3D asset;
2. normalize its units, pivot, orientation, and bounds;
3. expose only a Grafting-owned `AssetRef` and metadata through an app port;
4. render two independent placements from the same definition;
5. move one placement without rebuilding or moving the other;
6. dispose all decoded CPU/GPU resources deterministically;
7. demonstrate that no Three.js or source-format type escapes the adapter.

A second, separate spike should bind a repeatable module and a fit asset to
two construction surfaces. Keeping the spikes separate proves the architectural
distinction rather than hiding it behind one demo.

## 13. Primary sources

- [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [Khronos glTF repository, validator, samples, and tooling](https://github.com/KhronosGroup/glTF)
- [Khronos `EXT_mesh_gpu_instancing`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/EXT_mesh_gpu_instancing)
- [Khronos `KHR_texture_basisu`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_texture_basisu)
- [Three.js `GLTFLoader` documentation](https://threejs.org/docs/pages/GLTFLoader.html)
- `docs/adr/ADR-0022-wall-representation-free-geometry.md`
- `docs/architecture/vtt-product-model.md`
- `docs/architecture/vtt-visibility-and-knowledge-contract.md`
- `docs/research/vtt-construction-layering-graph-mesh-asset.md`

