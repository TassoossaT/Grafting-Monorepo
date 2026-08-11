# ADR-0022: a construction surface is a stable set of graph nodes

- Status: Accepted
- Decision owner: repository-owner
- Original decision date: 2026-08-08 (free-geometry model — superseded below)
- Revision date: 2026-08-10
- Record: DEC-060
- Supersedes: this document's own 2026-08-08 decision, in place, at the
  owner's explicit direction ("não tem problema em reescrever ela
  completamente para que o que foi decidido aqui perdure nas tasks")
- Related: `docs/research/vtt-wall-representation-options.md`,
  `docs/research/vtt-world-model-and-grid-layers.md`,
  `docs/research/vtt-construction-layering-graph-mesh-asset.md`

## Revision note — why this document was rewritten rather than left alone

The original 2026-08-08 decision (free geometry in world coordinates, never
a grid address) was correct **given the technology it was reasoning
about**: `libs/domains/procgen/tileset-wfc::CellId` is a positional index
into one solve — `shell-cell-graph.ts` numbers cells positionally, so
inserting one cell shifts every id after it. Persisting that as identity is
unsafe, and that specific finding is **not** reversed here — it still
governs `tileset-wfc::CellId` unconditionally.

What changed: while designing `grafting-graph-core`'s graph library (a
separate 2026-08-10 conversation), it became clear its `NodeId` is a
**stable, caller-assigned identity**, not a positional index — the doc
comment on the type says so directly ("Stable Grafting node identity").
Re-examining the original decision against this specific, different
technology, the owner decided the reasoning no longer holds for
`grafting-graph-core`-backed nodes, and directed this document to be
rewritten in place rather than superseded by a new ADR number, so the
current decision is what governs, plainly, without a reader having to
chase a chain of amendments to find it. The original reasoning is kept
below, condensed, because an ADR that hides why it changed its mind is not
reviewable — not because it is still the operative decision.

## Decision

A construction surface — a wall, door, window, floor panel, terrain patch,
or any other generated or player-placed structural element — is **defined
by a set of graph nodes** (a cycle) in `grafting-graph-core`, referenced by
their stable `NodeId`. This applies uniformly to every construction domain
(structure and terrain alike); nothing here reintroduces a terrain/structure
split, that question is separate and still open
(`docs/research/vtt-construction-layering-graph-mesh-asset.md`).

This is a **reversal** of the free-geometry rule this document previously
stated. It is scoped precisely: only `grafting-graph-core::NodeId`
references are permitted as identity. `tileset-wfc::CellId` remains
forbidden as a persisted identity, unconditionally — the corollary below is
unchanged from the original decision.

## The layered model this decision is part of

Recorded in full, with open questions, in
`docs/research/vtt-construction-layering-graph-mesh-asset.md`. Summary of
the part this ADR governs:

1. **Graph** — nodes plus operations (cycles). Pure topology, no visual or
   semantic meaning. Each node carries its spatial position as payload —
   this *is* what "the 3D grid" means; it is not a separate structure.
2. **Mesh** — derived from a cycle of graph nodes. Pure geometric
   parameters, nothing else. Because a cycle can be any set of connected
   nodes (not a fixed two-point segment), a mesh can express any polygon
   shape — a hexagon, an irregular outline — not only a rectangle.
3. **Surface** — the semantic record this ADR is about:
   `{ type, physical: bool, mesh }`. `type` is an open, extensible
   identifier, never a fixed/closed enum (the same correction already made
   to `map_state.fbs`'s `BoundaryKind` — a closed enum baked into a shared
   contract is the same "product concept hardcoded into infrastructure"
   mistake `DEC-052`/`ADR-0014` already forbids elsewhere). `physical` says
   whether the surface currently blocks movement or acts as ground —
   nothing about vision or rendering; that belongs to the asset layer.
4. **Asset** — fills the mesh, either by replication (a small reusable
   fragment duplicated along the mesh to fill it, count depending on size —
   a repeating brick or fence-post pattern) or by stretch/fit (a single
   unique asset scaled to match the mesh's exact dimensions — a specific
   door). Vision-blocking and other rendering-relevant behavior belongs
   here, not to the surface.

Richer game state (open/closed, locked, trapped) is not part of `Surface`
at all — it belongs to the rules system (`vtt-roadmap.md` Epic 6),
referencing a surface by its node-set identity, never restating its
geometry.

## Node operations, and what each means for a surface

- **Move** — always safe. This was already true under the original 2026-08-08
  decision's own text ("a grid address survives vertex movement"); nothing
  changes here. Every surface referencing a moved node recalculates its
  mesh. `grafting-graph-core`'s adjacency data gives an instant lookup of
  exactly which surfaces reference a changed node — the reactive-redraw
  behavior the owner specifically wants, without a full scan.
- **Add** — a new node can be added at a vertex.
- **Delete** — allowed. Surfaces defined by the deleted node are removed.
  If the deleted node's former neighbors now form a closed cycle among
  themselves, a new surface is generated automatically to cap that cycle
  (example: removing a pyramid's apex forms a new surface capping the
  base). This can leave a hole where no such cycle forms — accepted by
  design, not treated as an error state.
- **Merge** — two node sets can be united into one surface (a door's nodes
  and an adjoining wall's nodes becoming one thing).
- **Split** — a surface can be divided (cutting a wall into two).
- **Duplicate** — only a whole surface (a node set) can be duplicated. A
  single node alone carries no usable information and cannot be duplicated
  on its own.

## What this decision does not resolve — recorded honestly, not glossed over

- **Recomputation cost.** A surface's shape is derived from its nodes'
  current positions on demand, not stored as a pre-baked segment. This
  reintroduces, deliberately, the specific cost the original research
  (`vtt-wall-representation-options.md`) named against the grid-bound
  option: "segments are derived from cell faces every time the geometry
  changes," instead of the free-geometry option's "already the stored
  form." Whether that cost is acceptable at real interaction scale (a
  brush stroke recalculating several surfaces, at VTT map scale, inside a
  frame budget) is exactly what `vtt-roadmap.md` Epic 1's `E1.1` benchmark
  needs to measure. This decision does not settle that question — it makes
  the answer load-bearing rather than optional.
- **Tier 2 import (UVTT).** A wall imported from an external tool was never
  authored against any node of ours. How an imported wall becomes a node
  set — ad hoc nodes created purely to host it, or some other bridge — is
  not designed here.
- **The deletion-repair rule is a defined heuristic for one case, not a
  general algorithm.** "Neighbors form a cycle, cap it" is concrete and
  correct for the stated example (a pyramid's apex); the general case
  (irregular neighbor shapes, multiple candidate cycles) is not fully
  specified.
- **The terrain/structure seam**
  (`docs/research/vtt-construction-layering-graph-mesh-asset.md`'s
  Problem 2) is untouched by this decision either way and remains open.
- **`libs/engine/domain-core/contracts/map_state.fbs`** (merged via PR #73)
  implements the free-geometry `BoundarySegment`/`BoundaryPatch` design
  this decision reverses. That contract is now stale and needs its own
  follow-up task — not done as part of writing this document.

## Context kept from the original decision, condensed

**The solver never decides an edge.** `tileset-wfc`'s `Assignment` is a
`Vec<ModuleId>` indexed by cell; `Link` carries only
`from`/`from_face`/`to`/`to_face`, no payload. A wall can be *derived* from
a chosen module's face, never *decided* as a link — this fact is unchanged
and is why generation still emits geometry that a surface's nodes are
derived from, not the reverse.

**Why grid addressing was rejected for `CellId` specifically.** A `CellId`
is a positional index into one solve; inserting a cell anywhere shifts
every later id, and if the edge a wall lived on dissolves, "where the wall
went" has no correct answer, only a chosen rule. This remains true of
`CellId` today. It does not hold for `grafting-graph-core::NodeId`, whose
identity is assigned once and does not shift when unrelated nodes are
added elsewhere — the specific property that changes this decision's
outcome.

The two mature references (Foundry, PlanarAlly) both store walls as free
geometry — that evidence is not wrong, it is just weighed differently now
that a stable-identity graph library exists to reference instead of a
positional one.

## Consequences

- **Benefit:** the reactive-redraw behavior the owner wants (move a node,
  instantly know which surfaces to recompute via graph adjacency, not a
  full scan) is native to this model — it was not achievable without
  either this reversal or a separate spatial-index layer.
- **Benefit:** a mesh can express any polygon a node cycle describes, not
  only a rectangle — strictly more expressive than the flat
  `BoundarySegment` (start/end/height) shape it replaces.
- **Cost:** every surface query re-derives geometry from current node
  positions rather than reading a stored segment — a real, named,
  unmeasured cost (see above).
- **Cost:** Tier 2 import and the general deletion-repair algorithm both
  need design work this document does not do.
- **Risk — reopening this again.** This document was already reopened once
  in two days. If `E1.1`'s measurement shows the recomputation cost is not
  acceptable, this decision is the one that would need reopening a third
  time — recorded here so that is an expected possibility, not a surprise.

## Evidence

- `libs/graph/core/src/model.rs` — `NodeId` as a stable identity type,
  `Graph<N, E>`'s `BTreeMap<NodeId, NodeIndex>` translation layer, read
  directly during this design conversation.
- `libs/domains/procgen/tileset-wfc/src/graph.rs` — `CellId` as a bare
  `usize`, no stability guarantee, read directly; the corollary above is
  unchanged because this file is unchanged.
- `apps/architecture-studio/src/vtt/shell-cell-graph.ts` — positional cell
  numbering, the original evidence for why `CellId` is unsafe; still true.
- `docs/research/vtt-wall-representation-options.md` — the original
  comparison; its Option A ("the wall is grid-bound") is what this
  revision adopts, now that the technology backing it has changed.
- `docs/research/vtt-construction-layering-graph-mesh-asset.md` — the
  design conversation this decision is extracted from, including the
  problems it does not resolve.

## Migration or rollback

`libs/engine/domain-core/contracts/map_state.fbs` (merged, PR #73) and any
code generated from it implement the superseded free-geometry design and
are now stale. Redesigning that contract around node-set references is a
separate, non-Markdown follow-up task (touches `.fbs`, needs `ia-graft task
new` + PR) — not performed as part of this document.

Rollback direction if `E1.1`'s measurement makes this decision look wrong:
freezing a surface's derived mesh into stored, static geometry at the
moment it stops changing is a narrowing, not a rewrite of every query —
cheaper to roll back to free geometry than it would have been to adopt it
fresh, since the node-derived mesh already produces the same shape a
frozen record would store.
