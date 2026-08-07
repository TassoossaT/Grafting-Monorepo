# ADR-0021: the 3D renderer becomes its own package, organized by capability

- Status: Proposed
- Decision owner: repository-owner
- Record: DEC-059
- Supersedes: None
- Related: ADR-0018 (DEC-056), ADR-0014 (DEC-052), ADR-0011 (DEC-049)

## Decision

The 3D renderer leaves `@grafting/ui` and becomes `@grafting/render-3d`, a
rendering engine package that owns Three.js privately. This amends DEC-056's
clause placing the 3D/heightfield renderer inside `@grafting/ui`; that
package's Rete-based graph canvas and its vendor-neutral public API are
otherwise unchanged.

`@grafting/render-3d` is organized by **capability**, never by product concept.
It MUST NOT contain a type, module, field, or special case named after a token,
character, wall, spell, fog, floor, or any other thing a product draws. Its
modules are the clock, the scene and its layers, the visual-kind registry,
animation, invalidation, and views; its renderer adapter is private to
`src/backend/`.

Everything drawable enters through a **visual kind registered from outside**,
described as plain data (`GeometryDescriptor` + `MaterialDescriptor`). This is
the package's only integration surface, and it is deliberately sufficient for a
separate package to define a product's concepts and hand over a populated
registry without either package importing the other.

Simulated time is separate from real time and lives in a clock the caller may
pause, rate-limit, or step by hand. Animation is defined as a function of
simulated progress, so real-time and turn-based consumers get identical
results from the same track.

`@grafting/ui` keeps `createHeightfieldCanvas` as a thin translation onto this
package — a boundary translation, not a second implementation (DEC-049).

## Context

The renderer was 119 lines inside a component library, and its shape was
already known to be wrong. `apps/vtt/notes/0001` recorded six defects found by
driving a real browser over CDP, four of which are properties of the renderer's
*contract* rather than bugs in its body:

1. re-render keyed on the whole document, so one node's movement redrew every
   viewport — thirteen re-uploads of an unchanged heightfield from dragging one
   unrelated control;
2. the renderer reported its own placements the same way it reported the user's,
   producing a feedback loop that froze the browser tab;
3. one Three.js context per rendered element, against a browser cap of roughly
   sixteen that is enforced by silently dropping the oldest;
4. no `resize`, so growing a viewport meant disposing and rebuilding the whole
   renderer.

A component library is the wrong owner for a boundary with those obligations.
Its performance budget, its testing needs (a real browser, not a unit test with
a faked context), and its rate of change are all different from a button's.

Organizing the new package by product concept was considered and rejected. The
concepts do not partition the work: a marker sliding across a surface and a
volume of water rippling in place are the same problem to a renderer and
different problems to a game; a wall and a stationary marker are the same
problem again. A `tokens/` module would draw a boundary exactly where the
renderer has no information to draw one, and every consumer that did not share
those concepts would have to work around them.

## Consequences

- **Benefit:** the four contract-level defects above are addressed by the API's
  shape rather than left to each consumer — layer-scoped invalidation, a
  `ChangeOrigin` on every mutation, one context with N views, and `resize` as a
  first-class operation. `FrameReport` makes the invalidation claim testable
  rather than asserted.
- **Benefit:** the engine is usable outside the VTT. Nothing in it knows what a
  tabletop is, and a turn-based consumer and a real-time consumer differ only
  by whether they call `clock.play()`.
- **Cost:** one more package, one more `api-check` baseline, and a workspace
  dependency edge from `@grafting/ui`.
- **Cost:** `@grafting/ui`'s shim still creates one engine per surface, so
  defect 3 is *addressable* but not yet *fixed* for existing consumers. Fixing
  it means `apps/architecture-studio` moving to one shared engine with many
  views, which is a separate change with its own browser-level evidence.
- **Risk and mitigation:** a data-only extension point cannot express every
  visual a product might want, and the pressure will be to add an escape hatch
  returning a renderer object. That would make the vendor public and undo
  DEC-049. Mitigation: extend the descriptor vocabulary instead; the package's
  `AGENTS.md` states this and `project.json`'s `forbiddenModules` enforces it.

## Evidence

- 16 tests in `packages/render-3d/tests/`, covering the claims that are
  testable without a browser: that a paused clock freezes simulated time while
  real time advances; that a track stepped once lands where the same track
  stepped frame-by-frame lands; that moving an item in one layer does not
  invalidate another; that every change carries its origin; that a batch
  notifies once; and that an externally registered kind needs nothing from the
  engine.
- `apps/vtt/notes/0001-rendering-and-propagation.md`, sections 1-4, is the
  source of the contract requirements.
- The engine body is deliberately not unit-tested. What matters about it is
  observable only in a real browser, and a test with a faked context would
  assert on intent — which is exactly how the six recorded defects survived
  passing tests.

## Migration or rollback

`@grafting/ui`'s public API is unchanged, so no consumer changes in this step.
The follow-up is `apps/architecture-studio` moving its four heightfield
surfaces onto one shared engine with per-panel views, verified by counting live
WebGL contexts in a real browser; that change deletes the shim.

Rollback is to restore the renderer body into
`packages/ui/src/canvas/heightfield/`, drop the workspace dependency, and
remove `packages/render-3d`. Nothing outside `@grafting/ui` depends on the new
package yet, which is what keeps that cheap.
