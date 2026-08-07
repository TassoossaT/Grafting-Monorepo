# AGENTS.md — `@grafting/render-3d`

Scope-local addendum to the root `AGENTS.md`.

## What must not enter this package

- **No product concept.** No type, module, field, or special case named after a
  token, character, wall, spell, fog, water, floor, or any other thing a
  product draws. If something can only be described by naming what a consumer
  is building, it belongs to the consumer. Add a generic capability and let the
  consumer name it.
- **No renderer type in the public API.** `three` may be imported only under
  `src/backend/`, and only behind `src/backend/contract.ts`. No `THREE.*` type
  appears in `src/contracts/`, in `src/engine/`, in `src/index.ts`, or in any
  signature reachable from them (DEC-049).

  Three things enforce this, and none of them may be weakened to make a change
  compile: `project.json`'s `forbiddenModules`, the `api-check` target, and
  `tests/backend-isolation.test.mjs`. The test exists because the first two are
  blind to an internal module — this rule was broken by `src/engine/` itself
  and nothing caught it.
- **No visual identity.** Colors, sizes, easing curves, and lighting rigs are
  supplied by the consumer. Anything shipped here is a replaceable default with
  a neutral value, never a product's look (DEC-052).
- **No graph computation.** Layout mathematics, ordering, and graph algorithms
  belong to `grafting-graph-core` (DEC-051). This package places what it is
  told to place.
- **No second time source.** Nothing here may call `performance.now`,
  `Date.now`, or drive itself from `requestAnimationFrame` except the engine's
  own loop. Everything time-driven takes its interval from the clock, which is
  what makes pause and turn-stepping work at all.

## When adding a capability

Ask whether two unrelated products would both want it. A regular grid of
elevation samples passes: it is terrain, a fluid surface, a deformation field,
and a heatmap. "A creature marker" does not — that is a visual kind the
consumer registers.

Prefer extending the descriptor vocabulary (`GeometryDescriptor`,
`MaterialDescriptor`, `LightDescriptor`) over adding an escape hatch that hands
a renderer object to the caller. The descriptors exist so the renderer stays
replaceable.

## Invalidation is behaviour, not an optimization

Any change that makes something redraw more often than it must is a defect,
not a performance nit — see `apps/vtt/notes/0001`, sections 1 and 3, for what
this cost when it was got wrong. `FrameReport` exists so the claim can be
tested; assert on it when changing anything in `src/invalidation/` or the
frame body of `src/engine/`.
