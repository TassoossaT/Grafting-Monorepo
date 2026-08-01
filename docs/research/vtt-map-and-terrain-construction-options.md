# VTT map and terrain construction: product vision and rendering architecture

- Research date: 2026-08-01
- Status: mixed — some items below are genuinely decided through this session's
  discussion (marked **Decided**); others remain a non-normative candidate
  catalog (marked **Standby**/**Open**). Decided items still need their
  corresponding ADR/task follow-through before any code is written; nothing
  here is implemented yet
- Decision authority: this document does not itself close any ADR. Where it
  says "Decided," that reflects the owner's explicit direction in conversation,
  recorded here so it isn't lost — not a substitute for updating the ADR/task
  state that actually governs the repository
- Scope: the Virtual Tabletop (`apps/web-vtt`, not yet scaffolded) product
  vision, its map/terrain construction system, and the rendering architecture
  that supports it. Distinct from `docs/research/architecture-studio-open-source-options.md`
  (Studio's own document/canvas/search/tracing surface) and
  `docs/research/ai-agent-context-and-multi-agent-management-options.md`
  (AI agent context/coordination) — see those for their own topics

## Product vision

Stated goal: a VTT better than Foundry, with TaleSpire's ease of building
(snap-together construction, not hand modeling), aiming for the visual/
atmospheric polish bar set by the Brazilian horror TTRPG "Ordem Paranormal"
and streamer Celbit's highly-produced actual-play show. Explicitly **not**
photorealistic 3D modeling — the owner dislikes generic 3D-model aesthetics
and wants a 2.5D look.

Key clarification reached in conversation: **the 2.5D look is an art-direction
and camera-projection choice, not a reason to avoid 3D rendering technology.**
TaleSpire itself is genuine 3D (real geometry, a real engine) presented
through a fixed isometric-ish camera and a curated, chunky, stylized low-poly
asset pipeline — that combination is what reads as "2.5D," not the absence of
3D tech. This resolved an early tension in this conversation between wanting
Three.js (real 3D, already committed — see below) and wanting a 2.5D look.

### Four-tier construction model

The owner does not want to limit players to one skill level. Four tiers,
each needing to feed the same underlying state (see "Unifying substrate"
below):

| Tier | Audience | Status |
| --- | --- | --- |
| 0 — great default, near-zero effort | players with no time/skill for map-building | **Standby** — Townscaper-style one-click procedural generation is the target model (see below) |
| 1 — manual construction and editing of procedural results | players who want control | **Standby** — same Townscaper model supports this natively (add/remove a cell manually, the algorithm re-resolves locally) |
| 2 — import (existing images/boards) | players bringing existing content | **Open** — no research done yet on formats/mechanism |
| 3 — AI/prompt-driven creation and editing | players who want to describe what they want | **Open** — no tool-interface design done yet; connects to this repository's existing MCP/agent-orchestration research (`docs/research/ai-agent-context-and-multi-agent-management-options.md`, Part 3) applied to the VTT instead of the Studio |

### Unifying substrate: reuse the existing Command/DomainEvent engine

`libs/engine/domain-core` already implements `Command -> DomainEvent ->
Snapshot` with a state hash (Epic C, built and tested, `CURRENT_PLANNING_STATE.md`).
The insight reached in conversation: this can be the single substrate all
four construction tiers feed into — manual edits, procedural-generation
results, AI/prompt-driven edits, and imports all become `Command`s processed
by the same engine, with rendering (Three.js/deck.gl, see below) staying a
pure consumer of the resulting state. This keeps DEC-001 ("Rust is the sole
source of logic") intact across every tier, including the AI-driven one.

## Rendering architecture (Decided)

| Surface | Technology | Status |
| --- | --- | --- |
| Player's immersive view | **Three.js** | **Decided** — already a `Closed` rule in `GRAFTING_MASTER_SOURCE.md` ("Rust is the sole owner of GPU resources for mathematical computation. Three.js and the C# engine own the rendering resources"), not new; this session initially mistook it for new information, then corrected that |
| GM's analytical/overview view | **deck.gl** (+ `@deck.gl-community/editable-layers`) | **Decided** in conversation, pending ADR-0008 follow-up (see below) |
| Architecture Studio's code graph, future character-relationship webs | **React Flow (xyflow)** | **Decided** in conversation (see the node/edge library section below) |
| `packages/x6-canvas` (X6) | Architecture Studio only | **Decided** — dropped from the VTT; `docs/adr/ADR-0008-libs-boundary-and-domain-map.md` proposed reusing it for the VTT's "interactive map" before Three.js/deck.gl were confirmed as the real renderers. **That ADR needs a follow-up amendment; this document flags it but does not rewrite the ADR itself, per the owner's explicit-approval requirement for changing accepted decisions.** |
| Procedural-generation authoring UI (optional) | **Rete.js** (with its Three.js-based `rete-area-3d-plugin` if a 3D graph view is wanted) | **Standby** — only needed if a visual node-graph editor for building generation pipelines is actually pursued |

### Why deck.gl for the GM view

The owner was shown a demo (extruded buildings viewed from above, transit
flow lines) and wants that visual language applied to a fantasy city, not
real transit data, plus the ability to *edit* routes, not just view them.
Verified capabilities (deck.gl is MIT, governed under the OpenJS Foundation
via `vis.gl`, ~14.3k stars, very mature):

- **Building/structure relief**: `PolygonLayer` with `extruded: true` +
  `getElevation` — the classic "footprint + height, viewed from above" look,
  one of deck.gl's flagship use cases since its early releases.
- **Real (non-flat) terrain**: `TerrainLayer` reconstructs an actual mesh
  surface from a heightmap and explicitly supports non-geospatial views (not
  locked to real-world map projections) — confirmed via deck.gl's own docs.
  `TerrainExtension` fits *other* layers (buildings, routes) onto that
  irregular surface, either by vertical offset (object sits at the correct
  elevation) or by draping (projected as a texture) — this directly answers
  the owner's "is it flat-only?" concern: no, it is not.
- **Route/flow visualization**: `TripsLayer`/`ArcLayer` — animated
  path-with-trail visualization, the same technique used for real transit
  flow, applicable to trade routes, patrols, ley lines, or anything else the
  setting needs.
- **Density/analytical overlays**: `HexagonLayer` bins point data into
  hexagonal prisms of variable height — useful for any density-style overlay
  the GM wants (population, resource, danger, magic, etc.).
- **Route/polygon editing**: `@deck.gl-community/editable-layers` — the
  actively-maintained successor to Uber's now-unmaintained `nebula.gl`
  (no longer accepting external contributions). Fully 3D-enabled GeoJSON
  editing (polygons/lines/points), integrates natively with deck.gl. This is
  the concrete mechanism for "the GM can define/edit routes," not just view
  them.
- **Free 3D camera**: `OrbitView` — a non-geospatial 3D camera for examining
  arbitrary 3D content, confirming deck.gl is not locked to the fixed
  top-down "slippy map" angle its most famous demos use.
- **"Dark vision" mood**: `PointCloudLayer` (sparse points against black) is
  visually evocative of the mood the owner wants, but is **not** itself a
  fog-of-war/limited-vision mechanic — that would be built via deck.gl's
  **Effects** system (`LightingEffect` by default, custom post-processing
  effects via `@luma.gl/effects`, screen-space masking) — real and buildable,
  but bespoke engineering, not a layer you switch on.
- **Streaming procedural content at scale**: `Tile3DLayer` is bound to the
  standardized OGC 3D Tiles/ESRI I3S formats (real-provider data — Cesium
  ION, ArcGIS, Google) and is **not** a generic way to stream custom
  procedural content. The underlying rendering primitives it composites
  (`SimpleMeshLayer`, `ScenegraphLayer`) and the more general, format-agnostic
  `TileLayer` (viewport-based loading) *are* reusable for a custom
  procedural-tile-streaming scheme — the optimization pattern (load by
  viewport, level of detail) is achievable, just not by literally plugging
  into `Tile3DLayer`.
- **Precision on "can I do this all with polygons?"**: buildings/streets/
  hexagons are genuinely polygon-family (`PolygonLayer`, `PathLayer`,
  `HexagonLayer`'s hexagonal prisms). Terrain is not — it's heightmap/mesh
  data, a different representation, composed with polygons via
  `TerrainExtension`. Trips/routes are line/path data, an adjacent but
  distinct family. Point clouds are raw points with no polygon structure at
  all, a genuinely different primitive.
- **Open**: whether deck.gl's GM-overview scene and the Three.js player scene
  can share a rendering context/camera, or need to stay two separate views
  toggled between (the simpler, likely-first architecture: same underlying
  Rust-owned map data, two independent presentation layers, matching this
  project's existing computation/presentation separation philosophy). Not
  yet spiked.

### Node/edge library decision (Architecture Studio + future character webs)

Reached through direct comparison against this repository's actual
`packages/x6-canvas` code, not in the abstract:

- **X6's React support is node-only by design**, confirmed in X6's own
  official docs (`@antv/x6-react-shape`'s own description: "used to render
  **nodes** via React," no edge equivalent exists). This matches this
  repository's own edge code (`packages/x6-canvas/src/edges/presentation.ts`),
  which configures edges through X6's native `connector`/`attrs`/`labels`
  system, with no React component involved at all.
- **React Flow (xyflow) is symmetric by design** — `nodeTypes` and
  `edgeTypes` are both first-class React components with the same API.
- For a requirement of "every node *and* edge is a React element with no
  asymmetry," React Flow is the better technical fit; X6 cannot do this for
  edges at all, not a matter of more digging.
- X6's genuine remaining advantages (a shared SVG document letting
  filters/gradients span nodes+edges, raw SVG-attribute port customization
  already built in this repo's `ports.ts`, first-party `@antv/layout`
  companion package, a higher documented performance ceiling for very large
  graphs) remain real, but do not outweigh the symmetry requirement for
  Architecture Studio's code graph or a future character-relationship-web
  feature, neither of which needs X6's performance ceiling or its
  shared-SVG-document capability today.
- **Rete.js** is a different category entirely (a visual-programming *editor
  framework* with real execution semantics — sockets, data/control flow),
  not a general diagramming library. It's the wrong tool for a static or
  lightly-interactive graph (architecture graph, character webs) but the
  right tool if a genuinely *editable, executing* pipeline is ever built —
  most concretely, a visual editor for the procedural-generation pipeline
  below (Rust generation crates behind Rete's UI), or the still-undecided
  MCP-orchestration-in-Studio feature from Part 3 of the AI-agent research
  document. Rete also has a real, verified 3D mode
  (`rete-area-3d-plugin`, built on Three.js, with `WebGLRenderer`/
  `CSS3DRenderer`, camera, orbit controls) — relevant only if a node-graph
  needs to render inside the VTT's actual 3D scene.

## Procedural + manual map-building research

### Reference model: Townscaper

The closest match found to "not blocky, not rigid-grid, procedural resolves
from simple manual input, terrain has real relief." Mechanism (Oskar
Stålberg's own talks: "Wave Function Collapse in Bad North," EPC2018; "The
Story of Townscaper," Konsoll 2021):

- An irregular quad mesh (not a rigid grid) — starts as hex-tiled equilateral
  triangles, randomly paired into quads, then globally relaxed/smoothed so
  cells stay roughly square but organically irregular.
- Manual input is a single click (fill/empty a cell); a local **Wave
  Function Collapse** solve re-derives valid architectural modules (walls,
  roofs, stairs) across the connected structure from a hand-authored
  tileset's adjacency constraints.
- Vertical relief comes from extruding the 2D grid into stacked layers, with
  a marching-cubes-style step (~15 hand-authored tile shapes covering the
  256 corner-fill configurations) resolving smooth stepped cliffs/waterlines
  between filled/empty neighbors.
- Genuinely hybrid: the player acts manually one cell at a time; the
  algorithm procedurally re-derives everything else.

### Other reference games surveyed

| Game | Distinctive technique | Terrain/elevation | Procedural/manual |
| --- | --- | --- | --- |
| Valheim | Terrain edits stored as replayable "modifier" objects over a base heightmap; tool metaphors (pickaxe=eraser, raise-ground=pencil, level-ground=smudge stick) | Full heightmap sculpting, core mechanic | Hybrid — world/biomes procedural, sculpting/building manual |
| Manor Lords | Gridless building placement; roads as flexible splines following terrain contour; dynamic plot subdivision | Real heightmap, not player-sculptable | Manual placement on hand-designed maps (no shipped procedural map generation yet) |
| No Man's Sky | Continuous real-time voxel/density-field terrain generation, no loading screens | True volumetric terrain, edits capped (~15,000/save) — a practical lesson: unlimited free-form edits need a storage budget | Hybrid — terrain procedural, building manual snap-placement |
| Zelda: Tears of the Kingdom (Ultrahand) | Free-form physics attachment at arbitrary points/angles, no grid/socket snapping at all; "multiplicative gameplay" design philosophy | Not terrain-deformation based | Fully manual/emergent, no generation |
| Besiege | Rigid-body physics sandbox, breakable joints, stability from mass distribution | Not a terrain system | Fully manual |
| Astroneer | Aggressive real-time voxel terrain sculpting as core gameplay (dig, ramp, flatten) | Voxel/density-field, same family as No Man's Sky | Hybrid — per-planet biome generation procedural, sculpting/building manual |
| TaleSpire | Hard hex-grid tiles, elevation via scroll-wheel while a tile is picked up, auto-stacking on collision; freeform (non-gridded) decor props | Stepped hex elevation | Fully manual, no generation |

General pattern noted across professional terrain tools (World Machine,
World Creator): procedural-first-pass (erosion/heightmap), manual-refinement
second pass — a useful UX workflow model regardless of which engine is used.

### Rust crates for the generation/meshing pipeline

Chosen for matching DEC-001 (Rust owns logic) and the owner's
closed-source-sale license constraint (MIT/Apache-2.0 only):

| Purpose | Crate | License | Note |
| --- | --- | --- | --- |
| Tile-based procedural generation (Townscaper/WFC-style) | **`ghx_proc_gen`** (Henauxg) | Dual MIT/Apache-2.0 | Native 2D and 3D Wave Function Collapse/Model Synthesis, socket-based adjacency, rotation support; usable standalone without adopting a full game engine |
| Smooth/organic terrain meshing | **`fast-surface-nets-rs`** (bonsairobo) | MIT OR Apache-2.0 | SDF-to-mesh Surface Nets, SIMD via `glam`, chunk-seamless |
| Blocky terrain meshing (alternative) | **`block-mesh-rs`** (bonsairobo) | MIT OR Apache-2.0 | Visible-face and greedy-quad meshing for Minecraft-style voxels |
| Base noise (feeds the meshing crates) | **`noise-rs`** (Razaekel/noise-rs) | Dual MIT/Apache-2.0 | Perlin/Simplex/Worley/fractal combinators; the de facto standard Rust noise crate |
| LOD stitching between chunks at different resolutions (if needed later) | Transvoxel algorithm (Eric Lengyel) | Free-to-use lookup tables, not a licensed library | Solves seamless boundary meshing between different-resolution chunks |

`building-blocks` (the predecessor to `block-mesh-rs`/`fast-surface-nets-rs`)
is archived/unmaintained — avoid for new work, its successors above are the
maintained continuation.

### Reference-only (study the architecture, never reuse the code)

- **Godot Voxel module** (Zylann/godot_voxel) — MIT, but tightly coupled to
  Godot 4; useful for its generator-graph and editing-layer design, not
  usable standalone.
- **Veloren** — **GPL-3.0**, excluded from any code reuse per this
  repository's standing copyleft policy; valuable only as an architecture/
  algorithm reference (Rust voxel meshing, world generation).
- **Voxelis** (WildPixelGames) — Rust, dual MIT/Apache-2.0, smaller/newer
  (109 stars), sparse voxel octree DAG with batched editing; license-clean
  and worth prototyping against for the manual-editing/storage layer if the
  crates above prove insufficient.

### Node-based visual procedural generation: a real gap

No genuinely open-source, Houdini-equivalent, Rust-backed node-graph engine
for 3D procedural generation was found. Houdini itself is commercial;
Blender's Geometry Nodes is GPL (reference-only, per this repository's
standing policy); Babylon.js `NodeGeometry` is the closest "geometry nodes on
the web" precedent but is JS-side logic, conflicting with DEC-001; Graphite
(Rust/WASM, Apache-2.0) is the closest architectural example of "Rust core +
web-deliverable node-graph editor" but is a 2D vector/compositing engine, not
3D geometry. **This means Rete.js, layered over the Rust crates above, would
be building something genuinely novel if pursued** — not adopting an
existing solution.

## Spin-off findings from evaluating GeoLibre

The owner asked about `opengeos/GeoLibre` (a cloud-native GIS platform, MIT,
~4.8k stars). The platform as a whole does not fit — it's built for
real-world geospatial analysis (SQL geoprocessing, satellite imagery,
planetary basemaps), not fantasy map construction. Three of its component
technologies are independently relevant, pulled out on their own:

- **Tauri** — Rust core + system webview frontend, MIT/Apache-2.0, a
  lighter/more secure Electron alternative. Relevant to the still-open
  `GATE-002`/`GATE-003` (Desktop client engine/platform choice, currently
  "open, indefinite standby," requiring the owner's explicit instruction to
  resume per `CURRENT_PLANNING_STATE.md`) — Tauri would let the same
  Three.js/deck.gl web frontend be reused for a desktop client with no
  duplication. Not a decision, just a candidate worth having on record for
  when that gate reopens.
- **Turf.js** — lightweight, focused GeoJSON spatial-math library (distance,
  buffer, intersection, area). Useful independently of any GIS framework for
  VTT needs like distance measurement, area-of-effect templates, or
  line-of-sight math.
- **MapLibre GL JS** — open-source 2D vector-tile map renderer (Mapbox GL JS
  fork). Initially considered for the GM-overview role, superseded by
  deck.gl once the owner's actual visual reference (extruded buildings +
  animated flow) matched deck.gl's flagship use cases far more precisely.

## Open items (not resolved by this document)

1. **`ADR-0008` follow-up amendment** — its "VTT's interactive map reuses
   `packages/x6-canvas`" proposal needs to be superseded to reflect Three.js
   (player view, already `Closed` in the master source) and deck.gl (GM
   view) as the VTT's actual renderers, with X6 remaining
   Architecture-Studio-only. Flagged here, not rewritten, pending the
   owner's explicit sign-off on the ADR text itself.
2. **Import format/mechanism (Tier 2)** — no research done yet.
3. **AI/prompt tool-interface design (Tier 3)** — no design done yet; should
   build on this repository's existing MCP/agent-orchestration research
   (`docs/research/ai-agent-context-and-multi-agent-management-options.md`,
   Part 3), applied to the VTT's map domain instead of Architecture Studio.
4. **deck.gl + Three.js coexistence** — whether the GM and player views can
   share a rendering context, or should stay two independently-rendered
   views over the same Rust-owned data (the likely simpler first
   architecture). Not spiked.
5. **`packages/ui`'s component-preview tool** — Storybook was the owner's
   stated visual preference over Ladle/React Cosmos/Bit/Playroom/others
   researched earlier in this session, but never formally confirmed as a
   final pick; recorded here as the leading candidate, not yet decided.
6. **Whether Rete.js is actually built** — its role here is conditional on
   the owner actually wanting a visual node-graph editor for procedural
   generation; if a simpler UI (forms, sliders, presets) covers the need,
   Rete adds a real, currently-unsolved-elsewhere capability but also real
   scope.

## Adoption checklist

Unchanged from `docs/research/architecture-studio-open-source-options.md`;
reproduced here so this document is self-contained. Before any candidate
above becomes a real dependency:

1. assign a separate task and single owner;
2. state the measured product need and rejected simpler alternative;
3. re-check current license, transitive licenses, provenance, maintenance,
   and security posture (facts in this document are dated 2026-08-01 and
   will drift);
4. identify the smallest owning boundary and Grafting-owned public contract;
5. prove that vendor types do not leak and graph calculations are not
   copied outside Rust;
6. define build, runtime, bundle, memory, and data-retention costs;
7. run a disposable spike with acceptance and rollback criteria;
8. update an ADR only when adoption changes an architectural decision.
