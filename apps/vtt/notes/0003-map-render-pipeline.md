# Note 0003 — Map render pipeline (`E3.5`)

- Recorded: 2026-08-12
- Status: implemented; the decisions below are the ones a later slice
  (`E3.6`/`E3.7`) needs and should not re-derive from scratch
- Source: `E3.5` task (`VTT-MAP-RENDER-PIPELINE`), the first task of
  `docs/architecture/vtt-roadmap.md`'s Epic 3.5

This is a decisions record, not a defect log like [0001](0001-rendering-and-propagation.md).
It exists so the next task doesn't re-read every source file this one did to
arrive at the same conclusions.

## The gap this task confirmed, and deliberately did not fill

**Nothing in the Rust workspace turns a `Surface`'s node cycle into a
triangulated mesh.** `ADR-0022` states "mesh derives pure geometric
parameters from the node cycle's current positions" as intent; no code does
this today, in `libs/graph/core` or anywhere in `libs/domains/procgen`. This
task's renderer is verified against synthetic `RenderMeshData` fixtures only.
**`E3.6` cannot simply call `ConstructionSession::snapshot_json` and hand the
result to this pipeline** — something between the two must derive real
positions/normals/indices from `{nodes, edges, surfaces}` first, and that
derivation does not exist yet. Build or locate it before wiring `E3.6`.

## Decisions

**No `terrain`/`wall` vocabulary entered `@grafting/render-3d`.** One app-owned
visual kind, `MAP_SURFACE_VISUAL_KIND` (`apps/vtt/src/adapters/rendering/map-chunk-scene-item.ts`),
covers every `Surface.type` — the domain model already unified terrain/wall/
generic surfaces under one open string, so the renderer doesn't need three
kinds. A future asset/material pipeline (`E4.2`) replaces `colorForSurfaceType`'s
flat-color classification without touching the renderer.

**Chunking needs no new engine primitive.** Each spatial chunk is its own
`SceneItem` in the new `map` layer (order 10, below `tokens`' order 20). The
chunk visual kind's `equals` compares the mesh by reference — `create-engine.ts`'s
existing `rebuildItem` already skips the backend rebuild when `equals` says
nothing changed, so an untouched chunk costs nothing per frame. Re-chunking is
ordinary `scene.put`/`scene.remove`.

**Chunk keys are spatial (XZ grid buckets via `chunkKeyFor`), never grid-index
or `CellId`-based.** `docs/architecture/vtt-map-construction-roadmap.md`'s
Phase 3 description predates `ADR-0022`'s revision and still talks about
chunking a `PrismGridMesh` cell grid — that's stale; the persisted geometry
unit is `Surface`, an arbitrary node cycle with world-space positions, so
chunk membership must be computed from where the geometry actually is.

**The GPU clip plane is engine-global, opt-in per material, v1 only.**
`RenderEngine.setClipPlane`/`MaterialDescriptor.clippable` (`packages/render-3d`)
mutate one shared `THREE.Plane` in place — O(1), no rebuild, safe to call every
frame from a live camera later. It is global because Three.js clipping planes
live on the shared `THREE.Material`; two views wanting independently different
floor heights would need per-view material duplication, which this task does
not build. `map-chunk-key.ts`'s `clipPlaneForCameraHeight(cameraY, offset?)`
is the ready, tested, but **unwired** integration point — no live camera
exists in `apps/vtt` yet. `E3.7` calls it once pointer/camera control exists;
until then, `SceneRenderPort.setFloorClipHeight` is exercised only directly.

**`#consumedRevisions` is keyed by `` `${layer}:${scopeId}` ``, not `scopeId`
alone**, in `render-3d-scene-adapter.ts` — a token id and a chunk id are both
caller-chosen strings from unrelated id spaces and could otherwise collide.

## Non-goals carried forward

No Worker boundary (nothing calls `ConstructionSession` from `apps/vtt` yet —
there's nothing to move). No map product model, no pointer/edit-mode
interaction, no per-view independent clip heights, no texture pipeline. See
the `E3.5` plan (or `E3.6`/`E3.7`/`E3.8` in the roadmap) for the full list.
