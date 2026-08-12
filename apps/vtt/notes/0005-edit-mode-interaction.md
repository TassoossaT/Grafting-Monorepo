# Note 0005 — Edit-mode interaction layer (`E3.7`)

- Recorded: 2026-08-12
- Status: implemented; the decisions and gaps below are what a later slice
  (`E3.8`, or a future edit-mode pass) needs and should not re-derive
- Source: `E3.7` task (`VTT-MAP-EDIT-MODE`), the third task of
  `docs/architecture/vtt-roadmap.md`'s Epic 3.5

This is a decisions record, not a defect log like
[0001](0001-rendering-and-propagation.md).

## The gap this task closed

Note [0004](0004-map-product-model.md) left `E3.7` two closed gaps to open:
`entities/map` tracked surfaces but no node *positions* (only bare ids), and
`SceneRenderPort` had no picking/hit-testing surface at all. Both had to be
closed before any pointer interaction could exist:

- `ConstructionSessionPort.getNodePositions()`, wired to the Wasm session's
  already-existing (but previously unused) `snapshot_json` — no Rust changes
  needed, the data was already there.
- `entities/map`'s `MapProjection` gained a `nodePositions` map and a
  `node-moved` delta, following the same revision-must-increase pattern
  `SurfaceProjection` already used.
- `SceneRenderPort.pick(viewId, x, y)`, backed by `@grafting/render-3d`'s
  already-existing `View.pick` (real Three.js raycasting) — construction
  nodes render as small pickable sprite handles on a new `"handles"` layer,
  reusing the token sprite pattern from `E5.2`.

## Decisions

**Picking reuses real geometry raycasting instead of custom ground-plane
math.** `View.pick(x, y)` already raycasts every included layer, so a drag
in progress resolves its target position from *whatever the pointer is
currently over* — a node handle, terrain, or a wall — not from a
hand-rolled screen-to-world projection. This is why `AppTabletopRuntime`
needed no new coordinate-conversion port method, only a picking one.

**`AppTabletopRuntime.moveNode`/`generateTerrainCell`/`generateWall` always
re-derive and re-upload every map chunk**, not just the affected surfaces.
`chunkSurfaceMeshes` merges every surface landing in one spatial bucket into
one buffer per `applyConfirmed` call, so patching only the changed surface
would silently drop whatever else shares its chunk. `#uploadMapChunks` also
diffs chunk ids across calls and emits `map-chunk-removed` for any that
disappeared (e.g. a moved surface leaving a bucket that had nothing else in
it). Deliberately simple for this map's current scale — `E1.1` already found
query/traversal cheap well past it.

**`moveNode` applies its own `node-moved` delta directly (known position);
`generateTerrainCell`/`generateWall` diff a full `getNodePositions()` against
the cached projection instead (unknown positions).** A drag already knows
its exact target position — no reason to pay for a re-scan to rediscover it.
A fresh generate call's new node positions are computed internally by the
Rust engine from cell-index/wall-geometry, never handed back to the caller,
so a diff against the live snapshot is the only way to learn them.

**The undo/redo stack is scoped to `move-node` only**, not a generic
operation-history mechanism. `E3.7`'s own roadmap text only asks for
drag/undo/redo; delete/merge/split/duplicate have no operation or UI trigger
yet (still true after this task — see 0004's carried-forward list), so a
broader history abstraction would have no second use case to prove itself
against.

**"Generate terrain cell"/"generate wall" UI buttons auto-place, they don't
offer click-to-choose placement.** `vtt-brush`
(`apps/architecture-studio/src/app/lab/vtt-brush`) is the roadmap's own
reference for that UX, but its data model predates `ADR-0022` and a full
port would be its own task. The buttons here cycle terrain cell index
1..3 (0 is the seeded cell) and offset each new wall further along X, purely
to prove the trigger wiring is real, not as a finished authoring UX.

## A real bug found and fixed during browser verification (2026-08-12)

Running `pnpm nx run vtt:dev` and dragging a node handle initially did
nothing — `SceneRenderPort.pick` always returned `undefined`, at every
screen position, for every layer. Traced (via a temporary debug build of
`@grafting/render-3d`, reverted before commit) to
`packages/render-3d/src/backend/three/create-backend.ts`'s `pick()`: its
probe camera is built fresh per call, outside the scene graph.
`camera.position.set(...)`/`camera.lookAt(...)` only touch the camera's
*local* transform — nothing else ever calls `updateMatrixWorld()` on this
probe (a normal render pass does that as a side effect of drawing the real
camera, which this one isn't). Every ray was therefore cast from the
identity transform — world origin, looking down -Z — regardless of the
camera descriptor passed in. Fixed with one line,
`camera.updateMatrixWorld(true)`, right after building the probe.

This was invisible to `render-3d`'s own test suite: that package's Node
tests have zero WebGL/DOM runtime coverage (only pure `buildVisual`-level
construction is tested), so nothing exercises `pick()` at all today. Adding
real coverage would mean bringing a jsdom/headless-GL dependency into that
package's test harness — out of scope for this task, flagged here for
whoever next touches picking.

Also bumped the node-handle sprite scale from `0.18` to `0.32`
(`apps/vtt/src/adapters/rendering/node-handle-scene-item.ts`) — precision
testing against the real fix showed `0.18` was an uncomfortably small
pointer target at the table's default camera distance.

## A known gap, not fixed here

**Dragging into space with no underlying pickable geometry doesn't move
anything.** `handlePointerMove` resolves the drag target from
`SceneRenderPort.pick`'s hit point; if the pointer strays off every
surface/handle (e.g. past the edge of the seeded map, into empty
background), `pick` returns `undefined` and the move is silently skipped
for that frame — the node stays at its last resolved position. This is a
direct consequence of reusing real-geometry raycasting instead of an
infinite ground plane (see the picking decision above), and is a reasonable
UX gap for a first slice: a table with more terrain coverage rarely hits it.
A ground-plane fallback (an invisible always-pickable plane at a fixed
world Y, or a plane through the drag's own start height) would close it,
but needs its own design pass — should the plane track camera height, node
height, or something else — not decided here.

## Non-goals carried forward

Delete/merge/split/duplicate node operations still have no feature/UI
wiring (`ConstructionSessionPort` already implements them — see 0004).
Click-to-place authoring for new geometry (vtt-brush-equivalent UX). Worker
boundary (still not required — see 0004). The two `E3.5`-era render bugs
0004 already documented (no lights, likely terrain axis mismatch) are
unrelated to this task and remain open.
