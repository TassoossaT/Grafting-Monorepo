# VTT product scope map: what's decided, what's open, what's untouched

- Research date: 2026-08-01
- Status: this is a **coverage map**, not a new research pass. It indexes
  what other conversations/documents already settled and flags, honestly,
  what has not been touched at all — so the next round of design work can be
  chosen deliberately instead of discovering gaps ad hoc. Most cells below
  are **Open** or **Not discussed**; that is the expected, correct state of
  a product still fully in its planning phase, not a defect in this map
- Decision authority: none, same as every document in `docs/research/`
- Scope: the full product surface of the VTT (`apps/vtt`, not yet
  scaffolded), cross-referencing
  `docs/research/vtt-map-and-terrain-construction-options.md` for map/terrain
  detail rather than duplicating it, and noting which pieces are VTT-specific
  versus already designed to be reusable elsewhere in the monorepo, per the
  owner's own stated goal of building components that serve other future
  products too (e.g. the route-optimization app idea raised earlier in this
  planning process)

## Legend

| Status | Meaning |
| --- | --- |
| **Decided** | A real conversation decision exists; still needs ADR/task follow-through before it governs the repository |
| **Standby** | Researched, a direction is leaning one way, not committed |
| **Open** | Identified as a real need; no research done yet |
| **Not discussed** | Has not been raised at all in this planning process |

## 1. Map & World

Covered in depth in `docs/research/vtt-map-and-terrain-construction-options.md`
— this section only indexes it, it does not repeat it.

| Topic | Status |
| --- | --- |
| Rendering architecture (Three.js, free camera) | **Decided** |
| Four-tier construction model (default / manual / import / AI) | Tiers 0–1 **Standby**, Tiers 2–3 **Open** |
| Exterior generation (Townscaper-style WFC) | **Standby** |
| Interior generation (WFC + BSP, path constraint) | **Standby** — proposed pattern, tileset undesigned |
| Terrain elevation (WFC terrain-block tileset) | **Standby** — proposed pattern, tileset undesigned |
| Grid/topology configuration (Sylves concept) | Reference only |
| Import format/mechanism (Tier 2) | **Standby** — Universal VTT (UVTT) identified as a strong candidate; reconciling it with this project's own free-3D/discrete-elevation terrain model is undesigned |
| AI/prompt map creation and editing (Tier 3) | **Open** |
| Fog of war / vision blocking by walls | **Standby** — a `VisionSource`-style point-source polygon computation against wall geometry is proposed in `docs/research/vtt-rules-and-character-system-options.md`, informed by PlanarAlly's (MIT) own hand-rolled visibility module |
| Light sources (visual illumination — distinct from vision-blocking above) | **Standby** — Three.js's native lighting (`DirectionalLight`/`PointLight`/`AmbientLight`, shadow maps) is the rendering mechanism; how light sources get placed procedurally (e.g. as a taggable WFC tileset output) is not yet designed |
| Water and rivers | **Standby** — Three.js's native `Water`/`WaterMesh` addon for rendering; flow-accumulation/drainage-basin technique for procedural river/lake placement on the existing heightmap seed, see the map document's "Water and rivers" section |
| Physics: collision and grounding (explicitly not a full rigid-body engine, per owner's scope) | **Standby** — `parry2d`/`parry3d` (Apache-2.0) identified as the candidate; must run in Rust/`domain-core` for authoritative-multiplayer reasons, not client-side Three.js |
| Weather / atmospheric effects | **Not discussed** |
| Measurement tools (distance, AoE templates, line-of-sight math) | **Standby** — Turf.js flagged as a candidate library, no design done |
| GM-only vs. player-visible map layers | **Not discussed** |

## 2. Tokens, characters & combat

| Topic | Status |
| --- | --- |
| Token visual representation (2.5D billboard/sprite over 3D world) | **Decided** |
| Token movement, collision, snapping | **Not discussed** |
| Per-token vision/light radius | **Not discussed** |
| Status effects / conditions on tokens | **Not discussed** |
| Initiative tracker / combat turn order | **Not discussed** |
| Resource bars (HP, resources) rendered on/near tokens | **Not discussed** |
| Character sheet data model | **Not discussed** |

## 3. Game system / rules engine

Open-source options researched in
`docs/research/vtt-rules-and-character-system-options.md` — this section
only indexes it.

| Topic | Status |
| --- | --- |
| System-agnostic (Foundry-style, many rulesets) vs. one system built-in (e.g. tuned specifically for Ordem Paranormal) | **Open — a real, early fork, surfaced with evidence, not decided.** Both PlanarAlly (MIT) and Foundry's own core independently chose system-agnostic — proven path, not necessarily the right one for this project's tighter curated-polish goal |
| Dice rolling (virtual dice, formulas, macros) | **Standby** — `ndm` (MIT/Apache-2.0) identified as the leading dice-notation-parsing crate; actual rolling reuses `domain-core`'s existing `DeterministicRng` |
| Flexible character/entity data modeling | **Standby** — ECS crates (`hecs`, `specs`) identified as a candidate pattern, not yet chosen over a plain-enum domain model |
| Rule automation (attack rolls, damage calculation, saves) | **Standby** — a generic action-resolution flow (Command → dice roll via `ndm`/`DeterministicRng` → modifier application → outcome) is proposed in `docs/research/vtt-rules-and-character-system-options.md`, unifying combat damage/healing with the same modifier mechanism as persistent status effects |
| Compendiums / content packs (items, spells, monsters, stat blocks) | **Not discussed** |
| How map entities (doors, containers, triggers) relate to character/rules entities | **Decided (boundary only)** — `VTT-PRODUCT-001` separates scene placement, optional rules subject, participant identity, surface identity, and rules-provider composition; exact door/container/trigger payloads remain open until their executable feature slices |
| Fog of war / dynamic vision algorithm | **Decided (architecture only)** — `VTT-VISIBILITY-001`, based on `VTT-FOG-RESEARCH-001`, fixes character/group knowledge, open sense evidence, disclosure, last-known state, fog/void, grid-independent layered coverage, point silhouettes, and session authority; implementation and numeric tuning remain deferred |

## 4. Multiplayer & networking

**Correction to this document's own earlier draft**: this was marked "Not
discussed" above; that was wrong, and is retracted rather than refined. At
the engine level, multiplayer is one of the **most thoroughly pre-architected
areas of the entire master source** — `GRAFTING_MASTER_SOURCE.md` section 15,
`DEC-016` (`LOCKED`), `PROV-003`, and a full `Phase 6`/`Epic H` task backlog
already exist. Full detail belongs in a dedicated note, not duplicated here —
see the "Multiplayer: what's already decided vs. genuinely open" discussion
recorded in this planning session (engine-level architecture, not VTT-specific
yet). Summary:

| Topic | Status |
| --- | --- |
| Architecture pattern name and shape (`ClientCommand → AcceptedCommand → DomainEvent → journal → per-client projection → ReplicationDelta → transport`) | **Decided/Locked** — `DEC-016`, section 15.1–15.7 |
| Wire format for Commands/DomainEvents/ReplicationDeltas/Snapshots | **Decided** — `PROV-003`, FlatBuffers, already implemented for Command/DomainEvent/Snapshot in `libs/engine/domain-core` (generic placeholder domain, not the VTT's real domain yet) |
| Journal and snapshot minimum record contents | **Decided** — section 15.5/15.6 |
| Authoritative host language/runtime (`GATE-004`) | **Open — deliberately deferred**, per `docs/adr/ADR-0005-authoritative-host-deferral.md`, to the start of Phase 6/Epic H (task `H-001`); three options recorded, none chosen; no agent should pick one before then |
| Which VTT-specific Commands exist, and which are GM-only | **Decided (protocol only)** — `VTT-PRODUCT-001` defines typed app-local operation families, capability-based authorization, and the operation envelope; exact payloads and authoritative enforcement remain open until their slices and `GATE-004` |
| Self-hosted vs. SaaS hosting model | **Not discussed** — downstream of `GATE-004`, and has licensing/business-model implications given the owner's closed-source-sale goal |
| Voice/video/text chat | **Not discussed** — Foundry itself does not build this in either (leans on Discord); worth an explicit choice either way rather than a silent default |

That architectural gap is now closed by `VTT-PRODUCT-001`. Remaining product
work is feature-owned: exact construction, token, access, and rules payloads
are materialized only by their first executable slices, while `GATE-004`
continues to defer the authoritative host. A reusable package still must not
gain a VTT namespace or app-exclusive methods.

## 5. GM tools

| Topic | Status |
| --- | --- |
| Free-camera analytical/overview view | **Decided** (part of the map/rendering document) |
| Scene/encounter management (switching between maps, preparing multiple scenes) | **Not discussed** |
| NPC/monster management | **Not discussed** |
| Journal / campaign notes | **Not discussed** |
| Soundscape / music playlists | **Not discussed** |
| Handouts (sharing an image/document to players) | **Not discussed** |

## 6. Player tools

| Topic | Status |
| --- | --- |
| Player-facing character sheet UI | **Not discussed** |
| Inventory management | **Not discussed** |
| Chat / roll log | **Not discussed** |
| Player-scoped permissions on their own view | **Not discussed** |

## 7. Content creation, asset pipeline & marketplace

Ties directly to the owner's "used for other things too" goal and to
Tier 2 import.

| Topic | Status |
| --- | --- |
| Tileset authoring tools for the WFC systems (buildings/terrain/interiors) | **Open** — tile modules are confirmed to be hand-authored 3D assets tagged with adjacency metadata (see the map document's "Who authors each tile module" section), a real content-creation task; the *authoring tool* to build them is still a separate, untouched question |
| Custom asset import (3D models, textures for props/buildings) | **Not discussed** |
| Community content sharing / marketplace (Foundry's module ecosystem is a major part of its ecosystem strength) | **Not discussed** |

## 8. Platform & deployment

| Topic | Status |
| --- | --- |
| Desktop client | **Open** — Tauri flagged as a candidate (pulled from the GeoLibre research spin-off), tied to the still-open `GATE-002`/`GATE-003` decision in `CURRENT_PLANNING_STATE.md` |
| Mobile | **Not discussed** |
| VR | **Not discussed for this project** — Townscaper's own shipped VR mode was noted as a precedent that free-camera 3D works for this aesthetic, but no decision has been made about VR for our VTT itself |
| Hosting model (self-hosted vs. SaaS) | **Not discussed** — see Multiplayer & Networking above, same open question |

## 9. Cross-project reusability

Per the owner's explicit goal (stated earlier in this planning process) of
building pieces that can serve other future products, not only the VTT:

**Already explicitly designed to be reusable beyond the VTT:**

- `libs/isekai/wasm-bridge` → `packages/isekai-wasm` → `isekai-web-client`'s
  Worker pathway — a generic Rust-to-browser compute bridge, not VTT-specific
- `libs/engine/domain-core` (`Command → DomainEvent → Snapshot`) — a generic
  authoritative execution/state engine, not VTT-specific
- The procedural-generation crates (`ghx_proc_gen`, `fast-surface-nets-rs`,
  `noise-rs`, `block-mesh-rs`) — usable by any project needing WFC-style or
  terrain generation, not VTT-specific
- The route-optimization product idea the owner raised earlier (a real,
  different app selling optimized-route visualization) was explicitly named
  as a second consumer of the same rendering techniques being developed here

**VTT-specific, would need a deliberate boundary (per DEC-049,
`docs/adr/ADR-0011-package-autonomy-and-external-isolation.md`) before any
reuse:**

- The game-system/rules engine (once designed)
- The character-sheet data model
- VTT-specific UI (token HUD, initiative tracker, GM tool panels)

## Suggested next step (an observation, not a decision)

The app-local product model is now accepted as `VTT-PRODUCT-001`. The next
work SHOULD materialize one executable consumer at a time: construction in
Epic 3, token placement/subject binding in `E5.2`, a first visibility consumer
under `VTT-VISIBILITY-001`, and rules composition after `E6.3`. The future session adapter can translate
app operations to the authoritative pipeline after `GATE-004` closes.
