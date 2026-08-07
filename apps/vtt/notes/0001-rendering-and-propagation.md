# Note 0001 — Rendering and propagation debt carried from the node bench

- Recorded: 2026-08-06
- Status: open, to be resolved before the VTT renders anything real
- Source: defects found and fixed while building `/lab` in `apps/architecture-studio`
  (DEC-057, PRs #33, #37, #39, #41, #43)

The bench works, and every defect below is fixed *there*. They are recorded
because each one came from a design choice that would reappear in the VTT, at a
scale where the same mistake stops being a flicker and starts being unusable.

## 1. Re-render was keyed on the wrong thing

Dragging any node committed a new graph object on every pointer move, and the
effect refreshing viewport nodes depended on that object. Every viewport
redrew on every pointer move of every node. Measured: dragging one unrelated
control produced thirteen re-uploads of an unchanged heightfield.

Fixed by keying evaluation on a content summary that excludes position and
size, and by comparing each preview by identity before redrawing.

**For the VTT:** a map with tokens, fog, and lighting will have far more state
changing far more often, and most of it cannot affect most of what is drawn.
Decide up front what each renderer actually depends on, and make that
dependency explicit rather than "the whole document changed". Position of one
token must not be able to invalidate terrain.

## 2. Programmatic and user-initiated changes were indistinguishable

Two separate bugs, both from the same root: the renderer reports its own
actions the same way it reports the user's.

- The canvas reported the adapter's own node translations as user movement.
  The consumer recorded a move, re-rendered, translated again — an unbreakable
  loop that froze the browser tab outright.
- A node is rendered at the origin before being moved to its coordinates, and
  that intermediate position was recorded as a user move, so every node after
  the first landed on the origin.

Fixed by withholding a reported position that matches what the caller already
supplied, and by suppressing reports while the adapter is placing a node.

**For the VTT:** authoritative state will arrive from the network as well as
from the local user. Three sources, not two. A change needs to carry its
origin from the start; retrofitting "was this me?" is where both bugs came
from.

## 3. One renderer per node does not scale

Each viewport node creates its own Three.js context via
`createHeightfieldCanvas`. Browsers cap live WebGL contexts — commonly around
sixteen — and silently drop the oldest past the limit.

Fine for a bench with two or three viewports. **Not** fine for a VTT map with
many rendered elements.

**For the VTT:** one renderer, many views into it, or an explicit pool. Decide
before the count grows, because the failure mode is contexts vanishing rather
than an error.

## 4. The renderer cannot resize

`HeightfieldCanvas` fixes both its grid and its pixel size at creation and
exposes only `update(values)`. Resizing a node therefore means disposing and
recreating the whole renderer, which is why growing a viewport had to be
throttled to one rebuild per frame.

**For the VTT:** a resize is routine — window, panel, zoom. The renderer
contract needs `resize(width, height)` from the beginning, not a rebuild.

## 5. Evaluation results cross a worker boundary as copies

The bench keeps whole grids inside the worker and transfers only the previews
the surface asked for, which is right. But each preview is a fresh
`Float32Array` per pass, transferred and then discarded.

**For the VTT:** at map scale this becomes real allocation churn. Consider
reusing buffers across passes, or `SharedArrayBuffer` where the headers allow
it, and measure before choosing.

## 6. Node position commits state on every pointer move

Still true in the bench, deliberately: it costs nothing visible now that
nothing downstream reacts to it. It is recorded because "commit on every
pointer event" is a habit that will not survive an authoritative, replicated
document.

**For the VTT:** dragging is a local, uncommitted gesture until it ends.

## What made these findable

None of this was found by reading code or running unit tests — all six passed
throughout. They were found by driving a real browser over CDP and counting
what actually happened. See the repository's note on that harness; whatever
the VTT does for rendering, it needs the same ability to assert on real
behaviour rather than on intent.
