# VTT board foundation and camera navigation: current state and open-source candidates

- Status: research; candidates are not approved dependencies or tools
- Date: 2026-08-14
- Scope: the "board" (base ground/grid the player builds on) and the camera
  navigation layer that moves around it — not procedural wall/room/material
  generation, which `vtt-tiny-glade-open-source-ecosystem.md` already covers,
  and not GM-tool UX conventions, which
  `vtt-board-construction-mode-ui-references.md` already covers. This doc
  fills the gap between them: what exists in code today for the board/camera
  foundation, why it reads as rough, and what open-source code is actually
  relevant to fixing it.

## 1. What exists today, read directly from the code

### 1.1 There is no board

`apps/vtt`'s renderer has no ground plane, grid, or bounded reference surface
at all. `Render3dSceneAdapter` (`apps/vtt/src/adapters/rendering/render-3d-scene-adapter.ts`)
sets a solid background color (`0x07100f`) and configures one ambient +
one directional light; nothing else is drawn until the GM generates a terrain
cell or a wall. Before that first click, the view is an empty colored void
with no spatial reference at all — no grid to judge scale or distance
against, no visible boundary. "The board" the product concept implies does
not exist as its own layer; what's currently called a board is just whatever
construction geometry happens to have been generated so far, drawn edge to
edge with the void around it.

This matters more than it sounds: every reference surveyed in
`vtt-board-construction-mode-ui-references.md` (Townscaper, Tiny Glade, and
every 2D VTT) renders a persistent ground/grid the player orients against
before anything is built on it. SketchForge-3D (§2 below) does the same —
its `workplaneGrid.ts` computes a bounded grid of minor/major/axis/border
line coordinates that is present from the moment the editor loads. Building
that missing layer, independent of any camera work, is probably the single
highest-leverage fix available and does not require any new dependency —
see §5.

### 1.2 Camera navigation: a deliberately hand-rolled seam, with two concrete missing behaviors

`packages/render-3d/src/camera/orbit.ts` implements orbit/pan/zoom as pure
spherical-coordinate math (`OrbitState`, `orbitDrag`, `orbitPan`,
`orbitZoom`), attached to a DOM element via `attachOrbit`. Its own doc
comment states the design intent explicitly: it is written against the
package's own `setCamera` and plain numbers *specifically instead of* a
Three.js controls package, "because the engine's whole shape is that no
backend type crosses its boundary, and a controls package from the Three.js
ecosystem would reintroduce one *in the consumer*." This is not an oversight
— it is `VTT-ARCH-002`'s boundary rule applied to camera controls, and it is
tested separately from the DOM. Any recommendation below has to either
respect that boundary or make the trade-off of breaking it explicit.

`apps/vtt/src/features/navigate-camera/attach-camera-navigation.ts` wires
this up with one fixed scheme: right-button orbits, middle-button pans, and
`pivot: "cursor"` — orbiting re-centers on whatever is under the pointer at
drag-start, resolved via `SceneRenderPort.pick`. This is already the Tiny
Glade convention `vtt-board-construction-mode-ui-references.md` documents as
the more precise of the two pivot behaviors that doc found (vs. Townscaper's
fixed center pivot) — cursor-pivot orbit is **already implemented**, wired,
and correct. That is not part of what reads as "ruim" today.

Reading `orbit.ts` end to end, two real, concrete gaps stand out — both are
common, well-known reasons a hand orbit implementation feels stiff compared
to a polished editor, and both are absent from every code path:

1. **No damping/inertia.** `attachOrbit`'s `apply()` sets the camera
   synchronously on every `pointermove`/`wheel` event; there is no easing,
   no requestAnimationFrame-driven interpolation, no momentum after
   release. The camera snaps exactly to the input with no smoothing at all,
   which is the single most common source of a 3D camera feeling "cheap"
   or "bad" compared to tools like Tiny Glade, Townscaper, or SketchForge
   (all of which run on top of a damped/eased controller).
2. **Zoom is not cursor-centered.** `orbitZoom` only rescales `distance`
   from the existing `target` — it has no notion of the point under the
   pointer. Scrolling to zoom in always converges toward whatever the
   current orbit target is, not toward what the mouse is hovering over.
   `vtt-board-construction-mode-ui-references.md` lists cursor-centered
   zoom as a pattern recurring across Foundry, Owlbear Rodeo, Tiny Glade,
   and Townscaper — i.e. this is the norm being deviated from, not an edge
   case. See §5.2: this is fixable with zero new dependencies, because the
   `three` package already installed (`packages/render-3d/package.json`,
   `three@0.182.0`) ships this exact behavior for free in its own bundled
   `OrbitControls` (`this.zoomToCursor`, confirmed present in the installed
   version's source), it is just not replicated in the hand-rolled path.

Neither gap requires a new library; both are additive math inside
`orbit.ts`. No pinch/touch gesture handling exists either (only
`PointerEvent`-generic drag plus a `wheel` listener for zoom), which is a
smaller, separate gap for tablet/trackpad use.

### 1.3 Stack constraints this shapes every recommendation below

- Raw Three.js (`three@0.182.0`), no React Three Fiber, no `@react-three/*`
  ecosystem anywhere in the repo — confirmed via
  `packages/render-3d/package.json` and `apps/vtt/package.json`. This rules
  out `@react-three/drei`'s camera/gizmo helpers entirely; they only attach
  to an r3f scene graph, which does not exist here.
- ADR-0023's layering (`app -> composition -> widgets/features ->
  ports/entities -> adapters -> ui`, enforced by
  `apps/vtt/test/architecture-boundaries.test.mjs`) permits a direct
  `@grafting/*`/third-party import only from `adapters` or `ui`. A new
  camera or board dependency can only be called from
  `packages/render-3d/src/backend/three/` (already the layer that owns
  `THREE.*` types) or a new `apps/vtt/src/adapters/*` module — never from
  `composition`, `features`, or `app`.

## 2. SketchForge-3D — direct evaluation

[Formsmith746/SketchForge-3D](https://github.com/Formsmith746/SketchForge-3D)
— fetched directly (repo metadata, README, and source), not assumed.

| | |
| --- | --- |
| License | **GNU AGPLv3** |
| Stack | Next.js, React, TypeScript, Three.js, Manifold (CSG) |
| Activity | Created 2026-06-06, last push 2026-08-10, 844 stars — young (~2 months old) but actively maintained |
| What it is | A local-first, browser-based **CAD-style solid modeler**: primitive shapes (box/cylinder/sphere/cone/torus/text/roof/wedge/...), boolean solid/hole/intersection workflow, chamfer/fillet edge tools, STL import, STL/OBJ/STEP export. Ships as a self-hostable Next.js app (Docker/FabLab-oriented), not a library or npm package. |

**Verdict:** SketchForge is a real, actively-developed, well-scoped tool —
not a toy — but it is a mechanical-CAD part designer, not a board-game or
level-editing tool, and its "3D design editor" framing has essentially
nothing to do with VTT construction semantics (walls-with-doors,
rooms, graph-authoritative geometry). Its genuinely relevant part is exactly
the piece this doc is scoped to: `apps/web/src/components/WorkplaneViewport.tsx`
and `apps/web/src/lib/workplaneGrid.ts` implement the "real 3D workplane"
the README advertises — a bounded grid (minor/major/axis/border line
coordinates, theme-aware palette, computed in `interiorWorkplaneGridCoordinates`)
plus camera controls. Read directly: the camera controls are **stock
Three.js `OrbitControls`**, imported from `three/examples/jsm/controls/OrbitControls.js`
— not a custom implementation, not a separate npm dependency. There is
nothing exotic here to port.

**License is the deciding fact.** AGPLv3 is strong network copyleft: unlike
GPL, it triggers on running a modified version as a network service, not
only on distributing binaries — exactly what a hosted VTT product is. Taking
code from SketchForge (even a small grid-math function) and shipping it as
part of Grafting would put the AGPL's source-disclosure and same-license
obligations on the surrounding work in a way that is very unlikely to fit
this project's own licensing posture (the sibling ecosystem doc's shortlist
is uniformly MIT/Apache/BSD). **Recommended treatment: study only, as a
working reference for what a finished "workplane" UI looks like and how its
grid math is structured — do not copy code, do not add as a dependency.**
The useful takeaway is the *shape* of the solution (a persistent bounded
grid + stock OrbitControls), which is cheap to reimplement independently
under this repo's own license and architecture, not anything requiring the
AGPL source itself.

## 3. Camera-navigation candidates

| Candidate | License | Runtime/stack | What it contributes | Recommended treatment |
| --- | --- | --- | --- | --- |
| Three.js bundled `OrbitControls` (`three/examples/jsm/controls/OrbitControls.js`) | MIT (part of `three`, already installed) | Raw Three.js | Damping (`enableDamping`), built-in `zoomToCursor`, pan, confirmed present in the installed `three@0.182.0`. Zero new dependency — it ships inside the `three` package already in `packages/render-3d/package.json`. | **Reference only, do not adopt directly.** Swapping `attachOrbit` for this would resolve both gaps in §1.2 in an afternoon, but it means `THREE.Camera`/`THREE.OrbitControls` types cross into whatever module drives it — exactly what `orbit.ts`'s own doc comment says this codebase deliberately avoided. If adopted, it would have to live entirely inside `packages/render-3d/src/backend/three/`, wrapped so only plain numbers (`OrbitState`-shaped) cross the package boundary, same as today — i.e. re-implement `attachOrbit`'s public shape on top of `THREE.OrbitControls` internally, not replace it with a raw pass-through. |
| [`camera-controls`](https://github.com/yomotsu/camera-controls) (yomotsu) | MIT | Three.js peer dependency | Damped/animatable orbit-pan-zoom-dolly, `dollyToCursor`, collision/boundary support, actively maintained (2,423 stars, pushed 2026-02). The most complete of the "just drop it in" options. | **Not a fit as a direct dependency** given the same boundary concern as stock `OrbitControls`, and it's a *heavier* commitment (a whole external state machine with its own update-loop requirement) for gaps that are small, well-understood math. Worth reading its source for the cursor-dolly and damping algorithms as a reference if implementing them by hand (§5.2/5.3). |
| PlayCanvas Editor | Engine (PlayCanvas Engine) is MIT; the Editor itself is a hosted, closed-source product | N/A | Not actually open source as an editor — only the runtime engine is. | **Not a fit.** Excluded; verify before citing it anywhere else in this repo's docs. |
| [Three.js official editor](https://github.com/mrdoob/three.js/tree/dev/editor) (part of `mrdoob/three.js`) | MIT | Raw Three.js | Reference implementation of a scene-graph UI, transform gizmos (`TransformControls`), viewport grid helper (`THREE.GridHelper`/`THREE.InfiniteGridHelper` pattern), outliner. | **Study as reference** for gizmo/inspector interaction patterns if Epic 7's construction-editor foundation (E7.1, property inspector) needs a concrete UI precedent. Not a dependency — it's an application, not a package. |
| Babylon.js Inspector / gizmo system | Apache-2.0 | Babylon.js (a different engine entirely) | Mature gizmo/inspector/camera-bounds patterns. | **Reference only.** Adopting anything from it would mean evaluating a full engine swap away from Three.js, which is far outside this doc's scope and not something either sibling research doc raised. |
| Infinite-grid ground shader (common technique, e.g. the widely-shared ["The Best Darn Grid Shader (Yet)"](http://asliceofrendering.com/scene%20helper/2020/01/05/InfiniteGrid/) approach) | N/A — technique, not a library | Any WebGL/Three.js fragment shader | A camera-anchored fullscreen quad that fades grid lines by distance, giving an apparently infinite, always-in-scale reference plane with no fixed bounds and trivial GPU cost. | **Best fit for the board itself if an "infinite" board is wanted** (see §5.1's bounded-geometry alternative too). Small enough (a single fragment shader, well under 100 lines) to write directly inside `packages/render-3d`'s Three backend as a new visual kind, with no dependency and no license question at all — this is exactly the kind of "small enough that the seam is worth more than the saved lines" case `orbit.ts`'s own doc comment already argues for elsewhere in this same package. |

## 4. Why "merge an open-source editor" is the wrong frame, and what to do instead

The user's framing — find an open-source codebase to merge with what exists
— does not fit the actual gap once the code is read directly. Every
candidate surveyed above that does anything nontrivial for camera control
(SketchForge, camera-controls, Three's own OrbitControls) is, underneath,
the same handful of well-known techniques: spherical-coordinate orbit,
distance-scaled pan, damped interpolation, cursor-anchored dolly. Grafting
already has three of those four implemented correctly by hand, in a form
that respects this codebase's own architecture rule about not leaking
`THREE.*` types past the render-3d boundary — a rule that every off-the-shelf
controls library exists specifically to violate, because they're all written
assuming the caller already holds a `THREE.Camera`.

There is no board-and-navigation "editor" to merge in as a unit — Aedifex
(construction-editor UI, already tracked in the sibling ecosystem doc) is
the closest thing to that, and it is scoped to *wall/room* authoring, not
the camera/ground layer this doc is about. What's missing here is narrower
and cheaper than "merge an editor": one new render-3d visual (the ground
plane/grid, §5.1) and roughly two functions' worth of math added to an
already-correct file (§5.2, §5.3).

## 5. Recommended evaluation sequence

### 5.1 Board: add a ground-plane/grid visual to `packages/render-3d`

Add a new visual kind (or extend the existing `heightfieldVisual`'s
sibling API) for a bounded or camera-anchored reference plane, styled after
SketchForge's grid-math *shape* (minor/major/axis/border tiers,
theme-aware) but implemented independently under this repo's own code —
its `workplaneGrid.ts` is pure coordinate/palette math with no Three.js
coupling, cheap to write from scratch rather than port. Two implementation
options, in increasing cost:
- **Static bounded grid geometry** — line segments at fixed intervals, like
  SketchForge's approach. Simple, cheap, matches "board" as a literal
  bounded tabuleiro.
  Bounded meaning it is finite geometry (has walls the current level of interior lighting could reveal at range), not necessarily unable to be resized.
- **Camera-anchored infinite-grid shader** (§3's shader row) — a fullscreen
  quad fragment shader, fades with distance, no bounds to size or
  regenerate as the map grows.
Either belongs in `packages/render-3d/src/visual/` (new visual, generic,
matching how `heightfieldVisual` is already generic) with a thin
`apps/vtt/src/adapters/rendering/` call site, matching how map chunks are
already wired.

### 5.2 Camera: cursor-centered zoom

Extend `orbitZoom` (or add a sibling function) to take the resolved cursor
world-point (already available via the same `resolvePivot` callback
`attachOrbit` uses for `pivot: "cursor"`) and re-derive `target` so that
point stays fixed on screen while `distance` changes — the same effect as
`THREE.OrbitControls.zoomToCursor` or `camera-controls`' `dollyToCursor`,
implemented as pure `OrbitState` math consistent with the rest of the file.
No new dependency; reading either reference implementation's algorithm
(§3) first would save re-deriving it from scratch.

### 5.3 Camera: damping/inertia

Add an optional eased-interpolation layer to `attachOrbit`: instead of
`apply()` setting the camera synchronously to `state`, drive a
`requestAnimationFrame` loop that lerps a rendered `OrbitState` toward the
input-driven target state, plus simple velocity decay after
`pointerup` so a fast drag-release keeps drifting briefly. This is the
single change most likely to make the camera stop feeling "ruim" on its
own — every reference tool surveyed across both sibling docs and this one
has some form of it, and none of Grafting's current code does.

### 5.4 Sequencing

5.1 (board) has no dependency on 5.2/5.3 and is the most visible fix per
effort spent — do it first. 5.2 and 5.3 both touch `orbit.ts`/`attachOrbit`
and are easiest done together as one pass, verified live in the browser per
this project's own "browser-verify before calling it done" convention
(`apps/vtt/notes/000*`).

## 6. Sources

- [SketchForge-3D repository](https://github.com/Formsmith746/SketchForge-3D)
- [SketchForge-3D README](https://github.com/Formsmith746/SketchForge-3D/blob/main/README.md)
- [SketchForge-3D `workplaneGrid.ts`](https://github.com/Formsmith746/SketchForge-3D/blob/main/apps/web/src/lib/workplaneGrid.ts)
- [SketchForge-3D `WorkplaneViewport.tsx`](https://github.com/Formsmith746/SketchForge-3D/blob/main/apps/web/src/components/WorkplaneViewport.tsx)
- [GNU AGPLv3 license text](https://www.gnu.org/licenses/agpl-3.0.html)
- [yomotsu/camera-controls](https://github.com/yomotsu/camera-controls)
- [Three.js `OrbitControls` source (r182, matching this repo's installed `three@0.182.0`)](https://github.com/mrdoob/three.js/blob/r182/examples/jsm/controls/OrbitControls.js)
- [Three.js official editor](https://github.com/mrdoob/three.js/tree/dev/editor)
- [PlayCanvas Engine (MIT) vs. PlayCanvas Editor (hosted, closed) — PlayCanvas Engine repository](https://github.com/playcanvas/engine)
- [Babylon.js repository](https://github.com/BabylonJS/Babylon.js)
- ["The Best Darn Grid Shader (Yet)" — infinite grid shader technique reference](http://asliceofrendering.com/scene%20helper/2020/01/05/InfiniteGrid/)
- This repo: `packages/render-3d/src/camera/orbit.ts`, `apps/vtt/src/features/navigate-camera/attach-camera-navigation.ts`, `apps/vtt/src/adapters/rendering/render-3d-scene-adapter.ts`, `apps/vtt/src/ports/scene-render-port.ts`, `docs/research/vtt-board-construction-mode-ui-references.md`, `docs/research/vtt-tiny-glade-open-source-ecosystem.md`
