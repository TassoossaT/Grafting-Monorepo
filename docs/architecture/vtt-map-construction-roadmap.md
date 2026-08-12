# VTT Map Construction Architecture & Implementation Roadmap

> **Authoritative Technical Spec & Roadmap**  
> Formulated via `/grill-me` Socratic Architectural Interview.  
> Governed by `GRAFTING_MASTER_SOURCE.md` (§0), DEC-049, DEC-052, DEC-060, ADR-0013, ADR-0014.

---

## 1. Architectural Decisions Summary

| Topic | Decision / Mechanism | Rationale |
| --- | --- | --- |
| **Construction Trigger** | **Two-Phase Hybrid** | Batch macro-terrain (seed/heightmap) + local reactive brush edits. |
| **Terrain Cell Mutation** | **Reactive per-cell patch** | Contiguous Rust arena updates in $O(k)$ over the 6-slot neighborhood for module/rotation/elevation edits; instant Undo/Redo. This is the solver's own vocabulary (one module per cell) — it never carries wall/door semantics. |
| **Construction Surface Model** | **Graph nodes → mesh → surface → asset** | A construction surface (wall, door, window, floor panel, terrain patch — every domain, not just structure) is defined by a set of `grafting-graph-core` graph nodes (a cycle), referenced by their stable `NodeId` — **revised 2026-08-10**, reversing this roadmap's original free-geometry design (DEC-060, `ADR-0022-wall-representation-free-geometry.md`, rewritten in place). `Mesh` derives pure geometric parameters from the node cycle's current positions (any polygon a cycle describes, not only a rectangle). `Surface` is the semantic record: `{ type (open/extensible, never a fixed enum — see `BoundaryKind` correction below), physical: bool, mesh }`. `Asset` fills the mesh by replication (a small unit tiled to size) or stretch/fit (a single unique asset scaled to the mesh's exact dimensions), and owns vision-blocking/rendering behavior — never the surface. `tileset-wfc::CellId` remains forbidden as a persisted identity, unconditionally; this reversal applies only to `grafting-graph-core::NodeId`, which is a stable, caller-assigned identity, not a positional index. |
| **Domain Decoupling** | **Neutral per-cell grammar for generation; node-graph for the persisted surface** | The solver's socket-compatibility grammar (module choice, corner joins) stays a neutral, reusable mechanism outside the VTT. Generation *derives* geometry from a chosen module's faces and expresses it as a node cycle; the persisted `Surface` references that cycle by stable `NodeId`, never by `CellId`. VTT applies presentation/theme over these neutral mechanisms (DEC-052) — DEC-052 governs presentation neutrality only, not surface storage, which is DEC-060's concern. |
| **GPU Render Pipeline** | **Chunked Sub-Buffers** | 3D mesh chunking; WASM sends incremental `ChunkGeometryUpdate` without WebGL scene recreation. |
| **Floor Cutaway View** | **GPU Clip Plane Shader** | WebGL shader applies physical plane clip ($Y < Y_{\text{limit}}$) driven by active camera height level. |
| **Map Persistence & Sync** | ~~FlatBuffers (`GraftingMapState.fbs`)~~ **No contract yet — resolved 2026-08-12** | `map_state.fbs` (PR #73's free-geometry shape) was never wired into any consumer and is removed (`E1.5`, `DEC-060`/`ADR-0022`). No replacement is designed speculatively; the first executable persistence, Worker, or transport consumer designs and owns its own wire contract — see Phase 1. |

---

## 2. Sequenced Implementation Phases (Actionable Backlog)

```mermaid
flowchart TD
    P1["Phase 1: FlatBuffers Schema & State (map_state.fbs)"] --> P2["Phase 2: Reactive Cell Mutator & Node-Graph Surface Mutator (grafting-graph-core)"]
    P2 --> P3["Phase 3: Chunked Geometry Sub-Buffers & GPU Clip Plane Shader (@grafting/render-3d)"]
    P3 --> P4["Phase 4: VTT Brush & Construction Studio Interface (apps/architecture-studio)"]
```

### Phase 1: Map wire contract — resolved, not built speculatively
- ~~**Objective**: Define the wire contract in `libs/engine/domain-core/contracts/map_state.fbs`.~~ **Resolved 2026-08-12 (`E1.5`, `vtt-roadmap.md`).** Code inspection found `map_state.fbs` (PR #73's `BoundarySegment`/`BoundaryPatch`/`PrismCellAssignment` shape) was never wired into `domain-core`'s Rust contracts, conversions, round-trip tests, or any TypeScript/C# consumer, and its free-geometry design was superseded by `ADR-0022`'s node-graph model regardless. It was removed from `domain-core` and global codegen (`tools/scripts/generate-contracts.ps1`) rather than redesigned in place — see `ADR-0022`'s "Migration or rollback" section for the full reasoning.
- **No replacement schema is designed ahead of a real consumer.** The `PrismCellAssignment`/`GraphNode`/`GraphEdge`/`ConstructionSurface` tables once planned here remain a plausible future shape, but are deliberately not built speculatively — the first executable persistence, Worker, or transport consumer designs and owns its own wire contract in its own domain, per the normal domain-location rule (the same principle `E2.3`/ADR-0023 apply to `apps/vtt`: no app-exclusive semantics forced onto a shared layer ahead of a real need).
- Phase 2 below never actually depended on this phase's wire contract landing first — it operates on the in-memory `Graph`/`SurfaceRegistry`, not on any serialized form — so its own completion (see below) was never blocked by this one.

### Phase 2: Reactive Cell Mutator & Node-Graph Surface Mutator (`libs/graph/core`)
- **Objective**: Implement reactive $O(k)$ terrain-cell mutation and the node-graph surface model in Rust. **Blocked on `vtt-roadmap.md` Epic 1** (`E1.1`'s measurement spike and `E1.2`'s trait-based graph-operations reconciliation) — this phase cannot start correctly before those land, since the surface model *is* the graph-core reconciliation's output.
- **Deliverables**:
  - `apply_cell_patch(...)` on `PrismGridMesh` for terrain/module edits — 6-slot neighbor recompute, scoped to the current solve. Unaffected by this revision.
  - Node operations on `grafting-graph-core`: move (always safe — recalculates every surface referencing the moved node via graph adjacency, no full scan), add, delete (with the neighbors-form-a-cycle repair rule — see `ADR-0022`), merge, split, duplicate-a-surface (never a single node alone).
  - `Surface` construction from a node cycle: `{ type, physical, mesh-derived-on-demand }`, per the revised `ADR-0022`.
  - Generation derives node cycles (and therefore surfaces) from a chosen module's faces, instead of assigning a `CellRole` or emitting a `BoundarySegment`.
  - WASM binding export in `libs/domains/procgen/generation-wasm`.

### Phase 3: Chunked Sub-Buffers & Clip Plane Shader (`packages/render-3d`)
- **Objective**: Implement high-fps incremental 3D mesh updates and multi-level floor cutaway shader.
- **Deliverables**:
  - Spatial 3D chunk manager partitioning the prism grid into renderable VBO chunks.
  - Incremental `ChunkGeometryUpdate` WASM listener in `RenderEngine`.
  - WebGL vertex/fragment shader clipping plane for $Y < Y_{\text{limit}}$ floor cutaway navigation.

### Phase 4: VTT Interactive Construction Brush (`apps/architecture-studio`)
- **Objective**: Build the visual editing interface in the Studio (`/lab`).
- **Deliverables**:
  - Interactive 3D Brush tool (Place Wall, Erase, Elevate Level, Create Opening) — wall/door placement is node-graph editing (add/move/merge/split nodes to define a surface's cycle), not free-form segment drawing and not a cell toggle.
  - Undo/Redo stack wired to node-operation history (move/add/delete/merge/split, per the revised `ADR-0022`) for walls/doors, and cell-patch history for terrain.
  - Active level height slider driving the WebGL clip plane shader.
