# ADR-0022: a construction surface is a stable set of graph nodes

- Status: Accepted
- Decision owner: repository-owner
- Original decision date: 2026-08-08 (free-geometry model — superseded below)
- Revision date: 2026-08-10; general deletion-repair algorithm added
  2026-08-12; terrain/structure seam resolved 2026-08-12
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
split — **that question was open at revision time and is resolved as of
2026-08-12, see "Terrain/structure seam: resolved" below.**

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
  design, not treated as an error state. **General algorithm added
  2026-08-12** — see below; this bullet stated the specific pyramid
  example, the algorithm generalizes it.

### Delete: the general cycle-repair algorithm

Added 2026-08-12, closing the gap this document originally left open (see
the superseded bullet under "What this decision does not resolve," kept
below for the record). Given node `N` being deleted:

1. Collect `neighbors(N)` — every node directly connected to `N` by an edge,
   captured **before** `N` and its edges are removed.
2. Remove `N`, its edges, and every `Surface` whose node-cycle includes `N`.
3. Consider only the edges that already existed directly **between** members
   of `neighbors(N)` — edges that did not route through `N`. This is the
   subgraph induced on `neighbors(N)` alone.
4. Find every simple cycle in that induced subgraph, where a cycle is only
   valid if it closes using **exclusively** nodes from `neighbors(N)` — a
   candidate loop that needs any node outside `neighbors(N)` to close does
   not count.
5. A neighbor is not required to participate in any cycle. Neighbors left
   out of every found cycle leave a hole at that location — still accepted
   by design, unchanged from the original decision.
6. Generate one new `Surface` per cycle found in step 4, not one combined
   surface for the whole neighbor set. If `neighbors(N)` splits into more
   than one disjoint cycle, each produces its own new surface (example: two
   pyramids sharing one apex node — deleting the shared apex finds two
   disjoint 4-cycles, one per pyramid's base, and generates two new capping
   surfaces, not one).
7. If no cycle exists in the induced subgraph at all, nothing is generated
   — the accepted-hole case from the original decision, unchanged.

The pyramid-apex example in the bullet above is this algorithm's simplest
case: one node (`N`), four neighbors (the base), one cycle among them (step
4 finds exactly one 4-cycle), one new surface (step 6).
- **Merge** — two node sets can be united into one surface (a door's nodes
  and an adjoining wall's nodes becoming one thing).
- **Split** — a surface can be divided (cutting a wall into two).
- **Duplicate** — only a whole surface (a node set) can be duplicated. A
  single node alone carries no usable information and cannot be duplicated
  on its own.

## Terrain/structure seam: resolved

Added 2026-08-12, closing the gap this document left open at revision time
("nothing here reintroduces a terrain/structure split, that question is
separate and still open"). Confirmed directly with the repository owner
while scoping `vtt-roadmap.md` E3.3: **there is no terrain/structure split
at the graph/mesh/surface layer.** A terrain cell is a `Surface` like any
other — `{ type, physical: true, mesh }`, its `mesh` derived from a cycle
of graph nodes (its corners) exactly like a wall's. There is no separate,
parallel "terrain mesh" data structure living outside the graph.

**What still legitimately differs between domains is generation, not
storage.** `PrismCellAssignment` (`module_id, rotation, layer, x, y,
vertex_shift`, per `vtt-map-construction-roadmap.md` Phase 1) remains the
solver's own scratch vocabulary — which module and rotation were chosen at
a grid position — but it is **generation input, never a second persisted
structure**. It feeds terrain-specific generation code that derives a
target set of node positions/cycles, the same way a chosen module's face
already derives wall geometry today (see "Context kept from the original
decision" below: "a wall can be *derived* from a chosen module's face,
never *decided* as a link"). Terrain is not an exception to that rule; it
is the same rule.

**Generation must stay isolated per domain — this is a hard requirement,
not a style preference.** Each domain's generation code (terrain, walls,
doors, whatever comes later) is the *only* code that understands its own
parameters (module choice, rotation, socket compatibility, or whatever a
future domain needs). It produces exactly one thing for the shared layer
to consume: a target node/cycle description. Reaching that target from
whatever the graph currently looks like is done entirely with the generic
node operations already defined above (Move/Add/Delete/Merge/Split) — no
domain-specific operation is added to the graph layer for this. Two
consequences that follow directly:

- The node-operations layer never knows which domain produced the nodes it
  is operating on — it already didn't ("the backend never needs to know
  what a 'face' or a 'wall' is," `vtt-roadmap.md` E1.2), this extends the
  same rule to generation.
- Changing how one domain generates its surfaces (e.g. a new terrain
  algorithm) only ever touches that domain's own generation code. Every
  other domain's generation code, and the shared graph/mesh/surface/asset
  layers, do not need to change and do not need to know a change happened.

**"Rotation" is a generation parameter, not a graph primitive.** There is
no `rotate` node operation. Changing a cell's module or rotation means
re-running that domain's generation with the new parameter to get a new
target node/cycle description, then applying whatever `Add`/`Delete`/`Move`
diff reaches it from the current graph state — the same generic operations
every other edit uses, not a special case.

**`Surface` attribute edits are independent of node/graph operations.**
Changing a surface's `type` or `physical` flag edits the `Surface` record
directly and touches no node, no cycle, and no mesh recompute — `type`/
`physical` are not derived from node positions, only `mesh` is (see "The
layered model" above). A surface can be redesignated (e.g. wall → window)
without moving anything in space.

**Practical effect on `vtt-roadmap.md` E3.3 / `apply_cell_patch`:** the
"6-slot neighborhood recompute" language in the master roadmap and
`vtt-map-construction-roadmap.md` describes `PrismGridMesh`'s old,
pre-unification `cell_neighbors` field (a fixed North/East/South/West/
Bottom/Top adjacency list specific to one hexahedral grid layout) — not a
rule of the graph operation itself. Under this resolution, editing a
terrain cell's elevation is a `Move` on its corner node(s); how many other
surfaces recompute their mesh as a result is whatever the graph's adjacency
says it is for that node, not a hardcoded six. A regular grid layout will
tend to produce a handful of affected surfaces per move, but that is an
emergent property of the topology, not a constraint the algorithm encodes.
There is no separate `apply_cell_patch` algorithm to design — the
generic `Move`/`Add` node operations, plus terrain's own isolated
generation code, are the implementation.

## What this decision does not resolve — recorded honestly, not glossed over

- ~~**Recomputation cost was unmeasured.**~~ **Resolved 2026-08-12.**
  `docs/benchmarks/vtt-surface-mesh-recomputation-2026-08-12.md` measures the
  complete node move → reverse-index invalidation → polygon materialization
  path at 1k through 1M surfaces. The 1M preset takes about 0.241 ms per
  representative 7×7-node brush stroke against the predeclared 1.67 ms
  ceiling. `ConstructionSurface` therefore keeps no mesh cache: shape remains
  derived from its ordered node cycle. The separate 6.567 s construction time
  at 1M surfaces remains a load-time/UX concern, not a reason to persist a
  second authoritative geometry copy.
- **Tier 2 import (UVTT).** A wall imported from an external tool was never
  authored against any node of ours. How an imported wall becomes a node
  set — ad hoc nodes created purely to host it, or some other bridge — is
  not designed here.
- ~~**The deletion-repair rule is a defined heuristic for one case, not a
  general algorithm.**~~ **Resolved 2026-08-12** — see "Delete: the general
  cycle-repair algorithm" above. Kept here, struck through, so the record of
  what was once open is not lost.
- ~~**The terrain/structure seam**
  (`docs/research/vtt-construction-layering-graph-mesh-asset.md`'s
  Problem 2) is untouched by this decision either way and remains open.~~
  **Resolved 2026-08-12** — see "Terrain/structure seam: resolved" above.
  Kept here, struck through, so the record of what was once open is not
  lost.
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
  positions rather than reading a stored segment. The 2026-08-12 follow-up
  benchmark measured this path within budget through 1M surfaces; future
  consumers still need to remeasure unusually complex polygons.
- **Cost:** Tier 2 import needs design work this document does not do.

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
