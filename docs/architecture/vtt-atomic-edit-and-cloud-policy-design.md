# VTT atomic edit vocabulary and cloud policy ownership

- Status: **discussion record; not an accepted ADR, not an implementation
  plan**
- Date: 2026-08-19
- Scope: the generic vertex/edge/region edit vocabulary Rust exposes for an
  already-built `SurfaceRegion`, and how per-structure-type editing policy
  (what a wall vs. a terrain patch vs. a path lets you do) is defined and
  owned.
- Related: `docs/architecture/vtt-node-and-wall-handle-design-notes.md`
  (2026-08-17, prior discussion of wall node roles and directional handle
  families at the interaction-design level — still relevant context, not
  superseded, though this doc answers two of its open questions: #3
  "generic non-wall node handle" and #5 "scope of the role model beyond
  walls"). `apps/vtt/src/features/edit-construction/surface-edit-mode-registry.ts`
  (existing precedent for per-type policy living on the TS side).

This file records an in-progress design discussion, reached by consensus
over several rounds with the repository owner. Nothing here is authorized
for implementation by itself — it exists so the discussion isn't lost and
so a future implementation task can be scoped against settled ground
instead of re-deriving it.

## Why this discussion started

While fixing a path-brush bug (PR #148, "no mesh derivable"/exact-cut
region consumption), the owner asked why moving a path-brush-created node
doesn't visibly move the road, while moving a tower's node works fine.

Root cause: `grafting-graph-core::construction::move_node` (and the other
four ADR-0022 operations — `delete_node`, `merge_surfaces`, `split_surface`,
`duplicate_surface`) compute "which surfaces are affected" via
`SurfaceRegistry::surfaces_referencing` only. They predate the analytic
`SurfaceRegion`/`ContourTopology` model entirely and have no way to know a
region exists. As of PR #151
(`docs`/memory: `project_surface_creation_migrated_to_regions`), every
surface *creation* path was migrated onto `SurfaceRegion`, so these five
legacy operations currently have no real-world way to receive input at all
in the live app — the whole editing layer needs to be rebuilt against the
analytic model, not patched.

## Settled: the atomic edit vocabulary (Rust side)

Three levels. Every primitive is type-agnostic — no knowledge of "wall,"
"terrain," or any other product concept anywhere in this layer.

**Vertex**
- `MoveVertex(node, new position)`
- `InsertVertex(edge, point)` — subdivides one edge, minting a new vertex on
  it.
- `RemoveVertex(node)` — welds its two neighboring edges into one (inverse
  of insert).

A "cut" that carves a movable notch out of a straight edge (for future
steps/recesses) is **not its own primitive** — it's `InsertVertex` called
twice on the same original edge. `A—B` becomes `A—P1`, `P1—P2` (the new,
independently movable segment), `P2—B`; nothing links `P1—P2`'s own motion
back to `A` or `B`, since nodes only ever share what they're each
independently connected to.

**Edge**
- `RetypeEdge(edge, new geometry)` — swap `Line`↔`Arc`, or adjust an arc's
  own bulge, without touching either endpoint.
- `MoveEdge(edge, offset)` — moves both endpoints together as one rigid
  unit ("drag a whole wall segment").

**Region**
- `CutRegion(region, cut path)` — a cut path touching the region's own
  outer boundary at both ends splits it into two regions, sharing the new
  edge as their common boundary. This is what covers subdividing a big
  face (e.g. future stairs/steps).
- `AddHole(region, hole loop)` / `RemoveHole(region, hole)` — this is what
  covers doors/windows. **Confirmed already fully supported structurally,
  no new capability needed:** `SurfaceRegion.holes: Vec<ContourLoop>` where
  `ContourLoop = Vec<OrientedEdgeUse>`, each referencing a real, registered
  `ContourEdge` with real `NodeId` endpoints resolved against the `Graph`.
  A hole is not a marker — it is already a second real loop of graph
  edges/nodes, validated by the same manifold/closure rules as the outer
  loop, and it's already exactly what `triangulate_region`'s `earcut` call
  uses directly to cut the hole into the mesh.
- `MoveRegion(region, transform)`, `ResizeRegion(region, ...)`,
  `DeleteRegion(region)`, `DuplicateRegion(region)`.

**Structural guarantee, not per-operation behavior:** every primitive that
removes anything must leave **zero** orphaned nodes/edges — the same rule
already implemented for path-brush region consumption
(`SurfaceRegistry::surfaces_referencing` + `ContourTopology::nodes_in_use`
exclusivity check, delete what's truly unreferenced, then
`ContourTopology::prune_unused_edges`). This becomes **one shared, generic
cleanup step** every atomic primitive invokes at the end of its own
transaction — not something each operation reimplements on its own.

## Settled: where "type" and policy live — explicitly not in Rust

Owner's explicit, repeated direction: **Rust only does calculation and
heavy lifting; type, coordinate, and policy information lives on the front
end.** This matches the existing precedent
(`surface-edit-mode-registry.ts` is already a per-type policy registry on
the TS side) and the ADR-0022 generation/orchestration split ("type lives
only in the front as a preset").

Concretely, per structure type (wall, terrain, tower, path, …), **one file
on the TS side owns both halves together**:

1. **How to create it** — which generation call to make, with what
   parameters, in what expected shape.
2. **The role → edit-policy table**, derived entirely from #1. Because the
   front end is the one that *requested* a specific shape, it already
   knows — by construction, with nothing needing to travel back from Rust
   — that "the node at response index 0 is the bottom-left corner," etc.
   **Rust does not tag nodes/edges with a "role" at all.** The only
   obligation Rust has is **deterministic, stable ordering** in its
   creation response (already true today — ids come back as
   `...-node-0`, `...-node-1`, in a fixed order), which is what makes the
   front end's index → role mapping reliable.

For each role, the policy declares three things (owner's own wall
example — a wall is 4 nodes/edges/1 face):

- **Which atomic ops apply.** Top nodes: height-only. Bottom vertex: free
  move. Top edge: height-only `MoveEdge`.
- **A constraint on the op's own parameter** (e.g. axis-locked to Y) —
  computed and enforced on the TS side *before* the Rust call is made.
- **A cascade**: additional atomic ops fired in the same transaction as a
  side effect. Moving the bottom vertex also fires `MoveVertex` with the
  **same delta** on its paired top vertex. Confirmed: same-delta only is
  sufficient for now — no scaled/proportional/different-axis cascades are
  needed yet.

Resolution when the front end attempts an edit against a role's policy:
allow as-is / deny / substitute a different atomic op / escalate to a full
regeneration call (see below) — plus firing whatever cascade list applies.

**Organic types get a near-empty policy table.** Terrain generation
produces a large, non-enumerable, procedural node set with no meaningful
fixed "this vertex is always the corner" — so per-vertex/edge roles can't
be assigned at all. Owner's own conclusion: terrain effectively gets no
fine-grained atomic editing; any terrain "edit" in practice is a brand-new
generation call replacing the whole region (the escalate case), not a
sequence of atomic ops. Structured, small, fixed-topology types (wall,
tower) are where the rich per-role table actually pays off.

## Resulting ownership split

- **Rust owns:** the atomic primitive implementations (mutate the
  graph/`ContourTopology`, enforce zero orphans, return the result), plus
  deterministic node/edge id ordering on every creation call. No knowledge
  of "wall," "terrain," "role," or "policy" anywhere in this layer.
- **TS owns:** one file per structure type, each pairing creation-shape
  knowledge with its role-derived policy table; an orchestrator that,
  given a user gesture, resolves policy, computes the constrained
  parameter, and issues the primary + cascade Rust calls in sequence as
  one transaction.

## Explicitly not decided by this file

- The exact TS file/folder layout for per-type definitions.
- The exact wire contract (request/response shape) for each atomic op.
- Any implementation plan, file list, or build/staging order for actually
  writing this.
- Gizmo/handle visual design, drag-constraint UX details, map-bounds
  clamping behavior, and the other open questions already recorded in
  `vtt-node-and-wall-handle-design-notes.md` — those remain open and this
  doc doesn't re-litigate or resolve them, beyond answering that doc's
  open questions #3 and #5 (generic node handles and non-wall roles both
  fall out naturally once every type gets its own role table on the same
  foundation).
