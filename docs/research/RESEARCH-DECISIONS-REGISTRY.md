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

## Status legend

- **Adopted** — a real dependency exists in the repository today because of
  this candidate.
- **Standby (deferred)** — a real candidate, gated behind a stated condition;
  not yet spiked or adopted.
- **Discarded** — evaluated and ruled out (license conflict, wrong shape for
  this repository's actual architecture, viability problem, or a better
  alternative was found).
- **Reference only** — useful as a design or UX pattern to learn from; never
  itself a dependency candidate.

As of this writing, nothing below is **Adopted** — every research document in
this repository is still in the planning-phase candidate-catalog stage. That
is expected, not a gap.

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
| **React Flow (xyflow)** | MIT | **Decided, top pick** | Symmetric `nodeTypes`/`edgeTypes` (both first-class React components) — X6 cannot do this for edges, confirmed via its own official docs (`x6-react-shape` is node-only by design) |
| AntV X6 | MIT | Decided — Architecture-Studio-only, dropped from the VTT | Real remaining advantages (shared SVG document, raw SVG port attrs already built, first-party layout, higher perf ceiling) don't outweigh the node/edge symmetry requirement; still valid for Architecture Studio's existing `packages/x6-canvas` |
| JointJS | MPL-2.0 core + paid JointJS+ | Discarded | X6 is a superset of this model with a bigger community and no paid tier |
| maxGraph (draw.io engine) | Apache-2.0 | Discarded | Deepest low-level control and only one with built-in layout, but verbose old-school API and much smaller community than X6 |
| Cytoscape.js | MIT | Discarded | Network-science/analysis oriented (Canvas + fixed style model), weak fit for rich custom nodes |
| GoJS | Commercial | Discarded | Not free |
| **Rete.js** | MIT | Standby, conditional | Wrong category for a static graph (it's an editor *framework* with real execution semantics, not a diagramming library) — the right tool only if a genuinely editable/executing pipeline is built: most concretely, a visual editor for the procedural-generation crates below. Has a real, verified 3D mode (`rete-area-3d-plugin`, built on Three.js) |

## VTT map, terrain, and rendering

Full reasoning: `docs/research/vtt-map-and-terrain-construction-options.md`

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| Three.js | — | **Decided** | Already a `Closed` rule in `GRAFTING_MASTER_SOURCE.md` for the Web VTT's renderer; not new, this session initially mistook it for new information |
| **deck.gl** | MIT (OpenJS Foundation / vis.gl) | **Decided, GM-overview view** | Building extrusion, real (non-flat) terrain via `TerrainLayer`+`TerrainExtension`, route/flow via `TripsLayer`/`ArcLayer`, density via `HexagonLayer`, free 3D camera via `OrbitView` |
| `@deck.gl-community/editable-layers` | Likely MIT (same `visgl` org as deck.gl core; not independently re-verified) | **Decided, route/polygon editing** | Actively-maintained successor to Uber's unmaintained `nebula.gl` |
| `Tile3DLayer` | MIT (part of deck.gl) | Discarded for this use | Bound to the OGC 3D Tiles/ESRI I3S standard (real-provider formats); the generic `TileLayer` + `SimpleMeshLayer`/`ScenegraphLayer` underneath are the reusable pieces for custom procedural streaming |
| MapLibre GL JS | BSD-style (via GeoLibre) | Discarded for GM-overview role | Superseded once deck.gl's building-extrusion/flow-visualization matched the owner's actual visual reference more precisely |
| GeoLibre (whole platform) | MIT | Discarded | Real-world GIS analysis platform (SQL geoprocessing, satellite imagery, planetary basemaps) — wrong domain for fantasy map construction |
| Tauri (pulled from GeoLibre) | MIT/Apache-2.0 | Standby | Relevant to the still-open `GATE-002`/`GATE-003` Desktop client question, not decided; would reuse the same web frontend on desktop |
| Turf.js (pulled from GeoLibre) | MIT | Standby | Lightweight spatial math (distance, buffer, area) — useful for VTT distance/AoE/line-of-sight independent of any GIS framework |
| `ghx_proc_gen` | Dual MIT/Apache-2.0 | **Decided** | 3D Wave Function Collapse/Model Synthesis, Rust, matches the Townscaper-style generation model chosen as the reference |
| `fast-surface-nets-rs` | MIT OR Apache-2.0 | **Decided** | Smooth/organic terrain meshing |
| `block-mesh-rs` | MIT OR Apache-2.0 | Standby, blocky alternative | Alternative to `fast-surface-nets-rs` if a blockier look is wanted instead |
| `noise-rs` | Dual MIT/Apache-2.0 | **Decided** | Base noise feeding the meshing crates |
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
