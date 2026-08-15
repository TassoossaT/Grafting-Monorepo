# Research decisions registry

- Status: consolidated index — non-normative, hand-maintained
- Decision authority: none of its own; this file only points at the research
  documents where each candidate's actual reasoning lives. It does not
  approve, adopt, or reject anything on its own
- Purpose: every tool/library ever evaluated across this repository's
  open-source research documents ends up here, one row each, so "what did we
  decide about X" has a single place to check instead of re-reading every
  research document from the top

## How this file stays current

Whenever a `docs/research/*.md` file changes a candidate's status, add or
update that candidate's row here too. A `PostToolUse` hook
(`tools/scripts/research-registry-reminder.mjs`, wired in
`.claude/settings.json`) reminds Claude Code to do this after any edit to a
research document other than this one — it only reminds, it never blocks or
edits anything itself (see `.ai/coordination/PROTOCOL.md`).

Architecture Studio's `/lab` route renders this file directly (parsed by
`apps/architecture-studio/src/research-registry.ts`, no separate generated
copy) as a browsable, filterable catalog. If a status used below is ever
renamed or a genuinely new one is introduced, update the "Status legend"
below and that parser's `STATUS_DEFINITIONS` in the same change — the
parser throws on an unrecognized status rather than silently mis-rendering
it.

## Status legend

- **Adopted** — a real dependency exists in the repository today because of
  this candidate.
- **Decided** — the owner has made a final architectural call on this
  candidate, even if the literal dependency isn't wired into a manifest yet
  (distinct from **Adopted**). Already used by several rows below (React
  Flow, Three.js, `ghx_proc_gen`, `fast-surface-nets-rs`, `noise-rs`) before
  this entry formally documented it.
- **In development** — actively being spiked or built right now, typically
  with a live, interactive trial under Architecture Studio's `/lab` route.
- **In review** — a spike or trial is complete and its results are ready
  for the owner to approve, reject, or send back for more work.
- **Standby (deferred)** — a real candidate, gated behind a stated condition;
  not yet spiked or adopted.
- **Discarded** — evaluated and ruled out (license conflict, wrong shape for
  this repository's actual architecture, viability problem, or a better
  alternative was found).
- **Reference only** — useful as a design or UX pattern to learn from; never
  itself a dependency candidate.

Adopted entries identify dependencies now present in repository manifests;
DEC-056 moved Rete.js into that state on 2026-08-04.

## Architecture Studio: document, canvas, search, tracing

Full reasoning: `docs/research/architecture-studio-open-source-options.md`

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| JSON Canvas | MIT | Standby | Import/export interoperability; after the real read-only Studio slice exists |
| Milkdown | MIT | Standby | WYSIWYG Markdown editing; after the proposal/diff/approval editing lifecycle exists |
| Tantivy | MIT | Standby | Embedded Rust full-text index; the first search spike to actually run |
| OpenTelemetry | Apache-2.0 | Standby | Agent-run evidence contract; early spike candidate |
| OpenInference | Apache-2.0 | Standby | AI-specific semantic conventions over OpenTelemetry |
| gitoxide/gix | MIT OR Apache-2.0 | Standby | When a real Git-history Studio view/query is needed |
| Mermaid | MIT | Standby | Diagrams inside authored Markdown, complements X6 |
| Allure 3 | Apache-2.0 | Standby | Later; ingest native/JUnit/SARIF/LCOV reports first |
| Qdrant | Apache-2.0 | Standby, superseded in preference | Full vector-DB server; keep only if a server deployment is specifically wanted |
| **Zvec** | Apache-2.0 | Standby, **preferred vector-search pick** | In-process embedded vector DB (Alibaba Proxima); no server to operate |
| TurboVec | MIT | Standby, narrower alternative | Rust-native, one compression algorithm (TurboQuant), simpler than Zvec |
| Yrs/Y-CRDT | MIT | Standby | Needs real-time multi-user editing approved first |
| Excalidraw | MIT | Standby | Needs a concrete sketching use case X6 shouldn't serve |
| Tree-sitter | MIT | Standby | Needs a concrete cross-language navigation need existing extractors can't satisfy |
| Node-RED | Apache-2.0 | Standby | Needs the Automation Plane's user-authored executable-flow requirement |
| Backstage Software Catalog | Apache-2.0 project | Reference only | Catalog metadata, docs-like-code, collators, plugin composition |
| Plane Community Edition | AGPL-3.0 | Reference only | Prefer an external connector, never embedded code |
| OpenProject Community Edition | GPL | Reference only | Prefer an external connector, never embedded code |
| Logseq | Copyleft | Reference only | Local-first outlining/backlinks UX reference |
| AppFlowy | AGPL-3.0 | Reference only | Local-first documents/databases UX reference |
| AFFiNE | Mixed, audit required | Reference only | Combined document/canvas/table product reference |
| Arize Phoenix | Elastic License 2.0 | Discarded | Not a strict FOSS core; excluded outright |
| Langfuse | MIT core + open-core areas | Reference only | Optional external backend only after a path-by-path license audit |

## AI agent context management (turning the repo into agent-consumable context)

Full reasoning: `docs/research/ai-agent-context-and-multi-agent-management-options.md`, Part 1

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| Serena | MIT | Standby, **top pick** | This *is* PROV-014, never actually spiked; memory system can be pre-seeded from our generated docs |
| Repomix | MIT | Standby, zero-cost | Packs the repo (incl. our generated docs) into one file; no dependency add needed to try it |
| Kit | MIT | Discarded | No path to inject our own pre-existing docs; Repomix covers the need better |
| gitingest | MIT | Discarded | Redundant with Repomix; maintenance more ambiguous |
| Aider's repo-map | Apache-2.0 | Reference only | Clever tree-sitter+PageRank algorithm, embedded in Aider's CLI, not a reusable library |

## AI agent multi-agent coordination (independent CLI agent sessions)

Full reasoning: `docs/research/ai-agent-context-and-multi-agent-management-options.md`, Part 2

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| Agent-MCP (rinadelph) | **AGPL-3.0** | Discarded | Piloted and working, but license conflicts with a future closed-source sale |
| Claude Squad | **AGPL-3.0** | Discarded | Same license problem as Agent-MCP |
| Task Master AI | **MIT with Commons Clause** | Discarded | Commons Clause forbids selling the software/a substantially-derived product |
| Conductor (conductor.build) | Proprietary | Discarded | Not open source at all |
| Crystal | MIT | Discarded | License fine, but deprecated Feb 2026 |
| Vibe Kanban | Apache-2.0 | Discarded | License fine, but sunsetting per its own README |
| Shrimp Task Manager | MIT | Discarded | No verified locking/claim-arbitration under real concurrency |
| Agent Orchestrator | MIT | Discarded | Different problem (CI/PR automation), not peer-to-peer locking |
| code-conductor | MIT | Discarded | Small, Claude-Code-only, weak anti-collision |
| wit | MIT | Standby, niche | Symbol-level conflict *warnings* via tree-sitter; possible future complement to `affected_paths` |
| CrewAI | MIT core | Discarded | Wrong shape: in-process agent-authoring, not CLI-session coordination |
| AutoGen (microsoft/autogen) | MIT + CC-BY-4.0 | Discarded | Frozen/maintenance mode since Oct 2025 |
| AG2 | Apache-2.0 | Discarded | Wrong shape, same as CrewAI |
| LangGraph (Python) | MIT core | Discarded (for this need) | Wrong shape for CLI coordination; see Part 3 for its TS sibling used differently |
| Camel-AI | Apache-2.0 | Discarded | Wrong shape, same as CrewAI |
| OpenAI Agents SDK | MIT | Discarded | Wrong shape, same as CrewAI |
| mcp-agent (lastmile-ai) | Apache-2.0 | Discarded | Wrong shape (in-process framework); **not the same project as Agent-MCP** despite the near-identical name |
| OpenHands / ACP | MIT core (self-hosted) | Reference only / watch | Only one that spawns Claude Code/Codex/Gemini CLI as subprocesses, but no locking layer |
| **Gas Town** | MIT | Standby, **top pick** | Git-backed issue tracker + work-claim + merge-queue primitives; closest functional match to Agent-MCP without its license risk; not yet piloted |
| **Guild** | Apache-2.0 | Standby, lighter fallback | Smaller MCP server with atomic task-claiming; spike if Gas Town proves too heavy |

## Architecture Studio: MCP-based agent orchestration (a feature to build into the Studio)

Full reasoning: `docs/research/ai-agent-context-and-multi-agent-management-options.md`, Part 3

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | MIT (legacy) / Apache-2.0 (new) | Standby | Foundational low-level MCP client/server plumbing; needed regardless of the higher-level pick |
| Vercel AI SDK MCP client | Apache-2.0 | Standby | Raw tool-calling layer, still `experimental_` |
| **Mastra** | Apache-2.0 core (`ee/` subtree separately licensed) | Standby, **top pick if pursued** | Closest off-the-shelf match to mcp-agent's composable patterns; needs a Node backend |
| LangGraph.js + `@langchain/mcp-adapters` | MIT | Standby | Lower-level, fully DIY graph composition |
| VoltAgent | MIT | Standby, lighter alternative | Supervisor/sub-agent patterns, first-class MCP |
| `@inngest/agent-kit` | MIT/Apache-ish | Standby, not deep-dived | Tied to the Inngest runtime |
| `openai/openai-agents-js` | MIT | Standby, not deep-dived | Assumes a server holds the API key |

Not decided by any research so far: whether Architecture Studio should even
gain a Node-side backend, or be allowed to execute MCP tool calls rather than
only display read-only derived knowledge. That decision precedes the library
choice above.

## Graph/diagram libraries (Architecture Studio code graph, future character webs)

Full reasoning: `docs/research/vtt-map-and-terrain-construction-options.md`

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| React Flow (xyflow) | MIT | Discarded | Earlier top pick superseded by the owner's Rete.js adoption in DEC-056; never installed |
| AntV X6 | MIT | Discarded | Retired from active use by DEC-056; `@grafting/x6-canvas` remains dormant reference code with no consumer |
| JointJS | MPL-2.0 core + paid JointJS+ | Discarded | X6 is a superset of this model with a bigger community and no paid tier |
| maxGraph (draw.io engine) | Apache-2.0 | Discarded | Deepest low-level control and only one with built-in layout, but verbose old-school API and much smaller community than X6 |
| Cytoscape.js | MIT | Discarded | Network-science/analysis oriented (Canvas + fixed style model), weak fit for rich custom nodes |
| GoJS | Commercial | Discarded | Not free |
| **Rete.js** | MIT | **Adopted** | Sole active graph-canvas engine, private inside `@grafting/ui`; consumers use only Grafting-owned canvas elements and contracts (DEC-056) |

## 3D rendering engine package (`@grafting/render-3d`)

Full reasoning: `docs/research/render-3d-engine-libraries.md`; perception/fog
use: `docs/research/vtt-perception-memory-and-fog-of-war.md`

These sit *inside* the engine package and are Three.js-native helpers, not
rival renderers — the one-renderer decision in the VTT map document below is
unaffected by any of them. If adopted, each is confined to
`packages/render-3d/src/backend/` under that package's own `AGENTS.md` and
DEC-049.

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| **three-mesh-bvh** (gkjohnson) | MIT | Standby — first pick for renderer-side spatial acceleration | Accelerates the engine's currently naive `pick()` and supplies `shapecast`, sphere intersection, and distance queries. Canonical perception, line-of-sight, rules, collision, and authorization remain Rust/authority-owned; this candidate may serve renderer picking or non-authoritative preview only unless a later explicit boundary decision says otherwise. Caveats: idiomatic setup mutates `Mesh.prototype.raycast` globally (must be avoided), and dynamic geometry needs measured refit/regeneration |
| **camera-controls** (yomotsu) | MIT | Standby — second pick | Orbit/truck/dolly/zoom/`fitToBox` with damping and collision. The engine has no camera interaction at all today. Chosen over alternatives because `update(delta)` returns whether a redraw is needed and it emits `wake`/`rest`/`sleep` — it already assumes on-demand rendering, which matches the engine's invalidation model instead of fighting it |
| `@three.ez/instanced-mesh` (InstancedMesh2) | MIT | Standby | `InstancedMesh` with per-instance frustum culling, BVH raycasting, LOD, sorting, per-instance visibility/opacity. Would enter as an additional visual kind, not a replacement for the one-object-per-item model. Author's caveat: BVH upkeep is expensive for constantly moving instances, so it suits walls/vegetation/props over active markers |
| `BatchedMesh` | — (three.js core) | Standby | Different geometries sharing one material in a single draw call, where `InstancedMesh` requires one shared geometry. No new dependency; should be reached for before adding any instancing library |
| `MeshSurfaceSampler` | MIT (three.js addon) | Reference only — spike candidate, not adopted | Generic approximately uniform mesh-surface sampling for authorized point silhouettes. Build is `O(n)`, sampling `O(log n)`, and the RNG is replaceable. Any use stays renderer-private; point samples are derived presentation, not persisted knowledge or authority |
| **postprocessing** (pmndrs) | **Zlib** | Standby — needs license review | `OutlineEffect` is the selection highlight a tabletop needs, and the same pass system is where the "dark vision" masking effect belongs. The only non-MIT candidate here; triggers the master source's rule 2.6 license/provenance review and a `THIRD_PARTY_NOTICES.md` entry |
| miniplex / bitECS | MIT | Reference only | Entity-Component-System — the prior art naming what the engine's capability-based decomposition already is. Not adopted: no consumer needs behaviour composition yet, and the repository's rule is that a generic package needs a real consumer. miniplex is the gentle option if that changes (no upfront component declaration, no imposed scheduler) |
| skyloutyr/VTT | MIT | Reference only (product) | C#/.NET, OpenGL 3.3, Windows desktop — no reusable code. Value is as an honest scope marker for a 3D tabletop: dynamic shadows, 3D+2D fog of war, particle editor, node-graph shaders |
| gTove | MIT | Reference only (product) | React/TypeScript web 3D tabletop, the closest web analogue. Key design decision worth copying: fog of war is tied to the grid, so a map with no grid cannot hide anything — a large implementation simplification |
| three-game-engine / the-world-engine.ts / three.gf | MIT | Discarded | Unity-style, **entity-typed**, bring their own scene and loop. Adopting one replaces the capability-based decomposition the owner specified rather than adding to it |

## VTT map, terrain, and rendering

Full reasoning: `docs/research/vtt-map-and-terrain-construction-options.md`

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| Three.js | — | **Decided** | Already a `Closed` rule in `GRAFTING_MASTER_SOURCE.md` for the Web VTT's renderer; not new, this session initially mistook it for new information |
| **deck.gl** | MIT (OpenJS Foundation / vis.gl) | **Reference only — superseded as dependency** | Was briefly decided as a GM-overview dependency, then demoted because Three.js is the sole renderer. `PointCloudLayer` remains the accepted visual/technique reference for authorized remembered silhouettes: explicit positions/normals/colors, circular point sprites, configurable size, and buffer-oriented input; no deck.gl runtime or vendor type enters the product |
| `@deck.gl-community/editable-layers` | Likely MIT (same `visgl` org as deck.gl core; not independently re-verified) | Reference only — superseded | Same reasoning as deck.gl above; the editing UX is now custom work over Three.js's `Raycaster` instead |
| **irregular-quad-grid** | — (own implementation) | **In development** | Townscaper's grid substrate: triangle hexagon → random pairing → Conway ortho → weld → relax. Written from the documented algorithm rather than adapted from any implementation, so no third-party code is carried in. Live trial at `/lab/irregular-grid`; unit-tested for equilateral construction, all-quad output, welding, squareness improvement, consistent winding, and seed determinism. Next stages (stacked-layer elevation, WFC tileset) build on this |
| **stacked-terrain** | — (own implementation) | **In development** | Stage 2: per-cell discrete elevation over the irregular grid. Reuses both existing Rust crates through their real APIs — `generate_heightmap` for the noise seed and `discretize` for the binning, which is why the quantisation is not reimplemented in TypeScript. Elevation attaches to cells, not vertices, so neighbours at different levels meet at a hard vertical step; smoothing those steps with Townscaper's ~15-shape marching-cubes set is a later stage, not a defect of this one. Live trial at `/lab/stacked-terrain` |
| **terrain-transitions** | — (own implementation) | **In development** | Stage 3: smooth the steps stage 2 leaves. The change that does the work is the model, not the mesher — occupancy moves from cells to **corner columns**, where a corner takes the highest level of the cells meeting at it, so the surface crosses a step diagonally instead of squarely. Extracted with marching **tetrahedra**, deliberately not marching cubes: a tetrahedron has sixteen corner states derivable in a few lines, whereas marching cubes needs its 256-row triangle table and the widely-copied versions of that table carry no clear licence (same ground on which `hexagrid-relaxing` and `irregular_quads` were discarded below). Prisms are split with their columns sorted by global vertex index, which is what makes neighbouring cells agree on the diagonal of the face they share — a fixed local split cracks along some seams. Live trial at `/lab/terrain-transitions`, with a toggle back to stage 2 for comparison. Townscaper's ~15 hand-authored shapes remain the art layer over this model, not a replacement for it |
| **terrain-tileset** | — (own implementation) | **In development** | Stage 4: choose a module per cell under socket constraints, using `grafting-procgen-tileset-wfc` over the stacked irregular grid. A cell is a quad *and* a layer, and its six faces are the quad’s four edge slots plus up and down — only the four lateral ones take part in the rotation cycle, so a module turns about the vertical axis and never lands on its side. Orientations are generated rather than authored: symmetry is detected from the sockets, so a flat top yields one variant and a ramp four, and a module’s weight is shared across the variants it produced so an asymmetric piece does not become more common merely for being asymmetric. The tileset itself is **content, not crate** — it lives in the consumer and is editable live at `/lab/terrain-tileset`, where sockets, weights and socket compatibility can be changed and re-solved on the real grid. Sockets are authored rather than derived from the corner heights, deliberately: deriving them would make every tileset trivially consistent and remove the thing worth experimenting with, so the composer flags a face whose socket disagrees with its geometry and then leaves it alone |
| **sketchpunklabs/irregular_grid** | MIT | Reference only | The one usable code reference for this technique — JS + Three.js, half-edge structure, grid generation *and* marching-cubes meshing, so it also covers the later elevation stage. Not copied from; if any of it is adapted later it needs the `THIRD_PARTY_NOTICES.md` marker per `PROTOCOL.md` rule 4 |
| kchapelier/hexagrid-relaxing | **NO LICENSE** | **Discarded** | JS port of Cedric Guillemet's implementation of the same technique, and the top search result for it — but the repository has no license, so it is all-rights-reserved and cannot be used or adapted, only read. Recorded because its prominence makes it the obvious thing to reach for |
| hoganmas/irregular_quads | **NO LICENSE** | **Discarded** | Same reason: no license, therefore unusable regardless of being public |
| LouisAndreN/organic-grid-townscaper | MIT | Reference only | Python implementation of the same grid; usable license, but small and less complete than sketchpunklabs' |
| **Sylves** (BorisTheBrave) | MIT | Reference only (concept) | C#, not usable as a Rust dependency (DEC-001) — a uniform multi-grid-topology abstraction (hex/square/triangular), directly documented against Townscaper's own grid; concept reference for letting a configuration grid not limit the generated output's shape |
| `Tile3DLayer` | MIT (part of deck.gl) | Discarded for this use | Bound to the OGC 3D Tiles/ESRI I3S standard (real-provider formats); the generic `TileLayer` + `SimpleMeshLayer`/`ScenegraphLayer` underneath are the reusable pieces for custom procedural streaming |
| MapLibre GL JS | BSD-style (via GeoLibre) | Discarded for GM-overview role | Superseded once deck.gl's building-extrusion/flow-visualization matched the owner's actual visual reference more precisely |
| GeoLibre (whole platform) | MIT | Discarded | Real-world GIS analysis platform (SQL geoprocessing, satellite imagery, planetary basemaps) — wrong domain for fantasy map construction |
| Tauri (pulled from GeoLibre) | MIT/Apache-2.0 | Standby | Relevant to the still-open `GATE-002`/`GATE-003` Desktop client question, not decided; would reuse the same web frontend on desktop |
| Turf.js (pulled from GeoLibre) | MIT | Standby | Lightweight spatial math (distance, buffer, area) — useful for VTT distance/AoE/line-of-sight independent of any GIS framework |
| `ghx_proc_gen` | Dual MIT/Apache-2.0 | Standby (deferred), superseded for the irregular grid | 3D Wave Function Collapse/Model Synthesis, Rust, matches the Townscaper-style generation model chosen as the reference; the crate's own examples show real results from as few as 4 tiles, evidence a V1 tileset can be small. `wasm32-unknown-unknown` compile + `wasm-pack`/Node-instantiation verified 2026-08-01 (`docs/benchmarks/vtt-wasm-compile-spike-2026-08-01.md`) — a real `CartesianGrid` call, not just an unused dependency | **Superseded 2026-08-08 for the terrain pass**: its AC-4 requires that the neighbour of `n` in direction `d` has `n` as its neighbour in `opposite(d)`, with globally fixed direction indices. Our irregular quad grid admits no such labelling — measured at 58–93 irreducible contradictions per grid against zero on a regular control. A workable encoding exists (directions as ordered face pairs), but 0.8.0 exposes no public way to build `Rules` for a caller-defined coordinate system (`RulesBuilder`'s fields and `Rules::new` are private), so adoption would need an upstream change or a fork. `wave-function-collapse` was chosen instead. Remains a real candidate if that constructor is ever exposed upstream — the `tileset-wfc` crate's solver seam is built so switching back is one adapter module
| `wave-function-collapse` (AustinHeller) | Dual MIT/Apache-2.0 | **Adopted**, `wasm32` verified | The terrain/tileset constraint solver, behind our own `ConstraintSolver` seam in `libs/domains/procgen/tileset-wfc`. Chosen over `ghx_proc_gen` because it declares constraints per neighbour pair with no direction concept at all, so an irregular quad grid is native rather than worked around. Measured before adoption 2026-08-08: seeded determinism (`random_seed: Option<u64>`), variation across seeds, contradictions returned as `Result<_, String>`, compiles to `wasm32-unknown-unknown` given `uuid`'s `js` feature, ~7 ms for 225 cells. Known costs: proving unsatisfiability is not time-bounded (a complete 6-cell/3-module graph took over 7 minutes), and it supplies no socket/rotation machinery — that layer is ours |
| `kahuna` | Dual MIT/Apache-2.0 | Discarded | The cleanest topological fit of the WFC crates surveyed — its `Space` trait lets the caller define coordinate deltas with no `opposite()` requirement. Ruled out on determinism: `collapse()` draws from `thread_rng()` with no seed injection, and the map is replicated authoritative state two hosts must generate identically. Also unmaintained since May 2022 and reports no contradictions |
| `billow` | **GPL-3.0** | Discarded | WFC implementation ruled out on licence alone, consistent with this repository's other GPL exclusions |
| `bevy_ghx_proc_gen` | Dual MIT/Apache-2.0 (same crate family) | Standby, prototyping tool only | The same crate's Bevy integration — a disposable, fast-feedback tool for iterating on tileset/adjacency design, not proposed as a project dependency |
| Kenney.nl "Modular Buildings" / "Building Kit" | **CC0** | Standby, leading V1 asset candidate | 100 + 80 low-poly assets respectively, free for commercial use, no attribution required — reduces V1 tile-modeling work; still needs adjacency/socket tagging for `ghx_proc_gen`, which no ready-made pack provides |
| Kay Lousberg's KayKit (Dungeon Pack, Prototype Bits, others) | **CC0-equivalent** (no resale of unmodified assets) | Standby, leading V1 asset candidate | Dungeon Pack fits this project's interior-generation need directly; Prototype Bits is explicitly meant for this kind of early blockout |
| `fast-surface-nets-rs` | MIT OR Apache-2.0 | **Decided**, narrowed role, `wasm32` verified | Confirmed Townscaper itself has no true terrain sculpting (building-height stacking + shoreline stepping only); the buildable area's own elevation now uses a discrete WFC terrain-block tileset on `ghx_proc_gen` instead. This crate's role narrows to (1) seeding a heightmap that gets quantized into that discrete grid, and (2) rendering distant background scenery outside the buildable area. `wasm32-unknown-unknown` compile + `wasm-pack`/Node-instantiation verified 2026-08-01 (`docs/benchmarks/vtt-wasm-compile-spike-2026-08-01.md`) via a real `surface_nets` call over a sphere SDF |
| `block-mesh-rs` | MIT OR Apache-2.0 | Standby, blocky alternative, `wasm32` verified | Same narrowed role as `fast-surface-nets-rs` above if a blockier background-scenery look is wanted instead. `wasm32-unknown-unknown` compile + `wasm-pack`/Node-instantiation verified 2026-08-01 (`docs/benchmarks/vtt-wasm-compile-spike-2026-08-01.md`) via a real `greedy_quads` call over a solid cube |
| `fidget` (mkeeter) | **MPL-2.0** | Standby — leading implicit-surface candidate, licence and determinism unverified | Implicit-surface kernel: expression graphs, tape simplification by interval evaluation, a JIT on `x86_64`/`aarch64`, and Manifold Dual Contouring meshing. Its README lists `wasm32-unknown-unknown` as **Tier 1, CI-checked, no JIT** (interpreter fallback), and it ships a web-editor demo — the configuration this repository actually needs. 0.5.0, ~43.7k downloads, updated 2026-08-03. Two things must be settled before adoption: MPL-2.0 is *file-level* copyleft (fine to link into a closed-source product, but changes to fidget's own files must be published — an owner call under `GATE-008`), and **whether its JIT and interpreter agree bit for bit**, which `DEC-016`/`ADR-0004` replication requires and which nobody has measured. See `docs/research/vtt-massing-and-procedural-detail-options.md` |
| `csgrs` | MIT | Standby — candidate for boolean detail over a massing model | Constructive solid geometry on meshes via BSP trees, OpenSCAD-like surface; an explicit `wasm` feature provides browser wrappers, and `default-features = false` allows a smaller build. 0.20.1+, ~40.5k downloads, updated 2025-07. Fits carving windows, doors and arches out of a blockout without leaving mesh-land, so it complements rather than competes with an implicit kernel. Unmeasured here: performance at map scale, and determinism |
| `crater-rs` | MIT | Standby — weaker third option | N-dimensional geometry with procedural modelling and marching-cubes extraction from implicit fields. 0.8.0, ~15.3k downloads. Less proven than `fidget` or `csgrs`, and its `wasm32` support was **not** verified |
| **ShapeML** (Stefan Lienhard) | **GPLv3** | **Discarded as a dependency**, reference only (concept) | The closest open-source CGA/CityEngine-like framework found — grammar parser/interpreter plus an interactive preview app, inspired by shape grammars, L-systems and CGA. GPLv3 reaches the whole product, which the owner's closed-source-sale goal cannot accept, so it joins Sylves and Foundry core patterns as a documented-concept reference rather than code. Same treatment, same reason class as the licence-based discards below |
| CGA shape / CityEngine (Müller, Wonka et al., SIGGRAPH 2006) | Proprietary (Esri) | Reference only (concept) | The canonical massing-then-refinement architecture the owner independently proposed. Studied for its published *failure modes*, which land on this project's stated requirement: split grammars enforce grid-like structure, need excessive splits for complex mass models, resist changes to the mass model, and are weakest on curved/organic facades. Documented mitigations — layered shape grammars, depth layers, and inverse procedural modelling (deriving rules from examples rather than authoring them) — are the parts worth borrowing |
| `noise-rs` | Dual MIT/Apache-2.0 | **Decided**, narrowed role, `wasm32` verified | Base noise feeding the (now narrower) heightmap-seed and background-scenery role of the meshing crates above. `wasm32-unknown-unknown` compile + `wasm-pack`/Node-instantiation verified 2026-08-01 (`docs/benchmarks/vtt-wasm-compile-spike-2026-08-01.md`) via a real `Perlin` sample call; required adding `getrandom`'s `js` feature explicitly (a transitive dependency via `rand`, undetected until the actual `wasm32` build) |
| Interior/room generation (WFC + BSP, `path constraint`, `fixed tiles`) | — (design pattern, not a dependency) | Standby — proposed, not implemented | Confirmed Townscaper itself has no interior generation; closing that gap reuses the already-`Decided` `ghx_proc_gen` with a second interior-specific tileset/pass, not a new crate — see `docs/research/vtt-map-and-terrain-construction-options.md`'s "Interior generation" section |
| `parry2d`/`parry3d` (Dimforge) | Apache-2.0 | Standby, leading candidate | Collision-detection-only (raycasting/shape queries, no dynamics) — matches the owner's explicit "collision/grounding only, not a full physics engine" scope; same ecosystem as the full Rapier engine if that scope ever changes |
| Three.js `Water`/`WaterMesh` addon | Same as Three.js core (MIT) | Standby, leading candidate | Built into Three.js's own addons — no new dependency; reflective water plane for `WebGLRenderer`/`WebGPURenderer` respectively |
| Flow accumulation / drainage-basin technique (Red Blob Games, Nick McDonald) | — (technique reference, not a dependency) | Reference only (concept) | Well-documented procedural river/lake placement technique, implementable directly on the already-chosen `noise-rs` heightmap seed — no crate found or needed |
| `dominguerilla/wfc-dun-gen` | Unverified | Reference only — unverified | Found via search as a WFC dungeon-generation project; language/license/API not confirmed in this pass (README fetch failed) — not adopted or license-cleared |
| Universal VTT (UVTT / `.dd2vtt`/`.df2vtt`) | No formal license — de facto community convention | Standby, leading Tier 2 import candidate | JSON-in-image map format (walls/portals/lights) widely supported across Foundry/Fantasy Grounds/Roll20/AboveVTT/Arkenforge; its wall/light/portal schema maps directly onto this project's own proposed vision/dynamic-lighting mechanism; no official spec/license/governance, recorded honestly rather than treated as a governed standard |
| `building-blocks` | MIT/Apache-2.0 dual | Discarded | Archived/unmaintained; superseded by `block-mesh-rs`/`fast-surface-nets-rs` |
| Godot Voxel module | MIT | Reference only | Tightly coupled to Godot 4; study the generator-graph/editing-layer design, don't depend on it |
| Veloren | **GPL-3.0** | Reference only, code reuse excluded | Copyleft — architecture/algorithm reference only, per this repository's standing policy |
| Voxelis | Dual MIT/Apache-2.0 | Standby | Smaller/newer sparse voxel octree DAG; license-clean fallback for the manual-editing/storage layer |
| Houdini | Commercial | Discarded | Ruled out as embeddable tech; UX-paradigm reference only |
| Blender Geometry Nodes | GPL | Reference only | Same standing GPL policy as Veloren — inspiration for the node-graph paradigm, never embeddable |
| Babylon.js NodeGeometry | Apache-2.0 | Discarded | Conceptually closest "geometry nodes on the web," but JS-side logic conflicts with DEC-001 (Rust owns logic) |
| Graphite | Apache-2.0 | Reference only | Closest architectural example of "Rust core + web node-graph editor," but 2D vector/compositing, not 3D geometry |

No genuinely open-source, Houdini-equivalent, Rust-backed node-graph engine
for 3D procedural generation exists today — recorded as a real gap, not an
oversight, per `docs/research/vtt-map-and-terrain-construction-options.md`.

## VTT roof generation (straight skeleton, E7.7 gate)

Full reasoning: `docs/research/vtt-roof-straight-skeleton-options.md`

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| `straight-skeleton` (lizelive, crates.io) | **GPL-2.0-or-later** | Discarded | Copyleft, breaks with every other dependency in this repository's `Cargo.toml`s being MIT/Apache-2.0; also immature (v0.2.1, 79 downloads, published 2026-07-17) and works on integer coordinates, not this app's `f32` world positions |
| `sfcgal` (Rust bindings to SFCGAL/CGAL) | MIT/Apache-2.0 binding, but links LGPL-2.0+/LGPL-3.0+ (SFCGAL/CGAL `Straight_skeleton_2`) | Discarded | License itself is workable (LGPL linking doesn't force this project LGPL), but CGAL is a large C++/GMP/MPFR kernel not designed for `wasm32-unknown-unknown` — every existing WASM crate here (`construction-wasm`, `generation-wasm`, etc.) uses that pure-Rust target; adopting this needs a second, C++-based WASM toolchain this repository does not have |
| `vHawk/straight-skeleton` (npm, TS wrapper over CGAL-via-Emscripten) | MIT wrapper bundling CGAL's own license terms | Discarded | Not a Rust crate; also puts roof geometry in the app's JS layer, the opposite direction of this project's standing "no calculations in .ts" preference |
| `geo-buf` (GeoRust ecosystem) | Apache-2.0 | Discarded, reference only | License-clean and pure Rust (should target `wasm32-unknown-unknown` fine), but its public API only returns a buffered/inset polygon — never exposes the skeleton's ridge/hip edges a roof mesh actually needs. Low maturity (0 stars, single maintainer, fork of an abandoned crate). Legitimate algorithm reference while hand-rolling, given its permissive license |
| Hand-rolled event-based straight skeleton (Felkel/Obdržálek algorithm), simple-polygon scope only | — (own implementation) | Standby — recommended, not yet built | No license-clean, WASM-viable, API-complete third-party option exists for this project's actual constraints — matches the already-established pattern of `terrain-generation`/`structure-generation`/`surface-mesh` being hand-rolled procedural geometry rather than third-party dependencies. Proposed as a new `libs/domains/procgen/roof-generation` crate; v1 scope is a single simple polygon (no holes), one uniform pitch, hip roof only |

## VTT board foundation and camera navigation

Full reasoning: `docs/research/vtt-board-navigation-and-open-source-editor-candidates.md`

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| SketchForge-3D (Formsmith746) | **AGPLv3** | **Discarded** as a code/dependency source | Active (844 stars, pushed 2026-08-10), Next.js/React/TS/Three.js/Manifold CAD-style solid modeler — a real, well-built tool, but AGPL's network-copyleft clause is incompatible with this repository's licensing posture, and its domain (mechanical CAD parts) has little to do with VTT construction semantics anyway. Its ground-plane/grid and camera-controls *pattern* (bounded grid geometry + stock Three.js `OrbitControls`) is a useful reference to reimplement independently, not to port from |
| Three.js bundled `OrbitControls` | MIT (ships inside the already-installed `three` package) | Reference only | Confirmed the installed `three@0.182.0` already includes `zoomToCursor` and `enableDamping` — exactly this repo's two missing camera behaviors, available for free. Not adopted directly because `packages/render-3d/src/camera/orbit.ts` deliberately keeps all `THREE.Camera`-shaped types out of its public boundary (`VTT-ARCH-002`); reimplementing the same math by hand (already ~90% done in `orbit.ts`) preserves that seam instead of reintroducing a Three.js-coupled controls object into the consumer |
| `camera-controls` (yomotsu) | MIT | Reference only | Damped orbit/pan/dolly with `dollyToCursor`, actively maintained (2,423 stars). Same boundary concern as stock `OrbitControls`, and heavier (a full external state machine) for gaps that are small, well-understood math already mostly implemented by hand in this repo |
| PlayCanvas Editor | Engine is MIT; Editor is hosted/closed | Discarded | Not actually open source as an editor — only the PlayCanvas Engine runtime is |
| Three.js official editor (`mrdoob/three.js/editor`) | MIT | Reference only | Scene-graph/gizmo/outliner UI precedent for Epic 7's construction-editor foundation (E7.1); an application, not a package — nothing to depend on |
| Babylon.js Inspector/gizmo system | Apache-2.0 | Reference only | A different engine entirely; adopting anything means evaluating a full Three.js → Babylon.js swap, out of scope |
| Infinite-grid ground shader technique | N/A — technique, not a library | Reference only (concept) | A camera-anchored fullscreen-quad fragment shader fading grid lines by distance; small enough (~100 lines) to write directly inside `packages/render-3d`'s Three backend with no dependency or license question, if an unbounded board is wanted over a bounded one |

## Component preview tooling (`packages/ui`, shared across apps)

Full reasoning: discussed in conversation 2026-07-31; not (yet) captured in a
dedicated `docs/research/*.md` file.

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| **Storybook** | MIT | Standby, owner's stated preference | v9 (2025) addressed the historical bloat complaint; richest addon/controls ecosystem of the candidates found |
| Ladle | MIT | Discarded | Lighter/faster, but owner preferred Storybook's visual polish |
| Bit | Apache-2.0 core (separate paid cloud layer) | Discarded | Most visually rich, but wants to own the whole build pipeline — disproportionate cost just for a nicer preview |
| React Cosmos | MIT | Discarded | Reasonable middle ground, not chosen |
| Playroom (SEEK) | MIT | Discarded | Different niche (live JSX scratchpad across themes/breakpoints), not a persistent component catalog |
| React Styleguidist | MIT | Discarded | Maintenance slowing, hard-wired to Webpack, no Vite support |
| Docusaurus + `theme-live-codeblock` | MIT | Reference only | Better fit for a future documentation-viewer feature, not component/props testing |
| Histoire | MIT | Discarded | Vue/Svelte-first, no React support |
| Docz | — | Discarded | Archived (dead), Nov 2025 |
| Backlight.dev | — | Discarded | Shut down, Jun 2025 |
| Gardenjs | MIT | Discarded | Real but tiny (~44 stars), too niche to depend on |

Not yet formally confirmed by the owner as a final pick — recorded as the
leading candidate, not a decision.

## VTT rules and character system

Full reasoning: `docs/research/vtt-rules-and-character-system-options.md`

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| `ndm` | Dual MIT/Apache-2.0 | Standby, leading candidate | Dice-notation parsing, actively maintained (last release 2026-01-23), supports keep/drop; actual rolling should still use `domain-core`'s existing `DeterministicRng`, not the crate's own RNG, to preserve replay determinism |
| `dice-parser` (marcell-ziegler) | **GPL-3.0** | Reference only, code reuse excluded | Same standing copyleft policy as Veloren/Blender Geometry Nodes — its `Keep::Highest()` API shape is worth studying, not copying |
| `dice-command-parser`, `dices`, `dndice`, `dice_forge`, `rust-dice`, `lib_dice` | Not verified | Reference only — unverified | Found via search, not evaluated in depth |
| `hecs` | Dual MIT/Apache-2.0 | Standby | Minimalist, embeddable ECS — candidate for flexible/system-agnostic character-entity data modeling |
| `specs` | Dual Apache-2.0/MIT | Standby | Classic, mature ECS alternative to `hecs` |
| Bevy ECS | Dual Apache-2.0/MIT | Standby, heavier | Usable standalone, but its natural home is the full Bevy engine |
| `legion` | Dual MIT/Apache-2.0 | Discarded | Unmaintained (its home, Amethyst, is also unmaintained) |
| **PlanarAlly** (Kruptein) | MIT (confirmed from its `LICENSE` file) | Reference only | Real production VTT; system-agnostic by design; its own "Visibility" triangulation module for dynamic lighting is complex enough that its maintainers want to port it to Wasm themselves — independent validation of this project's Isekai/Wasm direction; MIT means its algorithms are legitimate candidates for close study/porting via the third-party-attribution system if actually copied |
| Foundry VTT | Commercial/proprietary EULA (confirmed) | Reference only — benchmark, not a code source | Source (where licensed at all) remains Foundry's sole property; reverse engineering prohibited — correctly treated throughout this planning process as the feature/UX bar to beat, never a dependency |
| Vassal | **LGPLv2+** (confirmed) | Discarded for this use | Board/card-game engine, not TTRPG-character-sheet-focused; copyleft regardless |
| MapTool (RPTools), Rolisteam | Believed GPL/LGPL, **not independently re-verified** | Reference only — unverified license | Well-known long-running open-source VTTs; verify precisely before treating as more than a UX reference |
| Ogres, Cauldron VTT, Open-VTT (Khazlor) | Not verified | Reference only — unverified | Found via search, not evaluated in depth; note a name collision exists between the Cauldron VTT project and an unrelated `dequelabs/cauldron` UI library |
| Foundry `dnd5e` system | Code MIT, content CC-BY-4.0 | Reference only — genuinely safe combination | Both axes (code + game content) are conventional, attribution-only open licenses; the cleanest real example of a reusable Foundry system found |
| Foundry `pf2e` system | Code Apache-2.0, content under a Foundry Gaming LLC/Paizo partnership | Reference only — content licensing unverified for third-party reuse | Code license is clean; the content permission is specific to that partnership and may not transfer — verify directly against Paizo's own OGL/CUP terms before relying on its content |
| Foundry GURPS community systems (e.g. `crnormand/gurps`) | Steve Jackson Games Online Policy (personal use only) | Discarded for content reuse | **Not a real open-source license** — corrects an initial owner assumption that "free on GitHub" meant safe to reuse; risky for a closed-source commercial product |
| Foundry core patterns (Active Effects, Combat/Combatant, DataModel/`template.json`, VisionSource) | N/A — documented API concepts, not code (Foundry core itself is proprietary) | Reference only (concept) | Same treatment as Sylves/Townscaper: safe to study the documented pattern and reimplement fresh in Rust; no code or copyrighted content is touched, so no third-party-attribution entry is needed |
