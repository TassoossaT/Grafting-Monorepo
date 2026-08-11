# VTT product roadmap: epics and tasks

- Status: planning breakdown, not a Decision Gate and not itself an ADR.
  Where a task cites a `DEC-XXX`/ADR, that decision already governs; where a
  task's own status is **Open**/**Standby**, the task is to *close* that
  status, not an implementation ready to start
- Scope: everything the owner named as "the main part" of the VTT — Studio
  tooling health, the VTT app's own architecture, map/construction, mesh and
  procedural asset generation, tokens, and rules (world/physics/movement/
  actions). Multiplayer wire-up beyond what is already `Decided/Locked` at
  the engine level, GM/player tools, deployment, Tier 2 import, and Tier 3 AI
  authoring are deliberately **not** in this document — they stay tracked in
  `docs/research/vtt-product-scope-map.md` as "something more," per the
  owner's own framing
- Detail for Epic 3 lives in `docs/architecture/vtt-map-construction-roadmap.md`;
  this document sequences it against the other epics rather than repeating it
- Dificuldade/Impacto columns are a rough Baixa/Média/Alta classification of
  execution difficulty and of how much the task unblocks or governs the rest
  of the roadmap — not an agent assignment; which provider (Claude, Codex,
  Gemini) picks up a given task is decided per task, separately
- **Replay determinism is deliberately out of scope everywhere in this
  roadmap for now** — the owner's own framing: "essas coisas serão bem no
  futuro mesmo, replay talvez nem entre ou se entrar será em outro momento."
  No task below should design around `DEC-044`/multiplayer replay as a
  present-day constraint; where a task still uses the `Command`/`DomainEvent`
  vocabulary (E2.3, E5.2), that is about keeping state changes well-modeled,
  not about building replication now
- **`ADR-0022`/`DEC-060` was revised in place on 2026-08-10.** A construction
  surface (wall, door, window, terrain patch) is now defined by a set of
  `grafting-graph-core` graph nodes (a cycle), referenced by stable
  `NodeId` — not free-form world-coordinate geometry, which was this
  roadmap's original design and is now superseded. See the ADR itself for
  the full reasoning, what changed, and what remains unresolved (query
  recomputation cost, Tier 2 import bridging, the deletion-repair rule's
  general form). `E1.5` and `E3.3` below already reflect this; any other
  task that mentions `BoundarySegment`/`BoundaryPatch`/free geometry
  predates the revision and should be read as superseded

## Legend (matches `vtt-product-scope-map.md`)

| Status | Meaning |
| --- | --- |
| **Decided** | A real decision exists; still needs ADR/task follow-through |
| **Standby** | Researched, a direction leans one way, not committed |
| **Open** | Identified as a real need; no research done yet |
| **Not discussed** | Has not been raised in this planning process |

## Dependency order between epics

```text
Epic 1 (Studio/graph-core health)
   -> Epic 2 (VTT app architecture)
        -> Epic 3 (map/construction)
             -> Epic 4 (mesh/procedural assets) -- feeds Epic 3's tilesets too
             -> Epic 5 (tokens)
                  -> Epic 6 (rules: world, physics, movement, actions)
```

Epic 1 blocks Epic 3's C4 task specifically (the mutation engine cannot be
written correctly until the graph-core question is settled). Epics 4 and 5
can start once Epic 2's domain model exists, without waiting for all of
Epic 3.

---

## Epic 1 — Resolve Grafting Architecture Studio's own tooling debt

Goal: the Studio's shared machinery (graph core, bench, lab) is sound before
VTT-specific work builds on top of it. Nothing here is VTT product work.

| # | Task | Status | Dificuldade | Impacto |
| --- | --- | --- | --- | --- |
| E1.1 | **Determinism-scope decision + measurement spike.** Full breakdown below | **Done** — see `docs/benchmarks/graph-storage-2026-08-11.md` (revised after follow-up questions widened the scope). Query/traversal: existing `BTreeMap`-backed path clears the frame-budget threshold with wide margin at 1k/10k/100k/**1M** cells, dispersed access included — no new backend needed there. Bulk insertion: real, measured problem at ~1M cells (5-7s), but the fix the numbers point to is a `BTreeMap`→`HashMap` identity-map swap inside the *existing* type, not the second `Csr`-like backend E1.2 assumed — that alternative engine did not reliably beat the simpler map swap | Média | Alto — unblocks E1.2 and E3.3 |
| E1.2 | **Reconcile `CellGraph` and `grafting-graph-core::Graph` behind one trait-based operations layer.** Full breakdown below | Open — unblocked by E1.1. Deliverables 1/2/4/5/6 (trait extraction) proceed as scoped. Deliverable 3 (a second, `Csr`-or-similar storage type) is **not** what E1.1's numbers justify; re-scope that part to a narrower `HashMap` identity-map swap inside `Graph<N, E>` itself, with explicit re-sort at `snapshot()` (and any other caller currently relying on `BTreeMap`'s incidental ordering) to keep `GraphSnapshot`'s "sorted by stable identity" contract — see the benchmark report's determinism section | Alta | Alto — foundational for all future graph work |
| E1.3 | Consolidate `/lab`: migrate standalone trials into node kinds on the bench registry (several already have equivalents — `heightmap.perlin`, `terrain.discretize`, `grid.irregular`, `terrain.stack`); delete `/lab/trials` once confirmed. `vtt-brush` is flagged as a likely exception (interactive editor, not a data-transform node) — full send-ready prompt below, including that `vtt-brush`'s wall model is now stale a second time | Ready — full prompt preserved below | Média | Médio — tooling hygiene, not blocking; `vtt-brush`'s own redesign is what's actually higher-stakes |
| E1.4 | Fix `/lab/vtt-brush`'s wall mesh: currently extrudes a solid box (`thickness` offset + 5 faces) instead of a flat double-sided plane; material is already `doubleSided: true`, so the fix is dropping the box extrusion, not adding anything | Ready | Baixa | Baixo — cosmetic, isolated to one lab trial |
| E1.5 | **Relocate *and* redesign `map_state.fbs`.** Relocation: out of `libs/engine/domain-core/contracts/`, scoped by master source §10.1 (DEC-013, `LOCKED`) specifically to the replication pipeline's own contracts (`Command`/`DomainEvent`/`ReplicationDelta`/`Snapshot`), and replication/replay is now explicitly deferred (see the note below) — `MapState` was never a replication contract to begin with. Default: relocate under `libs/graph/core` or a procgen-owned contracts directory once `E1.2` settles where graph operations live. **Redesign** (new scope, added after `ADR-0022`'s 2026-08-10 revision): the merged PR #73 schema (`BoundarySegment`/`BoundaryPatch`, free geometry) implements the now-superseded design. It needs replacing with `GraphNode`/`GraphEdge`/`ConstructionSurface` tables per the revised `ADR-0022` and `vtt-map-construction-roadmap.md`'s Phase 1 detail — this is real schema work, not a file move | Open, depends on E1.2 for destination and on the revised `ADR-0022` for shape | Média | Alto — the currently-merged contract is actively wrong relative to the accepted decision |

### Out of scope for E1.1/E1.2: replay determinism

Multiplayer replay is explicitly deferred — the owner's own framing: "essas
coisas serão bem no futuro mesmo, replay talvez nem entre ou se entrar será
em outro momento." Neither task designs around `DEC-044`/replay for now.
Practical effect: the existing `Graph<N, E>`'s `BTreeMap`-backed, ordered
storage (`libs/graph/core/src/model.rs`) is not a constraint the VTT graph
work has to preserve or work around today — there is no live replay/
multiplayer path yet that depends on it. The trait-based design below still
keeps the door open for a deterministic backend later, without either task
having to build or benchmark one now.

### E1.1 detail — measurement spec

**Executed 2026-08-11 — see `docs/benchmarks/graph-storage-2026-08-11.md`
for the full report (revised in place the same day after follow-up
questions: was query cost checked beyond brush-stroke-shaped access, and
does the bulk-insertion number hold up at millions of cells, not just
100k).** The spec below is preserved as the methodology that produced it,
not a still-open task.

**Current implementation, as read from `libs/graph/core/src/model.rs`:**

```rust
pub struct Graph<N, E> {
    storage: StableDiGraph<Node<N>, Edge<E>>,   // petgraph's dense storage
    node_indices: BTreeMap<NodeId, NodeIndex>,   // string id -> dense position
    edge_indices: BTreeMap<EdgeId, EdgeIndex>,
}
```

`successors`/`predecessors` translate every neighbor found back into a
cloned `NodeId` (`String`) before returning a `Vec<NodeId>`. Each call pays
a `BTreeMap` lookup (string comparisons, `O(log n)`) plus a string clone,
per neighbor. This is the cost to measure — not because determinism must be
preserved (it does not need to be, for now), but because nobody has checked
whether this existing path is simply fast enough as-is, before building
anything new to replace it.

**The benchmark spec (write the spec, including the failure threshold,
before running anything):**

- Scale: benchmark at multiple realistic map sizes, not one point — suggest
  small/medium/large presets (order of magnitude: ~1k, ~10k, ~100k cells) to
  see how cost scales, not just whether one size passes.
- Operations to measure separately:
  1. Bulk insertion (building the graph once from a generation pass).
  2. Point lookup by id.
  3. Neighbor query (`successors`/`predecessors`), repeated to simulate a
     brush stroke's 6-slot neighborhood recompute across a realistic
     affected-cell count.
- Comparison baseline: the existing `BTreeMap`-backed path vs. a raw dense
  `NodeIndex`/`usize` path with no string translation at all, so the
  translation layer's isolated cost is a real number, not an impression.
- State the acceptance threshold *before* running: what number counts as
  "fine" vs. "too slow" (e.g., total neighbor-query cost for one typical
  brush stroke must stay well under the frame budget, leaving headroom for
  everything else happening that frame — rendering, WASM boundary crossing,
  mesh rebuild).
- Deliverable: a short written report with the numbers and the
  interpretation against the stated threshold — not shipped code.
- Outcome shapes E1.2 directly: if the existing path is already fast enough,
  E1.2 needs no new storage type at all, only the trait extraction below. If
  it is not, E1.2's second backend (dense, no string translation) is what
  the numbers justify building.
- **What actually happened does not fit either branch cleanly.** The
  query/traversal axis is fast enough (first branch). Bulk insertion is not
  fast enough at real scale (second branch) — but the numbers point at a
  `HashMap` swap inside the *existing* type, not a second storage type
  implementing the trait, because a real `Csr`-based candidate was measured
  and did not reliably beat the simpler map swap. See the report's "A real
  tradeoff the map swap introduces: determinism" section before making this
  change — it is not a type-signature-only substitution.

### E1.2 detail — reconcile behind a trait, not a single winning struct

Whatever E1.1's numbers say, the fix is not "pick one storage type and make
everyone use it." It is: **write every graph operation once, against an
abstract interface, and let more than one storage backend implement that
interface** — the same pattern `petgraph` itself already uses internally (it
ships multiple concrete graph representations, e.g. its
`Csr`/compressed-sparse-row type for fast dense read access, all sharing one
algorithm layer through traits like `IntoNeighbors`/`Visitable`/
`GraphBase`). This is not a new invention; it is extending a pattern the
dependency already proves one level down, up to `grafting-graph-core`'s own
public contract. Building two unrelated concrete graph structs with
hand-written, separately-maintained traversal code in each would silently
reintroduce the exact duplication this whole investigation exists to
prevent.

Concrete deliverables:

1. A trait (or small set of traits) in `grafting-graph-core` stating the
   minimal capability graph algorithms actually need — starting from "given
   a node, its neighbors" — separating read/traversal capability from
   mutation capability if that split turns out to matter.
2. The existing `Graph<N, E>` implements this trait unchanged in behavior.
3. **Superseded by E1.1's actual findings.** The bulk-insertion axis is not
   fast enough at real scale, but the fix the numbers justify is narrower
   than a second storage type: swap `Graph<N, E>`'s internal
   `BTreeMap<NodeId, NodeIndex>`/`BTreeMap<EdgeId, EdgeIndex>` for
   `HashMap`, and add an explicit sort at `snapshot()` (and any other
   caller relying on `BTreeMap`'s incidental ordering) to preserve
   `GraphSnapshot`'s "sorted by stable identity" contract. A real
   `Csr`-based second backend was measured against this and did not
   reliably win — see
   `docs/benchmarks/graph-storage-2026-08-11.md`. Do not build a second
   storage type for this reason unless a future measurement shows the map
   swap insufficient.
4. Every graph *operation* — today's `successors`/`predecessors`, soon
   `apply_cell_patch`'s K-step neighborhood recompute, later E3.4's
   path-constraint reachability check for interior generation — is written
   once against the trait, inside `grafting-graph-core`, and used by
   whichever backend applies. **Optional, non-blocking finding from E1.1:**
   `successors`/`predecessors` clone every result to a `String` `NodeId`;
   an index-returning variant for purely-internal callers (never crossing
   the crate's own boundary) measured 3.3-10.4x faster at every scale up to
   ~1M cells. Not required — the existing `String`-returning path already
   clears the frame-budget threshold with wide margin — but worth adding
   alongside the trait if `apply_cell_patch`'s K-step recompute turns out to
   want it.
5. Domain-specific payload (face ids, sockets, `CellRole`, later `Surface`'s
   `type`/`physical` per the revised `ADR-0022`) stays outside the backend(s), carried as the generic
   `N`/`E` type parameter already supported today — the backend never needs
   to know what a "face" or a "wall" is, satisfying "métodos específicos
   ficam de fora, reaproveitando das operações" from this epic's own
   framing.
6. Leave the trait's shape open enough that a future deterministic backend
   (if/when multiplayer replay becomes a real epic) is an additional
   implementation, not a rewrite of every algorithm — the point of doing
   this as a trait now, even though nothing deterministic is being built
   today.

### E1.3 detail — the full consolidation prompt, preserved

Written out in full here (not just summarized) because the original prompt
text only ever existed in chat and would be lost on context compaction.
This is the complete, ready-to-send instruction — send as-is, or update
the vtt-brush note first if `E1.5`'s schema redesign has already landed.

**Objective**: `/lab` is already the node bench (`BenchClient`, DEC-057) —
a canvas of composable nodes registered in
`apps/architecture-studio/src/bench/registry.ts`, with typed ports and
incremental evaluation. `/lab/trials` is a separate index of standalone,
one-page-per-trial demos. There should be only one generic experimentation
surface, not two. Eliminate `/lab/trials`; migrate whatever still needs it
into the bench as atomic node kinds, not ported whole pages.

**Step 1 — audit before recreating.** Check
`apps/architecture-studio/src/bench/registry.ts` in full before writing any
new node. At least these already have a registered equivalent:
`/lab/heightmap` → `heightmap.perlin` (Generation); `/lab/terrain-quantization`
→ `terrain.discretize` (Terrain); `/lab/irregular-grid` → `grid.irregular`
(Grid); `/lab/stacked-terrain` → `terrain.stack` (Terrain). For each,
confirm the bench node genuinely covers the same capability the standalone
page demonstrates (same input/output, same result) — if it does, the page
is redundant, delete it, no new node needed.

**Step 2 — the ones that may still be missing.** For `/lab/terrain-transitions`,
`/lab/terrain-tileset`, and `/lab/mesh-procedural`, check for an existing
node first (`mesh-procedural` may already have one — it was added in the
same commit as its trial page, "add 3D mesh & freeform generator trial and
bench node"). Where genuinely missing, add node kind(s) following the
existing registry pattern (`id`, `category`, typed `inputs`/`outputs` via
`BENCH_DATA_TYPES`, `params`) — one node per focused capability, not one
monolithic node replicating the whole page.

**Step 3 — `vtt-brush` is different, and now doubly stale, do not force it.**
`/lab/vtt-brush` is an interactive editing tool (brush, undo/redo), not a
data-transformation node — it probably does not fit the bench's
one-node-computes-one-thing model. Do not force it into a node kind alone;
document the situation and ask before deciding how (or if) it joins the
bench. **In addition**, as of `ADR-0022`'s 2026-08-10 revision, `vtt-brush`'s
underlying data model (`BoundarySegment`/free geometry, from PR #74's
"align with ADR-0022" commit) is now itself superseded by the node-graph
`Surface` model — this is the *second* time this trial's wall model has
gone stale (`CellRole` → `BoundarySegment` → node-graph). Do not treat a
UI-only relocation into the bench as sufficient; the wall-placement logic
itself needs redesigning around node operations (move/add/delete/merge/split)
once `E1.5`'s schema redesign lands, and that redesign should happen once,
not be layered under whatever UI shell decision this task makes.

**Step 4 — do not lose capture-and-compare.** `trials-client.tsx` states
each standalone trial "still demonstrates its own capture-and-compare
workflow, which the bench does not replace." Before deleting any trial,
confirm the bench already has (or add) an equivalent per-node
capture/preview flow — see `apps/architecture-studio/src/bench/preview.ts`
and the existing `ParameterPanel`/preview panel in `/lab`. If that flow
genuinely does not exist for the bench yet, it is a prerequisite, not
something to skip.

**Step 5 — cleanup**, only after each trial has a confirmed bench
equivalent (or is confirmed redundant): delete the standalone route
(`apps/architecture-studio/src/app/lab/<trial>/`); remove its entry from
`DEMO_LINKS` in `research-registry-ui.ts`; delete
`apps/architecture-studio/src/app/lab/trials/` entirely
(`page.tsx`, `trials-client.tsx`); grep for any other reference to the
deleted routes (e.g. `/lab/heightmap`) before removing them.

**Process**: `ia-graft task new` (touches non-Markdown files, normal
task+branch+PR). Run typecheck/build before `task done`. If `vtt-brush`
blocks on a decision, stop that part and deliver the rest — it does not
need to wait for the others to finish.

## Epic 2 — Architect the VTT app itself

Goal: `apps/vtt` stops being notes-only and becomes a structurally sound app
*before* construction features (Epic 3) need a real surface to live in.
`apps/vtt/README.md` is explicit that this needs an ADR first, not just a
directory.

| # | Task | Status | Dificuldade | Impacto |
| --- | --- | --- | --- | --- |
| E2.1 | ADR: promote `apps/vtt` from a notes-only directory to a real app (`project.json`, scope-local `AGENTS.md`), per its own README's stated precondition (`ADR-0016`, `DEC-045`) | Open | Baixa | Alto — unlocks everything downstream |
| E2.2 | Close `apps/vtt/notes/0001` (rendering/propagation debt carried from the bench): explicit per-renderer dependency model (a token's position must not invalidate terrain), origin-tagged state changes (local vs. network vs. programmatic — three sources, not two), one renderer with many views instead of one WebGL context per element, a resizable renderer contract from day one, buffer reuse across the worker boundary, uncommitted-until-release drag gestures | Open, must close before real rendering starts | Alta | Alto — six real, previously-measured defects to prevent from recurring at VTT scale |
| E2.3 | Design the VTT's own domain entities (map/cell, token, rules) as real `Command`/`DomainEvent` types in `domain-core`, with the same discipline its placeholder domain already has — the "suggested next step" `vtt-product-scope-map.md` itself names as the real remaining gap | Open | Alta | Alto — foundational for Epics 3, 5, 6 |
| E2.4 | Decide `apps/vtt/notes/0002`'s open questions (fog of war): is it grid-tied, what resolution is remembered state stored at, does sound produce the same remembered state as sight, who is authoritative. Deliberately deciding only — implementation is out of this epic's scope, per the note's own framing ("algo que eu devo fazer bem para o futuro") | Open | Média | Médio — shapes the engine contract now even though implementation is deferred |
| E2.5 | Domain/folder organization research for the app itself (where map/token/rules domains live inside `apps/vtt`, how they reference `libs/domains/*`) — scoped once E2.1's ADR exists | Open, depends on E2.1 | Média | Médio |

## Epic 3 — Map & construction

Full detail in `docs/architecture/vtt-map-construction-roadmap.md`. Water is
deliberately excluded here and moved to Epic 6 (physics), per the owner's
explicit request to push all physics/water/effects to the future.

| # | Task | Status | Dificuldade | Impacto |
| --- | --- | --- | --- | --- |
| E3.1 | Terrain tileset authoring (slopes/cliffs/grass) — socket vocabulary, ~10-20 pieces from CC0 Kenney/KayKit packs | Standby | Alta | Alto |
| E3.2 | Exterior (Townscaper-style) tileset — same engine as E3.1, its own socket vocabulary | Standby | Alta | Alto |
| E3.3 | Unified brush/mutation engine: `apply_cell_patch` for terrain, plus node operations (move/add/delete/merge/split, per the revised `ADR-0022`, 2026-08-10) for walls/doors/windows as sets of `grafting-graph-core` graph nodes — **not** free-geometry `BoundarySegment`s, that design was reversed | Blocked on E1.1/E1.2 | Alta | Alto — this is "the bulk of construction" the owner wants finished |
| E3.4 | Interior generation: BSP/straight-skeleton room partition + a second WFC pass with an interior tileset + path-constraint connectivity | Open — proposal, not designed | Alta | Médio — can land after terrain/exterior work |
| E3.5 | Real Phase 3 render: chunked sub-buffers + GPU clip-plane shader, continuous world-space `Y` driven by camera height (not discrete floor indices — confirmed this session) | Deferred until E3.3 stabilizes the data model | Média | Baixo-Médio — confirmed decoupled/deferrable this session |

## Epic 4 — Mesh and procedural texture/asset generation

| # | Task | Status | Dificuldade | Impacto |
| --- | --- | --- | --- | --- |
| E4.1 | Research procedural texture generation — genuinely untouched by any existing research document; needs a first pass before anything else here | Not discussed | Média | Médio |
| E4.2 | Tileset/asset authoring pipeline (tagging CC0 meshes with socket/adjacency metadata — real content-creation work, not automatable) | Open | Média | Alto — blocks E3.1/E3.2 content |
| E4.3 | Custom asset import (3D models, textures for props/buildings) | Not discussed | Baixa-Média | Baixo — not urgent, unscoped |

## Epic 5 — Tokens

| # | Task | Status | Dificuldade | Impacto |
| --- | --- | --- | --- | --- |
| E5.1 | Token rendering as a billboard/sprite (`THREE.Sprite`) inside the full-3D world | Decided (technique), not implemented | Baixa | Médio |
| E5.2 | Token domain model as `Command`/`DomainEvent`, per E2.3's discipline | Not discussed | Média | Médio |
| E5.3 | Per-token vision/light radius | Not discussed, connects to E2.4 (fog of war) | Média | Baixo — depends on deferred fog of war |
| E5.4 | Token movement/collision/snapping | Not discussed, depends on E6.1 (physics) | Média | Baixo — blocked on Epic 6 |

## Epic 6 — Rules: world, physics, movement, actions

| # | Task | Status | Dificuldade | Impacto |
| --- | --- | --- | --- | --- |
| E6.1 | Collision/grounding only, not full rigid-body physics (`parry2d`/`parry3d`, Apache-2.0) — must run authoritatively in `domain-core`, never client-side `Raycaster`, so every client resolves the same position (DEC-016/§15) | Standby (decided approach, not implemented) | Média | Médio |
| E6.2 | Water and rivers — flow-accumulation/drainage-basin simulation on the continuous heightmap seed, Three.js `Water`/`WaterMesh` for rendering. Moved here from Epic 3, deliberately deferred | Standby, deliberately deferred | Média | Baixo — do not start yet |
| E6.3 | System-agnostic vs. single-ruleset fork — a real, unresolved fork (both PlanarAlly and Foundry chose agnostic; not necessarily right for this project's tighter curated-polish goal) | Open — real fork, owner decision | Baixa | Alto — shapes everything downstream in Epic 6 |
| E6.4 | Dice rolling (`ndm` crate + `domain-core`'s existing `DeterministicRng`) | Standby | Baixa | Baixo |
| E6.5 | Flexible character/entity data modeling (ECS candidates `hecs`/`specs` vs. plain enum domain model) | Standby | Média | Médio |
| E6.6 | Rule automation (attack rolls, damage, saves) via a generic `Command → dice roll → modifier → outcome` flow, unifying combat and persistent status effects | Standby | Alta | Médio |

---

## Deliberately not in this roadmap

Tracked in `docs/research/vtt-product-scope-map.md`, not duplicated here:
multiplayer's VTT-specific command surface and host language (`GATE-004`,
deferred to Phase 6/Epic H), GM tools (scene management, NPC/monster
management, journal), player tools (character sheet UI, inventory, chat),
Tier 2 import (UVTT), Tier 3 AI-driven authoring, desktop/mobile/VR
platforms, hosting model, and any content marketplace.
