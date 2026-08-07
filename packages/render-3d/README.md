# `@grafting/render-3d`

A generic 3D rendering engine. It draws things and has no idea what they mean.

## Why it is not organized by what things are

There is deliberately no `token`, no `wall`, no `spell`, and no `water` in this
package — not as a type, not as a module, not as a special case.

Those are product concepts, and the reason they do not belong here is that they
do not partition the work cleanly. A marker sliding across a surface and a
volume of water rippling in place are the same problem to a renderer and
completely different problems to a game; a wall and a stationary marker are the
same problem again. Modelling by product concept would create a boundary in the
one place the renderer has no information to draw it, and every product that
did not share those concepts would have to work around them.

So the package is organized by **capability** instead. Each of the following is
usable on its own, and each is unaware of the others' product meaning:

| Module | Capability |
| ------ | ---------- |
| `clock/` | Simulated time, separate from real time. Pause, rate, and explicit stepping. |
| `scene/` | Items placed in space, grouped into caller-named layers, every change carrying its origin. |
| `visual/` | The registry of externally-supplied drawable kinds. |
| `animation/` | Time-driven writers into the scene, defined as a function of progress. |
| `invalidation/` | What changed since the last frame, and therefore what must be redrawn. |
| `engine/` | One graphics context, one world, many views. |
| `backend/three/` | The private renderer adapter. The only place `three` is imported. |

## The extension point

The engine draws only what a registered visual kind describes. Registering one
is the entire integration surface:

```ts
const registry = createVisualRegistry();

registry.register({
  kind: "wall-segment",
  describe: (params) => ({
    geometry: { shape: "box", width: params.length, height: 3, depth: 0.2 },
    material: { surface: "lit", color: 0x8a8a8a },
  }),
});
```

Descriptors are plain data. That is what lets a completely separate package
define its own concepts and hand a populated registry over, without either
package importing the other and without the renderer leaking into either one.
Two kinds that happen to draw identically share a descriptor and cost nothing
extra; two kinds that mean entirely different things to a product are still
just two entries.

## Time, pausing, and turns

Nothing time-driven reads a real clock. Animation is defined as a function of
simulated progress, so a track cannot tell whether its progress arrived as
sixty real-time frames or as one deliberate step:

```ts
// Real-time product.
engine.start();

// Turn-based product: never plays, resolves a turn as one step.
const engine = createEngine({ autoplay: false });
engine.clock.advance(1000);
```

Both produce identical results. This is verified by a test, not by convention.

## Views, not canvases

An engine owns exactly one graphics context. A view is a camera onto the scene,
presented into its own surface.

Browsers cap live WebGL contexts — commonly around sixteen — and enforce the
cap by silently dropping the oldest, so a design that spends a context per
rendered element does not fail with an error, it fails by having things vanish.
Views share the engine's single context, so how many can be open at once is
bounded by memory. `view.resize(width, height)` is a first-class operation
rather than a reason to tear anything down.

## What is redrawn

Layers are the unit of invalidation as well as of ordering. A view redraws only
when it changed itself, or when a layer it actually draws changed. Moving one
item cannot force a view that does not show that item's layer to redraw.

`engine.frame(realNow)` returns a `FrameReport` with views drawn, views
skipped, and visuals rebuilt — so this can be asserted on rather than assumed.

## Testing

`tests/` covers the parts that hold no graphics state: the clock, the scene,
invalidation, animation, and the registry. These run in plain Node with no
browser.

The engine itself is not covered there, on purpose. What matters about it —
that a view is genuinely skipped, that contexts are not being leaked — is
observable only in a real browser, and the repository has a headless
Chrome/CDP harness for exactly that kind of assertion. A unit test with a
faked context would assert on intent rather than on behaviour, which is
precisely the failure mode recorded in `apps/vtt/notes/0001`.
