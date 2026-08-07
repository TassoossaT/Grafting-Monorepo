# `@grafting/render-3d`: engine libraries and prior art

- Recorded: 2026-08-07
- Status: research only — nothing here is adopted, and no manifest changed
- Scope: libraries and techniques that could be merged **into the rendering
  engine package**, plus prior art that judges its current design
- Package under evaluation: `packages/render-3d` (ADR-0021 / DEC-059, PR #45)

## Why this is a separate document

`vtt-map-and-terrain-construction-options.md` covers what the VTT's map
*product* needs and settled its rendering architecture: one renderer, Three.js,
no second rendering library, deck.gl demoted to a technique reference. This
document is a level below that — it is about the **internals of the engine
package**, and every candidate in it is a Three.js-native helper rather than a
rival renderer. Nothing here reopens that decision; if anything, several
candidates are the concrete way to build capabilities that document already
listed as "custom, no ready-made equivalent found".

## The finding that challenges the current implementation

`@grafting/render-3d` renders into a shared off-screen buffer and copies each
view's region into a per-view 2D canvas with `drawImage`. The three.js manual
describes exactly these two options and recommends the other one.

| | What the package does today | What the manual recommends |
| --- | --- | --- |
| Technique | off-screen render → `drawImage` per view | one canvas fixed behind the page, `setScissor`/`setViewport` per element region |
| Per-frame cost | **copies pixel data for every view** | no copy |
| Layout freedom | each view is an ordinary DOM canvas, composable anywhere | full-viewport canvas behind the document; z-order and compositing constrained |
| Path to a Worker | opens the door to `OffscreenCanvas` | not discussed |

Source: <https://threejs.org/manual/en/multiple-scenes.html>, which states the
copying approach is "slower" and that speed "depends on browser and GPU".

**This is not settled either way.** The manual optimizes for the common case;
this package's consumers include a panel-based bench where views are ordinary
elements in a grid layout, which is the case the copying approach exists for.
What the finding establishes is that the copy has a real, measurable cost that
was never measured here.

The package's `src/backend/contract.ts` seam is where a second presentation
strategy would plug in, without touching the engine, the scene, or any
consumer. A `/lab` trial measuring both under the same content is the way to
decide, not argument.

**Correction to record:** the package's source comments and README state the
browser limit on live WebGL contexts as "commonly around sixteen". Both primary
sources say **~8** — <https://webglfundamentals.org/webgl/lessons/webgl-multiple-views.html>
and the three.js manual above. The one-context argument is stronger with the
correct number, not weaker.

## Candidates

| Candidate | License | Status | What it would replace or enable |
| --- | --- | --- | --- |
| three-mesh-bvh | MIT | Standby — first pick | Accelerated picking, plus line-of-sight, fog of war, and area templates from one dependency |
| camera-controls | MIT | Standby — second pick | Camera interaction, which the package has none of |
| `@three.ez/instanced-mesh` | MIT | Standby | Many repeated objects with per-instance culling and LOD |
| `BatchedMesh` | — (three.js core) | Standby | Many *differing* geometries sharing a material, one draw call |
| postprocessing (pmndrs) | **Zlib** | Standby — needs license review | Selection outlines and the "dark vision" masking effect |
| miniplex / bitECS | MIT | Reference only | Prior art for composing by capability; no consumer exists yet |

### three-mesh-bvh — the strongest finding

<https://github.com/gkjohnson/three-mesh-bvh>, MIT. A bounding-volume hierarchy
for three.js geometry. Its own benchmark: 500 rays against an 80,000-polygon
model at 60fps.

The package's `pick()` currently uses a plain `Raycaster`, which walks triangles.
On a map-sized terrain mesh every click and every hover pays that.

Picking is not the reason to adopt it. The reason is that the **same library
supplies geometric primitives this product would otherwise hand-write**:

| Capability | three-mesh-bvh feature |
| --- | --- |
| Line of sight, fog of war | `shapecast` — caller-driven traversal of the hierarchy |
| Area of effect, auras, spell templates | sphere intersection queries |
| Movement range, snapping | distance and closest-point queries |

`vtt-map-and-terrain-construction-options.md` already lists route/polygon
editing as needing `Raycaster` as its "necessary building block", and the
limited-visibility effect as custom work. This is the acceleration structure
under both.

**Isolation concern (DEC-049).** The idiomatic setup assigns
`Mesh.prototype.raycast = acceleratedRaycast` — a **global prototype mutation**,
visible to every other consumer of three.js in the workspace. The library also
allows calling the BVH directly without patching, which is what this repository
would have to do. Either way it belongs inside `src/backend/three/` and must not
appear in any public contract.

**Documented limitations:** the hierarchy is not dynamic — morph targets and
skinning need workarounds, and geometry changes require regenerating or
refitting the tree. Large geometries should be centered first, for float
precision. Both matter for a deforming terrain and should be measured before
adoption.

### camera-controls — the cleanest fit

<https://github.com/yomotsu/camera-controls>, MIT. Orbit, truck, dolly, zoom,
`fitToBox`, damping, smooth transitions, boundary constraints, collision
detection.

The engine has **no camera interaction at all** today; the heightfield shim's
auto-rotation is an animation standing in for one.

What makes this the right library rather than merely a good one is that it
already thinks in terms of on-demand rendering. Its `update(delta)` "returns
true if re-rendering is needed", and it emits `wake`, `rest`, and `sleep`
events. That composes directly with this package's invalidation model:

```ts
if (controls.update(delta)) view.invalidate();
```

Most camera libraries assume a renderer that redraws unconditionally, and
integrating one of those would mean either redrawing every frame or inferring
camera movement by comparison.

### `@three.ez/instanced-mesh` (InstancedMesh2)

<https://github.com/agargaro/instanced-mesh>, MIT, published as
`@three.ez/instanced-mesh`. `InstancedMesh` with per-instance frustum culling,
BVH-accelerated raycasting, LOD, sorting, and per-instance visibility, opacity,
and uniforms.

It would enter as an additional **visual kind** — a "many of these" kind — not
as a replacement for the one-object-per-item model. The author's own caveat is
that maintaining the BVH is expensive for instances that move constantly, so it
suits walls, vegetation, and props better than actively moving markers.

### `BatchedMesh`

Part of three.js core, so no new dependency. `InstancedMesh` requires one shared
geometry; `BatchedMesh` combines **different** geometries sharing a material
into a single draw call. Walls, furniture, and scenery fit this shape better
than instancing. Worth reaching for before adding any dependency at all.

### postprocessing (pmndrs) — flagged for license review

<https://github.com/pmndrs/postprocessing>. Its `OutlineEffect` is the
selection highlight every tabletop needs, and the same pass system is where the
"dark vision" masking effect from the map document would live.

**Licensed Zlib, not MIT** — the only non-MIT candidate here. Permissive, but it
is exactly the case the master source's rule 2.6 reserves a license, provenance,
and security review for, and it would need a `THIRD_PARTY_NOTICES.md` entry.

## Prior art that judges the design

These are not dependencies. They are the existing answers to problems this
package already solved one way, and each one either confirms or challenges that
answer.

### react-three-fiber's `frameloop="demand"` — confirms, with a warning

<https://r3f.docs.pmnd.rs/advanced/scaling-performance>. The same idea as this
package's invalidation: draw only when something changed, with an explicit
`invalidate()` for changes the system cannot observe.

The warning is the valuable part. Their documented failure mode is that
anything mutating state outside the framework's knowledge — camera controls
reaching into the camera being the canonical example — leaves a stale frame on
screen. **This package has the identical hazard**: nothing that mutates outside
`scene` marks anything dirty. That belongs in the package's contract as a stated
obligation, not discovered later by someone whose view stopped updating.

### "Fix Your Timestep!" — challenges the clock's clamp

<https://gafferongames.com/post/fix_your_timestep/>. The canonical treatment of
game-loop timing. Its accumulator **preserves** leftover time and consumes it in
fixed steps; this package's clock **discards** simulated time beyond 250ms per
frame.

Discarding is defensible while authoritative state arrives from the network, as
DEC-013's replication model intends. It stops being defensible if local
determinism ever matters, which ADR-0004 (DEC-044) cares about. The clamp is
covered by a test precisely so that swapping it for an accumulator is a
deliberate act rather than a silent drift.

### miniplex and bitECS — name what the package already is

<https://github.com/hmans/miniplex> and <https://github.com/NateTheGreatt/bitECS>,
both MIT.

The owner's stated requirement — decompose by generic function, because a token
may need the same treatment as a wall, and a spell the same treatment as water —
is Entity-Component-System. That is ECS's founding argument: compose by
capability rather than inherit by entity type. This package's `SceneItem` plus
its externally registered visual kind is a degenerate ECS with a single
component.

**Not a candidate for adoption.** If tabletop concepts later need to compose
*behaviour* rather than only appearance, miniplex is the gentle option — it
requires no upfront component declaration and imposes no scheduler, which is
what would let it sit beside this engine's own frame loop rather than fight it.
The repository's own rule is that a generic package needs a real consumer, and
that consumer does not exist yet.

## Product references — informative, not reusable

**skyloutyr/VTT** — <https://github.com/skyloutyr/VTT>, MIT, but C#/.NET with
OpenGL 3.3 and Windows desktop. No reusable code. Its value is as an honest
scope marker for a 3D tabletop: real-time dynamic shadows for a sun plus 16
lights with hundreds of additional cheap lights, fog of war in both 3D and 2D, a
visual particle-system editor, node-graph shaders, and skeletal animation.

**gTove** — <https://github.com/RobRendell/gTove>, MIT, React and TypeScript,
web, 3D. The closest web analogue. Its most useful design decision:
**fog of war is tied to the grid** — a map with no defined grid cannot have
parts hidden from players. That constraint simplifies the implementation
enormously and is worth deciding early rather than discovering late.

## Rejected

The general-purpose "Three.js game engines" on GitHub —
[three-game-engine](https://github.com/WesUnwin/three-game-engine),
[the-world-engine.ts](https://github.com/The-World-Space/the-world-engine.ts),
[three.gf](https://github.com/freddykrunn/three.gf) — are Unity-style,
**entity-typed**, and bring their own scene and loop. Adopting any of them means
replacing the capability-based decomposition the owner specified, not adding to
it. Worth reading; not worth depending on.

## Recommended sequence

1. **Measure before adopting anything.** A `/lab` trial comparing the two
   presentation strategies under identical content decides the `drawImage`
   question, and the same harness measures everything below.
2. **three-mesh-bvh**, because it unlocks picking, line of sight, and area
   templates together, and because the alternative is writing three spatial
   algorithms by hand.
3. **camera-controls**, because there is no camera interaction at all and its
   `update()` contract already matches this engine's invalidation model.
4. **`BatchedMesh` before any instancing dependency** — it is already in core.
5. Everything else after a real consumer exists.

## Follow-up status

- Nothing adopted. No manifest, lockfile, or dependency changed by this
  document.
- The `drawImage` finding and the "~16 contexts" correction apply to code
  already committed on PR #45 and are not yet fixed there.
- Every candidate above, if adopted, is confined to `src/backend/` under the
  package's own `AGENTS.md` rule and DEC-049.
