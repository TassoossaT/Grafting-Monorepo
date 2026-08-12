# VTT Tiny Glade reference and open-source procedural ecosystem

- Status: research; candidates are not approved dependencies or tools
- Date: 2026-08-12
- Product reference: Tiny Glade-style gridless, reactive, procedural
  construction
- Scope: open code, content sources, material/image generation, unit geometry,
  roofs, openings, interiors, decoration, and integration boundaries

## 1. Tiny Glade changes the target

Tiny Glade is not primarily a one-shot building generator. Its defining
product behavior is **interactive construction chemistry**:

- the player edits simple intent;
- nearby systems recognize semantic relationships;
- walls, paths, openings, supports, roofs, bricks, planks, vegetation, and
  decoration react immediately;
- the result stays attractive without exposing the procedural complexity.

The official product description calls out gridless building and the automatic
assembly of bricks, pebbles, and planks. It also describes semantic reactions
such as a path crossing a building producing a door. The developers describe
the project as having begun as a procedural wall generator and distinguish its
hand-authored rules from one-button generative AI.

Tiny Glade's construction code is not open source. The useful strategy for the
VTT is therefore to study or reuse open implementations for each subsystem,
while keeping one Grafting-owned semantic pipeline.

## 2. Two generator families must stay separate

### 2.1 Interactive chemistry

Runs after a local user edit and updates only affected regions:

```text
user intent
  -> canonical graph/surface operation
  -> local relationship queries
  -> derived structural details
  -> derived unit dressing and decoration
  -> render deltas
```

This is the Tiny Glade-like core. It must be deterministic, incremental, fast,
undoable at the semantic-operation level, and suitable for browser/Wasm use.

### 2.2 Macro generation

Creates a proposal for a room, interior, dungeon, building, or settlement:

```text
generator parameters + seed
  -> LayoutProposal
       rooms
       boundaries
       openings
       circulation
       furnishing intents
  -> preview
  -> one confirmed semantic operation or transaction
```

Macro generators must not return only an opaque final mesh. Their output needs
to be translated into the same construction and placement nouns the editor
uses, so the generated result remains editable.

## 3. Highest-value codebases to study

| Candidate                     | License           | Runtime                                    | Most useful contribution                                                                                          | Recommended treatment                                                          |
| ----------------------------- | ----------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Aedifex                       | MIT               | Web, TypeScript, Three.js/WebGPU           | wall drawing, automatic miters, doors/windows, room detection, levels, smart furniture placement, preview, export | first source audit and behavioral reference                                    |
| Manifold                      | Apache-2.0        | C++, JS/TS/Wasm; external Rust ports exist | robust manifold mesh booleans, material/surface provenance, solid modeling                                        | dependency evaluation for exceptional clipping/CSG                             |
| Truck                         | Apache-2.0        | Rust, JS wrapper, wgpu                     | B-rep/NURBS, topology, tessellation, solid booleans                                                               | evaluate only if construction needs CAD-level surfaces                         |
| Fidget                        | MPL-2.0           | Rust, CPU/wgpu                             | implicit surfaces, meshing, height/normal output                                                                  | research prototype for organic blends and decorative geometry                  |
| bpypolyskel                   | GPL-3.0           | Python/Blender or standalone Python        | straight-skeleton roof faces from footprints                                                                      | algorithm/reference or isolated GPL tool; do not embed casually                |
| Infinigen / Infinigen Indoors | BSD-3-Clause      | offline Python + Blender                   | procedural rooms, individual assets, materials, indoor scenes, export                                             | offline research and content-authoring laboratory                              |
| ProcTHOR                      | Apache-2.0 code   | offline Python + AI2-THOR/Unity assets     | semantically plausible house layouts and furnishing rules                                                         | study proposal schema/rules; audit asset terms separately                      |
| Material Maker                | MIT               | offline Godot application                  | node-authored procedural textures and 3D painting                                                                 | easiest initial material-authoring tool                                        |
| Embark texture-synthesis      | MIT OR Apache-2.0 | Rust/CLI                                   | example-based texture variation, tiling, inpaint, guided synthesis                                                | useful algorithm/code reference; archived, so fork ownership would be required |
| rot.js                        | BSD-3-Clause      | TypeScript/browser                         | room/corridor and dungeon algorithms                                                                              | behavior reference; reusable algorithms belong in Rust here                    |
| WaveFunctionCollapse          | MIT               | reference implementation, many ports       | constraint-based tile adjacency and local pattern completion                                                      | useful for macro layouts/decor, not the core wall representation               |

### 3.1 Aedifex is the closest web implementation reference

Aedifex is especially relevant because it uses a web stack close to the VTT:
React, Three.js, WebGPU, TypeScript, a monorepo, geometry systems, spatial
queries, preview behavior, and GLB export. Its published features include:

- walls with automatic mitering and adjustable thickness/height;
- doors and windows attached to walls;
- automatic room/zone detection;
- floors, ceilings, roof segments, and multiple levels;
- furniture collision, wall snapping, and zone-boundary clamping;
- ghost preview before accepting generated changes.

It should be audited as a reference, not copied wholesale. Its authoritative
state, Three.js-based geometry, grid decisions, and TypeScript math do not
automatically satisfy Grafting's Rust authority and vendor-isolation rules.

High-value audit targets are its wall geometry systems, opening attachment,
zone detection, spatial index, smart placement, ghost-preview protocol, and
export normalization.

### 3.2 Manifold is the strongest robust-solid candidate

Manifold guarantees manifold output for solid triangle-mesh operations and
provides a JS/TS Wasm package. Its arbitrary vertex properties and source IDs
can preserve which material or input surface produced an output face.

Potential VTT uses:

- exceptional border bricks that require real clipping;
- cutting unusual openings from generated solid details;
- generating watertight unit prototypes;
- offline validation and repair of generated solids.

It should not replace the graph/surface model or be called once for every full
brick. Regular units remain instances; CSG is a limited fallback for trim or
special geometry.

### 3.3 Truck is powerful but probably larger than the first need

Truck is a Rust CAD kernel with curves, parametric surfaces, topology, B-rep,
NURBS, tessellation, and solid boolean operations. It aligns with the Rust
workspace better than a TypeScript geometry engine, but adopting a CAD kernel
would be a major architectural commitment.

Use it only if VTT construction actually requires curved parametric surfaces,
precise B-rep editing, or CAD interchange. Planar polygon walls, instance
dressing, and simple generated roofs do not justify it by themselves.

### 3.4 Fidget is a useful organic-geometry experiment

Fidget evaluates closed-form implicit surfaces, generates meshes through dual
contouring, and can produce heightmaps and normals. It is interesting for:

- rounded stone or plaster prototypes;
- organic transitions and decorative blobs;
- signed-distance-based masking or generated height data.

It is explicitly experimental and MPL-2.0. Treat it as a laboratory candidate,
not a default foundation.

### 3.5 Roof generation needs its own evaluation

Hipped and complex roofs are commonly derived from a footprint's straight
skeleton. `bpypolyskel` demonstrates a complete implementation and reports
large-scale testing, but it is GPL-3.0 Python code.

The VTT can study its expected inputs, outputs, edge cases, and tests. Direct
embedding, translation, or porting needs a separate license and algorithm
evaluation. Roof generation should be a Rust capability consuming footprint
intent and producing editable surface operations, not Python geometry shipped
inside the browser.

## 4. Materials, images, and unit assets

### 4.1 Easiest legal content sources

| Source     | Asset license | Useful content                        | Notes                                                            |
| ---------- | ------------- | ------------------------------------- | ---------------------------------------------------------------- |
| Poly Haven | CC0           | PBR textures, HDRIs, 3D models        | public API exists; live API has separate attribution/usage terms |
| ambientCG  | CC0           | seamless PBR materials, HDRIs, models | strong source for brick, stone, plaster, wood, and floors        |
| Kenney     | CC0           | game-ready 2D/3D packs, UI, props     | useful low-poly fixtures and prototypes                          |
| Quaternius | CC0           | stylized low-poly 3D packs            | strong fit for performant VTT props and variants                 |

CC0 minimizes redistribution risk, but every imported artifact should still
record source URL, source revision/date, content hash, declared license, unit
scale, axes, bounds, and normalization steps.

OpenGameArt, Sketchfab, general marketplaces, and research datasets mix many
licenses. They should not be bulk-ingested without per-asset provenance.

### 4.2 Material Maker is the easiest procedural-material start

Material Maker is an MIT-licensed Godot application that represents textures
and brushes as node graphs. It is suitable as an offline authoring tool for
producing consistent PBR maps without introducing a hosted AI service.

Recommended initial workflow:

```text
Material Maker graph
  -> albedo
  -> normal
  -> height
  -> roughness
  -> ambient-occlusion/masks
  -> compressed VTT material pack
```

The first VTT integration should consume baked standard maps. Embedding
Material Maker's graph runtime is a separate future decision.

### 4.3 Texture synthesis is relevant to the Tiny Glade lineage

Embark's `texture-synthesis` is a Rust implementation by Opara and Stachowiak
of example-based texture synthesis. It supports single/multiple examples,
guided synthesis, inpainting, seamless tiling, repeatable coordinate transforms,
and explicit seeds.

It is unusually compatible with the monorepo's Rust direction, but the
repository is archived and notes that strict determinism requires one thread.
It is a good source audit or controlled fork candidate, not an automatic
dependency.

Possible uses:

- turn a small CC0 plaster/stone sample into a larger seamless texture;
- generate coordinated albedo/normal/roughness variations by reusing the same
  coordinate transform across maps;
- fill texture borders or remove obvious seams;
- produce several deterministic visual variants of a unit asset.

It does not invent semantic content and struggles with strongly regular
patterns. Brick bond placement should remain geometric/rule-based.

### 4.4 Generate images from geometry when consistency matters

For unit assets, a controlled geometry-first pipeline is more reliable than
text-to-image generation:

```text
unit generator or CC0 model
  -> normalized 3D prototype
  -> procedural/baked PBR material
  -> automatic turntable and orthographic renders
  -> thumbnail, icon, token, and catalog images
  -> near/mid/far LOD artifacts
```

This produces catalog images that agree with the geometry rendered in the VTT.
AI image generation can remain an optional authoring adapter for concept art or
source textures, with code, model-weight, training-data, and output licenses
tracked independently.

## 5. Interior and environment generators

### 5.1 Infinigen Indoors

Infinigen is BSD-3-Clause and includes an indoor pipeline, individual asset
generation, procedural materials, external-asset support, and export to formats
such as OBJ and OpenUSD. It is the strongest open procedural-content laboratory
found in this pass.

It is not a browser library. It depends on Python and Blender and is best used
for:

- studying room and furnishing grammars;
- generating offline reference scenes;
- producing prototype assets/materials;
- evaluating how a seed becomes a full indoor scene;
- baking assets for later normalization into VTT runtime formats.

Its Blender node graphs and scene files must be converted/baked before normal
Web rendering.

### 5.2 ProcTHOR

ProcTHOR's Apache-2.0 code generates diverse, interactive, semantically
plausible houses for AI2-THOR. It is useful for understanding:

- room-type distributions;
- room adjacency and connectivity;
- door/opening placement;
- object categories and receptacle relationships;
- collision-aware furniture placement.

The generator code license does not automatically grant rights to every Unity
asset, AI2-THOR asset, or derived dataset. The VTT should adapt rule concepts or
consume a Grafting-owned layout schema while supplying its own audited assets.

### 5.3 Deterministic dungeons and layouts

`rot.js` provides mature dungeon algorithms and WFC provides tile-adjacency
constraint solving. They are useful references for macro layout generation,
but directly adopting TypeScript geometry/layout authority would conflict with
the repository's Rust-domain rule.

Appropriate use:

- evaluate algorithm families and fixtures;
- define deterministic Rust generators with equivalent product behavior;
- make their output semantic room/corridor/surface proposals;
- use WFC for local decoration or kit selection after topology exists.

WFC must not become the canonical wall graph or a universal solution for
interior design. It solves local adjacency constraints, not the entire
interactive-construction problem.

## 6. Proposed Tiny Glade-like capability stack

```text
Layer 1: construction intent
  wall paths, footprints, heights, openings, stairs, roofs

Layer 2: canonical structure
  graph nodes, edges, cycles, surfaces, semantic operations

Layer 3: relationship chemistry
  intersections, shared edges, path crossings, supports,
  opening attachment, room detection, connected pattern domains

Layer 4: structural derivation
  wall thickness, jambs, lintels, slabs, roofs, stairs, trim

Layer 5: visual dressing
  bricks, tiles, planks, beams, shingles, ivy, clutter

Layer 6: material/image derivation
  PBR maps, masks, seamless variants, far LOD, thumbnails

Layer 7: rendering
  mesh chunks, instance chunks, culling, picking, LOD, disposal
```

Each layer consumes stable outputs from the layer above. A visual brick never
becomes graph authority merely because it was procedurally generated.

## 7. Recommended evaluation sequence

### Evaluation A — Aedifex source audit

Read only the wall, opening, zone, smart-placement, preview, and export systems.
Produce a mapping of reusable algorithms versus assumptions that conflict with
Grafting. Do not add the repository as a dependency.

### Evaluation B — material and content authoring

Use Material Maker plus one Poly Haven or ambientCG CC0 source to create a
complete brick/plaster PBR pack. Normalize provenance and render it on the
existing wall surface.

### Evaluation C — unit geometry and surface dressing

Generate one brick prototype, instance a running bond over a wall with a door,
and compare full units plus trim variants against Manifold-generated edge cuts.

### Evaluation D — Tiny Glade relationship reaction

Prototype one semantic interaction: a path crossing a wall proposes an opening;
moving the path updates the opening preview; confirmation emits one operation.
This is a stronger proof of the target experience than generating an entire
castle at once.

### Evaluation E — interior proposal

Run one Infinigen Indoors and one ProcTHOR sample offline. Translate only their
semantic room/opening/furniture outputs into a neutral comparison fixture.
Measure how much generator-specific data would have to be discarded or mapped.

## 8. Initial shortlist

The strongest practical shortlist is:

1. **Aedifex** — study interactive web architectural editing.
2. **Material Maker** — author the first procedural PBR materials easily.
3. **Poly Haven + ambientCG** — supply provenance-clear CC0 source materials.
4. **Manifold** — evaluate robust special-case solid clipping.
5. **Infinigen Indoors** — study and produce offline procedural assets/scenes.
6. **ProcTHOR** — study semantic interior layout and furnishing rules.
7. **Embark texture-synthesis** — evaluate deterministic seamless variation in
   Rust, with an explicit maintenance/fork decision.
8. **bpypolyskel/straight-skeleton literature** — inform a future Rust roof
   generator without silently importing GPL code.

Truck, Fidget, WFC, and rot.js remain valuable research candidates but should
not be introduced until a concrete spike requires their capability.

## 9. Sources

- [Tiny Glade product page](https://store.steampowered.com/app/2198150/Tiny_Glade/)
- [Tiny Glade developer interview on Bevy and proceduralism](https://80.lv/articles/exclusive-tiny-glade-developers-discuss-bevy-proceduralism-publishers-cozy-games)
- [Aedifex](https://github.com/TangSY/aedifex)
- [Manifold](https://github.com/elalish/manifold)
- [Truck](https://github.com/ricosjp/truck)
- [Fidget](https://github.com/mkeeter/fidget)
- [bpypolyskel](https://github.com/prochitecture/bpypolyskel)
- [Infinigen](https://github.com/princeton-vl/infinigen)
- [ProcTHOR](https://github.com/allenai/procthor)
- [Material Maker](https://github.com/RodZill4/material-maker)
- [Embark texture-synthesis](https://github.com/EmbarkStudios/texture-synthesis)
- [rot.js](https://github.com/ondras/rot.js)
- [WaveFunctionCollapse](https://github.com/mxgmn/WaveFunctionCollapse)
- [Poly Haven license and API](https://polyhaven.com/license)
- [ambientCG](https://ambientcg.com/)
- [Kenney license FAQ](https://kenney.nl/support)
- [Quaternius license FAQ](https://quaternius.com/faq.html)
