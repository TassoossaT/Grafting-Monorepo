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
  (AI agent context/coordination) — see those for their own topics. For how
  this fits into the *whole* VTT product (tokens, rules engine, multiplayer,
  GM/player tools, deployment), see
  `docs/research/vtt-product-scope-map.md`, which indexes this document
  rather than repeating it

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
| Architecture Studio's code graph and future node-graph surfaces | **Rete.js**, private inside `@grafting/ui` | **Adopted (DEC-056)** — the owner selected it as the sole active graph-canvas engine; consumers use vendor-neutral UI contracts |
| `packages/x6-canvas` (X6) | Dormant reference only | **Retired (DEC-056)** — no active consumer, root validation, or generated API documentation; reactivation needs a new owner decision |
| Procedural-generation and heightfield visualization | **Three.js**, private inside `@grafting/ui` | **Adopted boundary (DEC-056)** — it remains the non-graph 3D renderer and is not exposed through consumer contracts |

### What deck.gl demonstrates, and its Three.js-native equivalent

The owner was shown a demo (extruded buildings viewed from above, transit
flow lines) and wants that visual language applied to a fantasy city, not
real transit data, plus the ability to *edit* routes, not just view them.
Each capability, and how it gets built in Three.js instead of adopted from
deck.gl:

| Need (deck.gl's demonstration) | Three.js-native equivalent |
| --- | --- |
| Building/structure relief (`PolygonLayer`, `extruded: true`) | **`THREE.ExtrudeGeometry`** — built into Three.js core, no porting needed at all for this specific piece |
| Real (non-flat) terrain (`TerrainLayer`) | **`THREE.PlaneGeometry` + vertex displacement from a heightmap** — the standard, well-documented Three.js terrain technique, fed by the same heightmap data the Rust meshing crates below produce. Scoped to **distant background scenery** outside the buildable area — the buildable area's own elevation uses a discrete WFC terrain-block tileset instead, see "Terrain elevation" below |
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

### Historical node/edge comparison (superseded by DEC-056)

The comparison below records the evidence available before the owner's
2026-08-04 decision. Its React Flow recommendation and conditional Rete status
are superseded: Rete.js is adopted as the sole active graph-canvas engine,
private inside `@grafting/ui`, and X6 is retired.

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

### Platforms, camera modes, and color as a generation input

Further web research (2026-08-01), primarily
[Wikipedia](https://en.wikipedia.org/wiki/Townscaper),
[UploadVR's Townscaper VR coverage](https://www.uploadvr.com/townscaper-vr-arrives-october/),
a [Steam Community guide on custom color palettes](https://steamcommunity.com/sharedfiles/filedetails/?id=2585484672),
and the [`latunda/townscaper`](https://github.com/latunda/townscaper) GitHub repository:

- **Townscaper shipped a VR mode** (Meta Quest and Pico, October 2023) — a
  real, successful precedent for this project's just-decided free-camera
  requirement. The reference model itself proves free 3D navigation (up to
  and including VR) works for this exact building style; nothing about the
  Townscaper aesthetic depends on a locked camera.
- **Camera controls are player-driven, not automated**: rotate, zoom, and a
  **manual time-of-day/lighting adjustment** are explicit player controls —
  confirmed independently in two sources. There is no automatic day-night
  cycle; mood lighting is a dial the player turns, not a simulation. Cheap
  and effective — worth carrying directly into our GM-view tooling as a
  manual lighting control rather than building a full day-night simulation
  first.
- **Color/type is itself a generation input, not just cosmetic** — a
  concrete, useful precedent for this document's own "grid as a
  configuration/parameter layer" idea (see "Guided construction mode"
  above). The mechanism: exactly 16 block types, stored as a literal 1×16
  pixel palette image; players can reassign the whole palette (community
  palette-sharing exists, e.g. `latunda/townscaper`) but not add types past
  16. Adjacent blocks of the *same* type merge into larger uniform runs;
  *alternating* types at a boundary triggers different architectural rules
  (more doors/lighthouses/arches vs. more windows on a uniform run). Type
  selection is functionally a constraint the player paints onto the grid,
  exactly the same shape as our own hex-grid parameter-layer idea — this is
  independent confirmation the pattern works in a shipped product, not just
  a design analogy.
- **No traditional undo/redo is documented anywhere for Townscaper** — a
  real UX gap in the reference model itself, not something we should
  silently copy. This project's own `libs/engine/domain-core`
  (Command → DomainEvent → Snapshot, already built) gives undo/redo for
  free across every construction tier, since every edit is already an
  event in a replayable log — a concrete place this project can exceed the
  reference model's own UX, not just match it.
- **Checked for an open-source engine shortcut, found none**: `latunda/townscaper`
  looked promising by name but is confirmed to be only a community
  resource repository (custom color palettes as PNGs, shared world-save
  files) — not a reimplementation or clone of Townscaper's engine. No
  open-source Townscaper-equivalent engine exists to build on top of;
  `ghx_proc_gen` plus our own tileset authoring remains the real path.

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

### Terrain elevation: Townscaper's real limit, and the same fix pattern

The owner's own read is correct, and worth stating precisely: Townscaper's
documented "vertical relief" (above) is building-height stacking plus a
marching-cubes-style step resolving the shoreline/waterline boundary between
filled and empty cells — **not** a general sculptable terrain surface. The
base land plane itself does not roll into hills or valleys; what reads as
elevation is floors stacking upward and a stepped edge against water. There
is no true terrain-sculpting system in the reference model. This confirms,
rather than corrects, this document's own earlier research — the owner's
observation just states it more sharply than this document had.

The fix follows the **exact same pattern already designed for interior
generation**: a third tileset category on the same already-Decided
`ghx_proc_gen` engine, not a different tool. A "terrain" block stacks
vertically exactly like a building block, but resolves against a
natural-terrain tileset (grass slopes, rock faces, dirt, stepped cliffs)
instead of an architectural one — the same vertical-layer WFC/marching-cubes
machinery, a different set of tiles. This keeps one unified interaction
model (pick a block type — building, terrain, interior-fixture — and click;
the same engine resolves all three), rather than bolting on a second,
disconnected terrain system. It is also the closer aesthetic match: TaleSpire's
own elevation in this document's reference-games table below ("scroll-wheel
while a tile is picked up, auto-stacking, stepped hex elevation") is the same
discrete-level idea, not smooth heightmap sculpting either.

This **reconciles, rather than discards**, the heightmap-based crates already
chosen (`fast-surface-nets-rs`, `noise-rs`, `block-mesh-rs`): their role
narrows from "the terrain system" to two still-real, narrower jobs:

1. **Seeding the discrete grid** — a heightmap/noise pass proposes a
   starting elevation pattern (where hills, valleys, and water naturally
   sit) before the player touches anything, feeding Tier 0's "great
   default," which then gets **quantized into the same discrete stacked-layer
   grid** the terrain-block tileset builds on, rather than staying a
   separate continuous surface.
2. **Distant background scenery** — land far outside the actual buildable/
   walkable area (mountains on the horizon, a coastline the player will
   never click on) has no reason to pay for per-cell WFC resolution; a
   continuous heightmap mesh remains the right, cheaper tool there, matching
   the deck.gl `TerrainLayer` inspiration noted in the rendering-architecture
   table above (that table's "Real (non-flat) terrain" row now refers
   specifically to this background-scenery use, not the buildable area).

Not yet designed: the actual terrain tileset (tile count, adjacency rules
that produce believable slopes/cliffs rather than blocky staircases) and the
quantization step from a noise/heightmap seed into discrete stacked levels —
recorded as a new open item.

### Physics: collision and grounding only (not a full engine)

The owner explicitly scoped this down: token/object placement needs to
rest at the correct height and not pass through walls — not a full
rigid-body physics simulation (no falling, stacking, or true dynamics).
This matches how even Foundry itself works (no physics engine at all).

**Candidate: [`parry2d`/`parry3d`](https://parry.rs/)** (Dimforge,
**Apache-2.0**) — a collision-detection-**only** library: shape queries,
raycasting, broad/narrow-phase collision, with **no dynamics or forces**
attached. It is the successor to Dimforge's earlier `ncollide`, and shares
its ecosystem with the full **Rapier** physics engine (same team, same
underlying geometry code) — meaning if this project's physics needs ever
grow into real rigid-body dynamics later, there's a same-vendor upgrade
path rather than a vendor switch.

**Why this must run in Rust (`domain-core`), not as a client-side Three.js
`Raycaster` query**: a token's position is authoritative multiplayer state
(per `DEC-016`/section 15 of `GRAFTING_MASTER_SOURCE.md`, already
discussed). If grounding/collision were computed independently on each
player's own Three.js scene, different clients could disagree about where
a token actually ends up — breaking both replay determinism (`DEC-044`)
and the single-authoritative-state model the whole multiplayer
architecture depends on. The pattern: a `MoveToken`-style command carries
an intended position; `domain-core` resolves the actual resulting position
by raycasting against its own authoritative terrain/wall geometry (via
`parry`), and only that resolved position becomes the `DomainEvent` every
client renders — Three.js's own `Raycaster` stays useful client-side for
things that don't need to be authoritative (e.g. hover previews, cursor
picking), but not for resolving where a token actually lands.

This reuses the exact same wall/floor geometry already designed for
vision/LOS blocking (see `docs/research/vtt-rules-and-character-system-options.md`) —
one set of wall segments serves both "blocks sight" and "blocks movement,"
not two separate representations.

**`parry` vs. Three.js's own `Raycaster` — the real difference isn't raw
speed.** Three.js's `Raycaster` is brute-force per-triangle by default,
but the well-known community plugin
[`three-mesh-bvh`](https://github.com/gkjohnson/three-mesh-bvh) (gkjohnson)
adds a Bounding Volume Hierarchy on top and reaches strong performance
(500 rays against an 80,000-polygon mesh at 60fps) — so raw client-side
raycasting speed is a solved problem already, for the client-side purposes
`Raycaster` is actually suited to (hover previews, cursor picking, other
non-authoritative UI queries). The distinction that actually matters here
is architectural, not a speed contest: `Raycaster` queries Three.js's own
rendered scene graph, per client, in JavaScript, with no concept of
authoritative state at all. `parry` is an engine-agnostic Rust geometry
library that can run inside `domain-core` itself — meaning collision and
grounding get exactly **one** authoritative answer every client then
renders, instead of each client computing its own answer that could, in
principle, disagree.

`parry3d`'s own shape vocabulary maps directly onto this project's
geometry: **`HeightField`** (exactly the terrain heightmap already
produced), **`TriMesh`** (arbitrary WFC-generated building/interior
geometry, with its own internal BVH for queries — the same acceleration
idea as `three-mesh-bvh`, just on the Rust/authoritative side), **`Compound`**
shapes (decomposing a complex WFC building mesh into convex parts), and
**`SharedShape`** (reference-counted sharing of one expensive shape — e.g.
one terrain heightfield — across every token colliding against it, rather
than duplicating the shape data per token).

### Water and rivers

A genuinely new topic, in two parts: rendering technique, and procedural
placement.

**Rendering**: Three.js ships this natively — no new dependency. The
official [`Water`](https://threejs.org/docs/pages/Water.html) addon
(`three/addons/objects/Water.js`) provides a reflective water plane for
`WebGLRenderer`; `WaterMesh` is the equivalent for `WebGPURenderer`. More
elaborate effects (foam, caustics, real wave simulation) exist as
community shader examples if ever wanted, but the built-in addon is
sufficient for a first pass — the same "prefer the Three.js-native
technique first" pattern already applied throughout this document (e.g.
`ExtrudeGeometry` for buildings, `Line2` for routes).

**Procedural placement (rivers/lakes on top of the terrain already
designed)**: no mature, focused Rust crate was found for this
specifically. The technique itself is well-documented and doesn't need
one: **flow accumulation / drainage-basin simulation** — water is
simulated flowing downhill across the heightmap via steepest descent,
accumulating volume as it flows and as tributaries merge; a river forms
where accumulated flow crosses a threshold, a lake forms where flow pools
in a basin instead of draining further. Reference technique sources
(concept only, not code to copy — same treatment as Sylves/Townscaper):
[Red Blob Games' "Procedural river drainage basins"](https://www.redblobgames.com/x/1723-procedural-river-growing/)
and [Nick McDonald's "Procedural Hydrology"](https://nickmcd.me/2020/04/15/procedural-hydrology/).
This runs directly on top of this project's own `noise-rs`-generated
heightmap seed (see "Terrain elevation" above) — **before** that seed gets
quantized into the discrete WFC-driven elevation grid, since flow
accumulation needs continuous elevation data to behave correctly; the
resulting water-body mask then carries through into the discrete grid
alongside elevation, the same seeding step already described.

### How the generation pipeline fits together, end to end

Each piece above (buildings, terrain, water) was designed on its own; this
section is the concrete order they run in and how they hand off to each
other, so the whole thing reads as one pipeline rather than separate
ideas. Nothing new is decided here — every step below links back to the
section that actually designed it.

1. **Continuous heightmap seed** — `noise-rs` generates a continuous
   elevation value across the whole map area (see "Procedural-generation
   crates" above). Nothing discrete yet.
2. **Water mask, still on the continuous seed** — flow-accumulation runs
   on that same continuous heightmap (see "Water and rivers" above),
   producing which points are river, lake, or dry land, **before**
   anything gets quantized — the algorithm needs continuous elevation to
   behave correctly.
3. **Quantization into the discrete grid** — the continuous heightmap and
   water mask both get snapped into the discrete stacked-layer grid the
   WFC systems actually operate on (see "Terrain elevation" above); a
   water-marked point becomes a "water" cell instead of a buildable-land
   cell in that same grid.
4. **Terrain WFC pass** — every non-water discrete cell resolves through
   the terrain-block tileset (natural slopes/cliffs/grass — see "Terrain
   elevation") into actual 3D terrain geometry, stacked and stepped per
   that section's design.
5. **Water rendering** — every water-marked cell gets a Three.js `Water`/
   `WaterMesh` plane instead of terrain geometry (see "Water and rivers"),
   at the height the surrounding terrain implies.
6. **Building/exterior WFC pass** — on buildable land cells, the player's
   block placement resolves through the Townscaper-style exterior tileset
   (see "Reference model: Townscaper" and "Guided construction mode"
   above) — a **separate tileset from terrain's**, running on top of
   whatever terrain elevation already resolved at that location.
7. **Interior WFC pass** — for each floor of a resolved building, a
   further pass with an interior-specific tileset resolves room layout and
   furniture (see "Interior generation" above) — again a separate tileset,
   same underlying `ghx_proc_gen` engine.
8. **Manual/freeform layer, on top of everything** — Tier 1 fixed-tile
   pre-placement (pin a specific module before a re-solve) and freeform
   prop placement (see the next section) both sit above every generated
   layer, at any point in this pipeline.

### Who authors each tile module, and can a wall bypass the system?

A question this document had not answered directly: where do the actual
wall/roof/stair/terrain shapes come from? **They are hand-authored 3D
assets** — someone models each module (in a normal 3D tool, exported the
way any game asset would be) and tags it with the socket/adjacency
metadata `ghx_proc_gen` needs to know what can connect to what. This is a
real content-creation task, not something generated automatically — the
same content-creation reality Townscaper's own ~500 hand-crafted modules
represent (see "Platforms, camera modes, and color as a generation input"
above). It connects directly to the still-open "asset pipeline" item in
`docs/research/vtt-product-scope-map.md`'s Content Creation section: the
tileset *is* the asset pipeline's first real deliverable, not a separate
concern.

**Can someone build a wall that doesn't follow the tileset system at
all?** This is a genuine fork, not resolved here — this document's own
reference-games table already contains the precedent for both sides:
**TaleSpire** supports hard-grid structural tiles *and* separately,
freeform (non-gridded) decor props that ignore the grid entirely. That
split maps onto two real options for this project:

- **Option 1 — everything structural is an authored tileset module.** A
  wall is, by definition, a `ghx_proc_gen` module with proper adjacency
  tags. Consistent and predictable (every wall automatically blocks
  vision via the `VisionSource`-style system and blocks movement via
  `parry`, because tileset modules already carry that metadata) but
  limited to whatever shapes have been authored.
- **Option 2 — TaleSpire-style freeform structural props.** A player can
  place any arbitrary mesh as a "wall," entirely bypassing WFC. This is
  more flexible, but the automatic behavior stops: a freeform wall does
  **not** automatically block vision or movement just by looking like a
  wall — someone (a system, or the player) has to manually attach those
  mechanical properties (a collision shape for `parry`, a line segment for
  the vision system), since none of that metadata comes bundled with an
  arbitrary mesh the way it does with an authored tileset module.

Both are real, working patterns (TaleSpire ships exactly this split
today) — which one, or whether both coexist the way TaleSpire's own
structural-tiles-plus-freeform-decor split does, is an open decision for
the owner, not resolved by this document.

### Category + socket tile authoring: the engine cares about connectors, not shape

The owner proposed: define generation **categories** (pillar, wall, roof),
have the engine only care about category and connection points, not a
piece's visual shape/form/length — so a flat, a triangular, and a curved
wall could all be interchangeable "wall" pieces, with the engine
generating combinations from category-level rules rather than needing a
distinct rule per unique mesh.

**This is exactly right, and it isn't a new invention to build from
scratch** — it's the "socket" pattern already cited above:
`ghx_proc_gen`'s own description is literally "socket-based adjacency,"
and Townscaper's own tiles are documented (see "Reference model:
Townscaper" above) as "modular corner pieces that flexibly conform to
irregular grid cells" rather than unique, hardcoded shapes. The owner's
"category" is, concretely, **a group of tiles that all share a compatible
connector (socket) geometry at their connecting edges** — the engine
genuinely does not know or care what a piece "is" (pillar, wall, roof),
only whether one tile's socket on a given face is compatible with the
neighboring tile's socket on the facing side.

**The concrete mechanism, with a physical analogy**: think of Lego bricks.
Any Lego brick connects to any other because the **stud/socket interface
is a fixed, standardized geometry** — even though the bricks themselves
come in wildly different shapes (flat plates, curved slopes, arches). The
standardized connector is what makes them combinable; the rest of the
shape is completely free. A tileset built this way needs a small,
fixed vocabulary of socket types (e.g. "flat-wall-socket," "roof-edge-
socket," "open/void-socket") — every new mesh added to the "wall" category
just needs its connecting edges to match one of those existing socket
geometries; everything else about the mesh (flat, triangular, curved,
tall, short) is free to vary, exactly as the owner described.

**What this eliminates, and what it does not.** Eliminated: authoring a
separate adjacency rule per unique mesh pair (the traditional, laborious
WFC-tileset trap) — a mesh only needs to declare which socket type it
exposes on each face, once, not how it relates to every other individual
mesh. **Still real work**: defining the socket vocabulary itself (a small,
one-time task — a handful of connector types, not hundreds of rules), and
making sure each new mesh's connecting edges actually match its declared
socket's geometry — two pieces both labeled "wall" but with
differently-shaped connecting edges will still show a visible gap or
overlap when placed together, since the category label alone doesn't
guarantee physical fit; the socket geometry is what has to actually agree.

**This also reshapes the earlier structural-vs-freeform fork.** A
well-designed category/socket system delivers a large share of the visual
variety that made TaleSpire-style freeform props (Option 2 above)
appealing — flat, triangular, and curved walls all coexisting — while
staying entirely inside the systematic Option 1 (every piece is a proper
tileset module, so vision-blocking and collision keep coming for free from
its metadata). It doesn't eliminate the fork entirely — a player wanting a
truly one-off shape outside any socket the tileset defines still hits
Option 2's territory — but it substantially narrows how often that
escape hatch is actually needed.

### Reducing V1 modeling work: ready-made CC0 asset packs

The owner asked whether hand-modeling a whole tileset is really necessary
for a first prototype. It isn't, on two fronts:

**The 3D modeling itself doesn't have to start from zero.** Confirmed via
direct license check:

- **[Kenney.nl](https://kenney.nl/assets/modular-buildings)** — "Modular
  Buildings" (100 assets) and "Building Kit" (80 assets), both **CC0**:
  free for commercial and non-commercial use, **no attribution required**,
  low-poly, engine-agnostic (exports to formats any engine including
  Three.js can consume).
- **Kay Lousberg's KayKit** — the Dungeon Pack (fits this project's own
  interior-generation need directly) and the "Prototype Bits" pack
  (explicitly meant for exactly this kind of early blockout), both
  **CC0-equivalent**: free for personal and commercial use, no attribution
  required, the only restriction being not reselling the assets unmodified
  as one's own.

Both match the chunky, stylized, low-poly look already wanted — not
photorealistic — so this isn't just a placeholder aesthetic, it's a
reasonable fit even for a V1. Neither pack comes pre-tagged with the
adjacency/socket metadata `ghx_proc_gen` needs — that tagging work is real
and not eliminated by using ready-made meshes — but modeling the meshes
themselves is the larger of the two tasks, and that part is now optional.

**The tileset itself doesn't need to be nearly as large as Townscaper's
~500 modules.** `ghx_proc_gen`'s own GitHub examples demonstrate real,
varied generative results from a **4-tile** set (a void block, a pillar
base, a pillar core, a pillar top) producing pillars of different heights
and arrangements — direct evidence, from the crate's own authors, that a
V1 tileset of perhaps 10-20 hand-tagged pieces (built from the Kenney/KayKit
meshes above) is enough to produce satisfying results, not hundreds.

**A lower-risk workflow for V1**: `bevy_ghx_proc_gen` (the same crate's
Bevy-engine integration) gives fast visual feedback for iterating on
tileset/adjacency design inside Bevy's own renderer — a separate,
disposable prototyping tool for validating a tileset's adjacency rules
before wiring the finished tileset into this project's real Rust/Isekai/
Three.js pipeline, decoupling "does this tileset produce good results" from
"is it correctly integrated," per the adoption checklist's own
disposable-spike principle below.

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

## Import (Tier 2): Universal VTT (UVTT)

The four-tier construction model's Tier 2 (import existing maps/images) had
no research at all until now. Found: **Universal VTT (UVTT** — also seen as
`.dd2vtt`/`.df2vtt`, the same format under different tool-of-origin
extensions**)**, a JSON-in-image map-interchange format created by
Megasploot (developer of Wonderdraft and Dungeondraft) and widely supported
across *competing commercial* VTTs and map-authoring tools: Foundry,
Fantasy Grounds Unity, Roll20, AboveVTT, Arkenforge, Dungeon Alchemist,
DungeonFog, and BBEG Maps.

Schema (confirmed via
[Arkenforge's own documentation](https://arkenforge.com/universal-vtt-files/)):

- `[Format]` — a decimal version number
- `[Resolution]` — `map_origin` (x/y), `map_size` (x/y, in grid squares),
  `pixels_per_grid`
- `[line_of_sight]` — an array of wall/obstacle line segments (x/y
  coordinates), plus a separate `[objects_line_of_sight]` for
  object-specific blocking geometry
- `[portals]` — position, bounds, rotation (radians), `closed`/
  `freestanding` booleans (doors/windows)
- `[environment]` — `baked_lighting` (boolean), `ambient_light` (hex color)
- `[lights]` — position, range, intensity, color, `shadows` (boolean)
- `[image]` — base64-encoded PNG or WEBP

**Why this matters beyond "importing a picture"**: this schema's
`line_of_sight`/`portals`/`lights` fields map directly onto the
vision/dynamic-lighting mechanism already proposed in
`docs/research/vtt-rules-and-character-system-options.md`'s "Proposed
consolidated agnostic architecture" (a point-source polygon computation
against wall geometry). Supporting UVTT import means a GM-imported map
arrives with **working walls, doors, and lights already annotated** by
whoever built it in Dungeondraft/DungeonFog/etc. — a genuinely interactive
map on day one, not just a flat picture needing to be hand-annotated again.

**Honesty check on openness**: unlike this project's other candidates,
UVTT has **no official public specification document, license, or
governance body** — it is a de facto, community-documented convention
(independently described in near-identical terms by Arkenforge's docs, the
Roll20 wiki, and the Dungeondraft community encyclopedia, which is itself
evidence the field set is a stable, real convention, not a rumor). Parsing
a JSON data-format convention is a different, and generally safer,
situation than reusing someone's copyrighted source code — but this is
recorded honestly as an informal convention, not overclaimed as a governed
open standard.

**Confirmed limitation, not just suspected: UVTT is fundamentally 2D.**
Every coordinate in its schema (`Resolution`'s `map_origin`/`map_size`,
`line_of_sight`'s wall segments, `lights`' and `portals`' positions) is
x/y only — there is no height/elevation field anywhere in the format, and
the image itself is a flat top-down texture. This is inherent to its
origin serving classic top-down 2D VTTs. Concretely, this means:

- Imported walls are 2D lines, not 3D geometry — they need to be
  **extruded** into an actual wall mesh by assigning a height (a sensible
  default, or GM-configurable per scene).
- Imported lights have no Z position — a height needs to be assigned (e.g.
  a default "torch height" above the floor) for them to look believable
  in a genuinely free 3D camera, unlike the fixed top-down view UVTT was
  designed for.
- **Multi-floor buildings are not represented in one file** — each UVTT
  file is exactly one flat floor. This matches how Foundry's own
  community "Levels" module handles multi-story buildings today: stacking
  multiple separate flat Scenes at different simulated elevations, not one
  file with real 3D structure.

**The reconciliation**: this project's own procedural generation already
represents buildings as **stacked 2D layers extruded vertically**
(Townscaper-style, see above) and interiors as **a per-floor WFC pass**
(see "Interior generation" above) — structurally the exact same shape as
"a 2D floor plan plus a rule for turning it into 3D." Rather than building
a separate import-specific data model, an imported UVTT file becomes **one
manually-provided floor layer** in the same stacked-layer structure Tier
0/1 procedural generation already produces (wall segments, floor texture,
lights, and portals together, each layer assigned a height/Z-offset) — a multi-story
import just means importing several UVTT files and assigning each one to
a layer, the same way a WFC-generated building's floors already stack.
This means the renderer and the vision/dynamic-lighting system (both
already designed to consume this per-floor-layer shape) do not need to
know or care whether a given floor was generated, hand-built, or
imported — directly satisfying this document's own opening "Unifying
substrate" principle that all four construction tiers feed the same
underlying model, not four parallel ones.

**One file per floor, or one consolidated file?** This question actually
spans three distinct layers, with a different answer at each:

1. **The import boundary** — necessarily one-file-per-floor, because that
   is how external tools (Dungeondraft, DungeonFog, Foundry's own
   community "Levels" module) already hand us the data. Not a choice this
   project gets to make; it's dictated by the ecosystem being imported
   from.
2. **This project's own authoritative runtime state** — already a single
   unified `Snapshot` with a journal (`DEC-016`, section 15 of
   `GRAFTING_MASTER_SOURCE.md`), not per-entity files. A floor is just an
   entity/region with a Z-offset attribute inside that one state.
   Introducing "one file per floor" at this layer would be a step
   backward from the already-decided single-`Snapshot` architecture, not
   an extension of it.
3. **A future authoring/export/sharing file format** (if GMs are ever
   meant to export or share a building as a portable file, independent of
   the running Snapshot) — here, **one consolidated file per building is
   the better default**, with each floor as an internal item (reusing
   UVTT-shaped per-floor fields for simplicity) rather than N separate
   files plus a manifest. A single file guarantees floor-to-floor
   referential integrity (Z-offsets, stairwell connections, building-wide
   metadata) by construction; N files need a separate manifest kept in
   sync by hand, a real source of drift bugs for no real benefit here
   (unlike the import boundary, nothing forces fragmentation at this
   layer).

So: keep importing one UVTT file per floor because that's how they arrive,
but do not carry that fragmentation into this project's own storage or
sharing format — consolidate there.

## Recommended next practical step

**Done, 2026-08-01.** The Wasm-compile verification spike (open item 6
below) confirmed all four crates — `ghx_proc_gen`, `fast-surface-nets`
(crates.io name for `fast-surface-nets-rs`), `block-mesh` (crates.io name
for `block-mesh-rs`), and `noise` (crates.io name for `noise-rs`) — compile
to `wasm32-unknown-unknown` and produce correct output when instantiated,
via a real (not decorative) call into each crate's own API. See
`docs/benchmarks/vtt-wasm-compile-spike-2026-08-01.md` for full results and
`spikes/vtt-wasm-crate-compile/` for the throwaway crate itself. One real
fix was required (`getrandom`'s `js` feature, a transitive dependency issue,
not a fault in any of the four crates themselves) — everything else compiled
cleanly on the first attempt. This unblocks the next step: promoting a real
subset of this into an actual domain crate wired into
`apps/architecture-studio`'s VTT generation-test surface.

## Follow-up status

1. **`ADR-0008` canvas amendment — resolved 2026-08-04.** ADR-0018/DEC-056
   supersedes its X6-sharing clause. The VTT keeps Three.js as its private real
   renderer through `@grafting/ui`; X6 is retired.
2. **Import format/mechanism (Tier 2)** — Universal VTT (UVTT) identified as
   a strong candidate (see "Import (Tier 2)" above), but not adopted; how it
   reconciles with this project's own free-3D/discrete-elevation terrain
   model is still undesigned.
3. **AI/prompt tool-interface design (Tier 3)** — no design done yet; should
   build on this repository's existing MCP/agent-orchestration research
   (`docs/research/ai-agent-context-and-multi-agent-management-options.md`,
   Part 3), applied to the VTT's map domain instead of Architecture Studio.
4. **`packages/ui`'s component-preview tool** — Storybook was the owner's
   stated visual preference over Ladle/React Cosmos/Bit/Playroom/others
   researched earlier in this session, but never formally confirmed as a
   final pick; recorded here as the leading candidate, not yet decided.
5. **Whether Rete.js is actually built — resolved 2026-08-04.** The owner
   adopted Rete.js as the sole active graph-canvas engine through DEC-056. Its
   current read-only Graph IR use preserves room for later editable procedural
   and orchestration workflows without exposing the engine to consumers.
6. **Wasm-compile verification spike** — **done, 2026-08-01.** All four
   crates compile to `wasm32-unknown-unknown` and were verified via a real
   call into each one's own API, instantiated through `wasm-pack`'s "web"
   target glue in Node (mirroring `spikes/wasm-worker-nextjs`'s rigor; a
   full in-browser-Worker run was not additionally performed since Node
   instantiation of the same wasm-bindgen glue already proves the compiled
   module is correct — only the loading mechanism differs between a Worker
   and Node, and that mechanism itself was already proven separately by the
   Next.js migration's `layout.worker.ts` rewrite). See
   `docs/benchmarks/vtt-wasm-compile-spike-2026-08-01.md`.
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
10. **Terrain-block tileset and heightmap-to-discrete-level quantization are
    proposed, not designed** — see "Terrain elevation" above: the actual
    tile count/adjacency rules for natural slopes/cliffs, and the algorithm
    for turning a noise/heightmap seed into the discrete stacked-layer grid,
    are not yet worked out.

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
