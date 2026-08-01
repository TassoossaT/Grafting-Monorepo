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
photorealistic 3D modeling — the owner dislikes generic 3D-model aesthetics.

**Correction (supersedes this document's earlier draft): the world itself is
genuinely free 3D, not 2.5D.** A free camera — top-down, side-on, orbit, any
angle, no locked presentation — is a first-class requirement for both the
player's and the GM's views. The earlier framing in this document ("TaleSpire's
fixed isometric-ish camera + stylized low-poly assets is what 2.5D means here")
was wrong and is retracted, not refined: the owner does not want a fixed or
isometric-ish camera at all.

2.5D still has a place, but scoped down from "the whole game's look" to an
**optional representation technique for specific asset classes** — tokens
(characters/creatures) and some items may render as flat/billboarded 2D art
standing inside the fully 3D environment, the same idea as a tabletop
miniature standee in a modeled diorama, or billboarded sprites in a 3D world
(classic techniques: Doom's billboarded enemies, Octopath Traveler's "HD-2D"
characters over full 3D scenery). Terrain, buildings, and the environment at
large stay full 3D geometry with no camera restriction. This does not change
the rendering-architecture decision below — a free orbit camera and sprite
billboarding are both ordinary, native Three.js capabilities (an
`OrbitControls`-style free camera; `THREE.Sprite`, which always faces the
camera, as the natural billboard mechanism for 2.5D tokens) — no new
dependency, no architectural fork, only a product-vision and asset-authoring
clarification.

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

**Superseded from this document's earlier draft**: deck.gl was briefly
decided as a real dependency for the GM's overview view. That is no longer
the plan. deck.gl is now a **technique/visual reference only** — its
capabilities are being replicated natively in Three.js instead of adopted as
a second rendering library. This was reached after checking whether deck.gl
and Three.js could share a WebGL context (technically possible, but the
deck.gl team itself warns it's fragile and breaks across either library's
updates) and whether Rust/`wgpu` could replace deck.gl's `luma.gl` substrate
to ease that merge (it can render to WebGPU/WebGL2 from Wasm — already
proven in this repo's own `spikes/wgpu-native-web` — but that only moves
which technology plays one of the two roles in a still-fragile two-renderer
setup, and going further to make Rust/`wgpu` the *only* renderer would mean
dropping Three.js entirely, reopening the master source's own `Closed`
rendering rule for a much bigger reason than avoiding a library merge).
Once it became clear that Three.js already provides native or near-native
equivalents for nearly everything the deck.gl demo showed (see below), the
simplest architecture won: **one renderer, no cross-library juggling, fully
inside the already-accepted rule.**

| Surface | Technology | Status |
| --- | --- | --- |
| Player's immersive view **and** GM's analytical/overview view | **Three.js**, single renderer for both | **Decided** — Three.js itself is not new (already a `Closed` rule in `GRAFTING_MASTER_SOURCE.md`: "Rust is the sole owner of GPU resources for mathematical computation. Three.js and the C# engine own the rendering resources"; this session initially mistook it for new information, then corrected that). What's newly decided is that Three.js handles *both* views — deck.gl is not adopted as a second rendering library |
| deck.gl (+ `@deck.gl-community/editable-layers`) | Reference/parameter only | **Reference only** — not a dependency. Its layer catalog is the specification of *what to replicate*, studied and reimplemented with Three.js's own primitives |
| Architecture Studio's code graph, future character-relationship webs | **React Flow (xyflow)** | **Decided** in conversation (see the node/edge library section below) |
| `packages/x6-canvas` (X6) | Architecture Studio only | **Decided** — dropped from the VTT; `docs/adr/ADR-0008-libs-boundary-and-domain-map.md` proposed reusing it for the VTT's "interactive map" before Three.js was confirmed as the sole real renderer. **That ADR needs a follow-up amendment; this document flags it but does not rewrite the ADR itself, per the owner's explicit-approval requirement for changing accepted decisions.** |
| Procedural-generation authoring UI (optional) | **Rete.js** (with its Three.js-based `rete-area-3d-plugin` if a 3D graph view is wanted) | **Standby** — only needed if a visual node-graph editor for building generation pipelines is actually pursued |

### What deck.gl demonstrates, and its Three.js-native equivalent

The owner was shown a demo (extruded buildings viewed from above, transit
flow lines) and wants that visual language applied to a fantasy city, not
real transit data, plus the ability to *edit* routes, not just view them.
Each capability, and how it gets built in Three.js instead of adopted from
deck.gl:

| Need (deck.gl's demonstration) | Three.js-native equivalent |
| --- | --- |
| Building/structure relief (`PolygonLayer`, `extruded: true`) | **`THREE.ExtrudeGeometry`** — built into Three.js core, no porting needed at all for this specific piece |
| Real (non-flat) terrain (`TerrainLayer`) | **`THREE.PlaneGeometry` + vertex displacement from a heightmap** — the standard, well-documented Three.js terrain technique, fed by the same heightmap data the Rust meshing crates below produce |
| Encaixing other features onto that terrain (`TerrainExtension`) | Sample the same heightmap at each feature's XZ position to compute its Y position — plain math, no library needed |
| Route/flow visualization (`TripsLayer`/`ArcLayer`) | **`Line2`/`LineGeometry`/`LineMaterial`** (official Three.js addon, `three/addons/lines/Line2.js`) gives real world-width lines; the animated fading-trail effect itself is a custom shader inspired by deck.gl's technique, layered on top |
| Density/analytical overlays (`HexagonLayer`) | **`THREE.InstancedMesh`** + a hexagonal `ExtrudeGeometry` — no built-in equivalent by name, but straightforward with primitives Three.js already has |
| Route/polygon editing (`@deck.gl-community/editable-layers`) | Three.js's built-in **`Raycaster`** is the necessary building block; the polygon-editing UX layer itself is custom, no ready-made equivalent found |
| "Dark vision" mood / limited visibility | Not from `PointCloudLayer` (that was aesthetic inspiration, not a mechanic) — a custom post-processing/masking effect over the normal Three.js render pass, the same category of work it would have been in deck.gl's own Effects system |
| Grid-topology flexibility (hex/square/triangular as a configurable, non-limiting reference grid) | See **Sylves** below — a concept reference, not a dependency |

### Grid-topology reference: Sylves

Found while looking for how to let the owner choose a configuration grid
(hexagons, squares, triangles, etc.) without *limiting* generation to that
grid's shape. **Sylves** (BorisTheBrave, <https://github.com/BorisTheBrave/Sylves>,
MIT, C#, ~223 stars) provides a uniform abstraction over multiple grid
topologies (square, hex, triangular, 3D honeycombs) through one interface,
so algorithms don't need separate code per grid type. Its own documentation
includes a tutorial specifically modeling **Townscaper's** grid using
Sylves — a direct, documented connection to the reference model already
chosen. It is C#, not Rust, so it cannot be used as a dependency (DEC-001);
it's a **concept reference** for the design pattern ("one grid abstraction,
multiple topologies, generation output not bound to the configuration
grid's shape"). If this concept is later ported into Rust, that porting
goes through the third-party-attribution system (`THIRD_PARTY_NOTICES.md`,
`.ai/coordination/PROTOCOL.md` rule 8) the same as any other adapted code —
though note that reimplementing a *design pattern* from scratch, without
copying Sylves' actual code, likely does not require an attribution entry
at all (ideas/APIs are not copyrightable, only expression is); attribution
is only required if concrete Sylves code/algorithms are copied or closely
transliterated.

### Guided construction mode (refined design)

In addition to Townscaper's free-form single-click building, the owner
wants a **guided** mode: select an area, select generation parameters, and
let the system generate within those constraints inside that area. The grid
(hexagonal by default, per the deck.gl `HexagonLayer` inspiration, but not
limited to hex — see Sylves above) is the **configuration/parameter layer**
(paint a region, set elevation/biome/density targets per cell) — it is not
necessarily the shape of the final generated output. The actual visual
result still uses Townscaper-style organic mesh relaxation, consuming the
grid's parameters as constraints/seeds. This mirrors exactly the pattern
Sylves' own Townscaper tutorial documents: a regular grid as a generation
seed, relaxed into an irregular, non-gridded final mesh.

### Interactable constructions and the existing Command/DomainEvent engine

A generated or imported building is not just decorative geometry — a door
that opens, a container that holds loot, a trigger that fires an event must
be a real domain entity, with identity in `libs/engine/domain-core`'s
existing `Command -> DomainEvent -> Snapshot` engine (see "Unifying
substrate" above), regardless of which construction tier created it. For
procedural generation (Tier 0/1) specifically, this means some tileset
modules in the WFC generation (`ghx_proc_gen`) need to be tagged as
interactable types (door, container, trigger) at generation time, so the
resulting state has real interactive entities placed at the correct
positions, not just visual variety.

### Procedural-generation crates via the existing Isekai/Wasm pathway

The Rust crates below (Wave Function Collapse, terrain meshing, noise) have
no direct JavaScript equivalent — they need to reach Three.js (which only
runs JS/Wasm in the browser) through the **same Isekai/Wasm/Worker pathway
already built and proven** for `libs/engine/domain-core`
(`libs/isekai/wasm-bridge` -> `packages/isekai-wasm` -> `packages/
isekai-web-client`'s `IsekaiEngine`, running inside a Dedicated Worker —
the same pattern `apps/architecture-studio/src/layout.worker.ts` already
uses for off-main-thread computation). Concretely: a `wasm-bindgen`-exposed
Rust function (e.g. `generate_terrain(params) -> Float32Array`) runs inside
the Worker; the resulting typed array crosses to the main thread, where
Three.js consumes it directly (`BufferGeometry.setAttribute(...)`, or
deciding which prefab mesh to instantiate per WFC output cell). This keeps
DEC-007/DEC-008's split intact: Rust computes (including procedural
generation now), Three.js only renders.

**Not yet verified**: whether `ghx_proc_gen`, `fast-surface-nets-rs`,
`block-mesh-rs`, and `noise-rs` actually compile cleanly to
`wasm32-unknown-unknown` and run correctly inside a real Worker. All four
appear to be pure-computation crates with no obvious OS-specific
dependencies, but "appears to" is not proof — this repository's own
established culture (the `wgpu-native-web` spike, the Wasm panic-scoping
investigation) is to verify this kind of claim with a real compile-and-run
check, not assume it. **Recorded as a concrete future spike, not done in
this pass.**

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

Additional confirmed details (web research, 2026-08-01, primarily
[gamedeveloper.com's "How Townscaper Works"](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making)):

- **The tileset is large**: over 500 hand-crafted tile modules define valid
  X/Y/Z-axis adjacency for the full facade/roof/decoration system — a
  separate, larger figure than the ~15-tile marching-cubes corner-fill step
  above, which is specifically about the vertical stepping between
  filled/empty cells (both figures are kept here as distinct, sourced
  claims rather than merged into one falsely-precise number).
- **WFC resolves in real time, during play** — not pre-baked like Bad
  North's use of the same technique. This matters directly for our "guided
  construction mode": the re-solve has to be fast enough to feel responsive
  to a live edit, not just correct.
- **Two-pass generation**: hard placement decisions (what module goes where)
  resolve first; visual decoration (chimneys, bushes, benches, statues,
  window stencils) is a separate second pass layered on top specifically to
  keep the first pass's latency low. Directly reusable pattern for our own
  pipeline — structure and decoration do not have to be the same solve.
- **"Recipes"**: priority pattern-rules layered above raw adjacency
  constraints — e.g. gardens only spawn in enclosed, flat, wall-adjacent
  areas; walls/windows appear at house corners or color transitions. This is
  a second rule layer on top of WFC adjacency, not something adjacency rules
  alone produce.
- **Graceful failure, not hard failure**: unsatisfiable adjacency (e.g. long
  thin structures) is allowed to silently fail locally — an occasional
  disconnected/odd element — rather than freezing or crashing generation.
  Worth carrying into our own implementation as an explicit design choice,
  not an accident to avoid.
- **Performance is a real, named constraint**: Stålberg notes the delay
  between placing a block and seeing its decoration resolve grows with
  structure complexity — a concrete data point for why the Wasm-compile
  verification spike (open item 6 below) needs to measure real solve time,
  not just "does it compile."

### Interior generation: a confirmed gap, and how to close it

The owner explicitly noticed this was missing. Confirmed directly, not
assumed: **Townscaper has no interior or walkable-room generation at all.**
This is absent from every technical writeup found (including the detailed
gamedeveloper.com article above), and Townscaper's own Steam community has
an open discussion thread asking for interior design as a missing feature,
with no indication it shipped. Townscaper's algorithm only ever resolves
exterior facades, roofs, and massing — the "inside" of a building is not
represented at all in its data model. This is a genuine limitation of the
reference model itself, not a gap in this document's research.

The good news: closing this gap does not require a different reference
model or a new dependency — it needs a **second generation pass using the
same technique family (Wave Function Collapse), driven by a different
tileset**, applied to the building's own footprint once the exterior shell
exists. Found via
[BorisTheBrave's "Wave Function Collapse tips and tricks"](https://www.boristhebrave.com/2020/02/08/wave-function-collapse-tips-and-tricks/),
a [Medium writeup on combining WFC with Binary Space Partitioning](https://medium.com/@ShaanCoding/implementing-wave-function-collapse-binary-space-partitioning-for-procedural-dungeon-generation-2f1a6cc376db),
and a GDC Vault talk on *Caves of Qud*'s tile-based generation:

- **Room layout from small tile combos**: BorisTheBrave documents that a
  4-tile combo (one tile empty) is enough to generate square rooms with WFC;
  room size is tunable via tile weighting, and doors/corridors are added as
  an additional adjacency rule on top — this is the same "tileset +
  adjacency" idea as Townscaper's facade system, just aimed inward instead
  of outward.
- **The "path constraint"**: a documented WFC enhancement that forces global
  connectivity across the whole solve, so doors automatically connect
  separate rooms and no room generates as an unreachable isolated pocket —
  directly the guarantee a VTT building's interior needs (every room
  reachable from the entrance), and something plain local WFC does **not**
  provide by default.
- **"Fixed tiles"**: pre-placing specific tiles before the WFC solve runs,
  letting hand-authored content and procedural fill coexist in the same
  pass. This maps directly onto this document's existing four-tier
  construction model — Tier 1 (manual construction/editing of procedural
  results) *is* fixed-tile pre-placement, already a native WFC concept, not
  something we'd need to invent on top of `ghx_proc_gen`.
- **BSP-partition-then-WFC-fill, a concrete two-stage pipeline**: partition
  the building's interior footprint into rooms first (Binary Space
  Partitioning, or a straight-skeleton-style subdivision of the polygon),
  then run a WFC pass *within each room* for furniture/prop detail. This
  gives a clean two-stage algorithm: BSP answers "where are the rooms,"
  WFC answers "what's in each room."
- **Professional precedent for multi-pass pipelines**: *Caves of Qud* uses
  WFC for a middle detail-fill pass, with separate passes handling
  connectivity and content population — validating a layered pipeline
  (shape → connectivity → population) as an established professional
  pattern for this kind of generation, not a novel risk unique to this
  project.

Proposed integration into this project's own architecture (a design
proposal, not yet an implemented decision):

1. The exterior generation (Townscaper-style) already produces a building's
   footprint polygon at each vertical floor layer.
2. Partition each floor's footprint into rooms (BSP or straight-skeleton
   subdivision of the same polygon) — a new algorithmic step, not currently
   covered by any crate already chosen below.
3. Run a **second `ghx_proc_gen` pass**, with an interior-specific
   tileset/adjacency set (walls, doors, furniture, props), inside each
   partitioned room — reusing the same crate already chosen for exterior
   generation, not a new dependency, since `ghx_proc_gen` is generic
   WFC/Model Synthesis rather than Townscaper-specific.
4. Apply the path-constraint idea so every room is guaranteed reachable from
   the building's entrance.
5. Tag interactable modules (door, container, trigger) at generation time,
   exactly as already described in "Interactable constructions" above — the
   same domain-core tie-in applies identically to interior content.

Found but **not verified** in this pass: [`dominguerilla/wfc-dun-gen`](https://github.com/dominguerilla/wfc-dun-gen)
(a GitHub project specifically for WFC dungeon generation) — its language,
license, and whether it's a standalone library or engine-coupled were not
confirmed (its README could not be fetched in this pass); recorded here as
a candidate to inspect later, not adopted or license-cleared.

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
   as the VTT's sole real renderer (both player and GM views), with X6
   remaining Architecture-Studio-only. Flagged here, not rewritten, pending
   the owner's explicit sign-off on the ADR text itself.
2. **Import format/mechanism (Tier 2)** — no research done yet.
3. **AI/prompt tool-interface design (Tier 3)** — no design done yet; should
   build on this repository's existing MCP/agent-orchestration research
   (`docs/research/ai-agent-context-and-multi-agent-management-options.md`,
   Part 3), applied to the VTT's map domain instead of Architecture Studio.
4. **`packages/ui`'s component-preview tool** — Storybook was the owner's
   stated visual preference over Ladle/React Cosmos/Bit/Playroom/others
   researched earlier in this session, but never formally confirmed as a
   final pick; recorded here as the leading candidate, not yet decided.
5. **Whether Rete.js is actually built** — its role here is conditional on
   the owner actually wanting a visual node-graph editor for procedural
   generation; if a simpler UI (forms, sliders, presets) covers the need,
   Rete adds a real, currently-unsolved-elsewhere capability but also real
   scope.
6. **Wasm-compile verification spike** — confirm `ghx_proc_gen`,
   `fast-surface-nets-rs`, `block-mesh-rs`, and `noise-rs` actually compile
   to `wasm32-unknown-unknown` and run correctly inside a real Worker,
   mirroring the existing `wgpu-native-web` spike's rigor. Not done yet.
7. **`ghx_proc_gen`'s grid-topology support** — not confirmed whether it has
   native hexagonal-grid topology support or only a generic N-dimensional
   grid requiring custom topology work to get hex behavior (the Sylves
   reference above models this uniformly in C#; whether `ghx_proc_gen`
   needs the same built on top, in Rust, is unverified).
8. **Interior/room-generation pipeline is a proposal, not a design** — the
   BSP-partition-then-WFC-fill approach and the path-connectivity constraint
   (see "Interior generation" above) are documented techniques from external
   research, not yet worked into a concrete plan for this repository (tile
   authoring for interior modules, how BSP partitioning is actually
   implemented, how it plugs into `ghx_proc_gen`'s real API).
9. **`dominguerilla/wfc-dun-gen`'s license/language/API** — found via search
   as a relevant reference project, not verified in this pass (its README
   could not be fetched); needs a real look before citing it as more than a
   name.

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
