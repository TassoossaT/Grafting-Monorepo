# ADR-0022: a wall is free geometry, not a grid address

- Status: Proposed
- Decision owner: repository-owner
- Decision date: 2026-08-08
- Record: DEC-060
- Supersedes: None
- Related: `docs/research/vtt-wall-representation-options.md`,
  `docs/research/vtt-world-model-and-grid-layers.md`

## Decision

A wall, door, window or any other construction-layer boundary is stored as
**geometry in world coordinates carrying behavioural flags**, never as a grid
address. It is not a cell, and not a `(cell, face)` pair.

The grid keeps two roles and loses one:

- **authoring aid** — snapping while drawing, exactly as Foundry's wall tool
  snaps to a sub-grid;
- **query accelerator** — a spatial index may be grid-shaped;
- **not the address.** No semantic record identifies itself by cell.

Two boundaries on this decision:

1. It governs the **authoritative semantic store**. It does not change how
   generation *decides* geometry: the solver keeps assigning one module per
   cell, because that is its only output vocabulary.
2. It does not forbid a wall lying exactly on a cell face. Snapping is
   expected. What is forbidden is *storing* it as that face.

A corollary worth stating because it is already live in the code:
`CellId` from `tileset-wfc` is an index into one solve, not an identity.
`shell-cell-graph.ts` numbers cells positionally over materialised cells, so
adding one cell shifts every id after it. No persisted record may hold a
`CellId`.

## Context

Three facts, each checkable, pointing the same way.

**The solver never decides an edge.** `libs/domains/procgen/tileset-wfc`'s
`Assignment` is a `Vec<ModuleId>` indexed by cell; `Link` carries only
`from`/`from_face`/`to`/`to_face`. A wall can be *derived* from a chosen
module's face, never *decided* as a link. But the world model already requires
semantics to be stored apart from generation and to be authoritative, so this
constrains how a wall is drawn, not how it is stored.

**The mesh is editable, and that is a product requirement, not a nicety.** The
owner states that remodelling — removing edges, re-partitioning — must work,
because procedural construction is *one* of four construction tiers, not the
fixed one. A grid address survives vertex movement but not re-partitioning, and
the failure is worse than a stale id: if the edge a wall lived on is dissolved,
where the wall went has no correct answer, only a chosen rule. Keeping grid
addresses under an editable topology would require persistent per-element
identity plus a propagation rule for every topological operation — Blender's
custom-data-layer machinery — which is infrastructure to support the storage
choice, not product.

**Tier 2 import brings walls that never had cells.** A UVTT map's walls were
drawn elsewhere against no grid of ours. Under a grid address they would have
to be re-authored, which is what importing exists to avoid.

The two mature references agree: Foundry stores a wall's `c` as
`[x0, y0, x1, y1]`; PlanarAlly stores drawn shapes carrying
`Blocks vision/light` and `Blocks movement`.

## Consequences

- **Benefit:** survives topological edits, since world coordinates do not
  reference the mesh; Tier 2 import lands unchanged; diagonal, curved and thin
  walls are expressible; visibility algorithms in both references consume
  segments, so the stored form is already the queried form; the three-layer
  model's claim that construction meets the tabletop "only through queries
  against geometry, never through alignment" becomes true rather than aspired.
- **Cost:** a spatial index is required for line-of-sight and collision to stay
  cheap — this is now a dependency of the design, not an optimisation. "Which
  room am I in" stops being a graph walk and becomes a geometric query.
  Pinning semantics into generation needs a geometry→cells conversion step,
  since `Problem::compile`'s `pinned` is cell-indexed, and that step has real
  edge cases (a segment crossing three cells pins which?).
- **Risk — double representation.** Generated module geometry and semantic
  records can disagree: visible wall with no record is walkable, record with no
  visible wall is an invisible barrier. *Mitigation:* generation **emits** the
  semantic records alongside the geometry, and semantics reference geometry by
  id rather than restating coordinates. Never infer a semantic from which
  module the solver chose — the world model already forbids that, and this is
  the case it was written for.
- **Risk — both references are 2D.** Foundry and PlanarAlly solve a strictly
  easier problem: a wall there is a segment in a plane. This world is 3D with
  discrete layers, where a wall is a surface and needs explicit vertical
  extent. *Mitigation:* model vertical extent from the first version rather
  than copying the 2D segment shape and retrofitting height. No measurement of
  query cost at realistic map size exists yet; nothing here is a performance
  claim.

## Evidence

- `libs/domains/procgen/tileset-wfc/src/{solver,graph,problem}.rs`, read
  directly — per-cell `Assignment`, cell-indexed `pinned`, link carries no
  payload.
- `apps/architecture-studio/src/vtt/shell-cell-graph.ts` — positional cell
  numbering, which is what makes `CellId` unusable as an identity.
- [Foundry VTT Wall API](https://foundryvtt.com/api/classes/foundry.canvas.placeables.Wall.html)
  and [Walls article](https://foundryvtt.com/article/walls/) — segment
  endpoints, sub-grid snapping as an authoring aid.
- [PlanarAlly shapes](https://www.planarally.io/docs/game/shapes/) — free
  shapes with blocks-vision and blocks-movement flags.
- `docs/research/vtt-wall-representation-options.md` — the full comparison,
  including what was not established.

## Migration or rollback

Nothing to migrate: no wall code exists yet, which is why this is being decided
now rather than after the interior tileset is authored.

Rollback is cheap in this direction and expensive in the other. Free geometry
contains grid addressing: walls authored to lie on cell faces behave exactly as
grid-addressed walls, at the cost of a geometric query instead of a lookup.
Restricting later is a policy change. The reverse — grid addresses to free
geometry — is a data migration plus a rewrite of every query, which is the
asymmetry this decision is buying.
