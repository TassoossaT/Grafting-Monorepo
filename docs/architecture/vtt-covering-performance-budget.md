# Performance budget for surface covering and assets

- Plan date: 2026-08-21
- Status: **proposed budget, uncommitted.** No decision is closed here. The
  numbers below are targets to measure against, not measurements.
- Companion to `vtt-surface-covering-transformation-plan.md`,
  `vtt-covering-contracts.md`, and `asset-store-package-design.md`.
- Standard this follows: the repository's own Definition of Done already
  requires, for performance work, a "benchmark attached; comparable baseline;
  hardware and versions recorded; the result is not based on an irrelevant
  microbenchmark" (`docs/DEFINITION_OF_DONE.md`).

## 1. What already exists — do not rebuild it

Three things are already in place and this document extends them rather than
inventing a parallel system.

**A frame threshold, already measured.**
`docs/benchmarks/vtt-surface-mesh-recomputation-2026-08-12.md` established
**1.67 ms per brush stroke** — 10% of a 60 fps frame — "leaving the rest for
rendering, Wasm transfer, and UI work." It measured the current quad
generators at 116–351 µs per stroke, roughly **6.9× below** that threshold,
with about 64 surfaces invalidated per stroke *independent of total map size*
(the reverse index makes cost track what changed, not how much exists).

That headroom is the budget this feature spends. It is not free space.

**Frame instrumentation.** `@grafting/render-3d` exposes `FrameReport`
(`viewsDrawn`, `viewsSkipped`, `visualsRebuilt`, `contextLost`) after every
frame. The package's own `AGENTS.md` is explicit that "any change that makes
something redraw more often than it must is a defect, not a performance nit"
and that `FrameReport` exists so the claim is testable.

**A required-observability contract.**
`vtt-rendering-runtime-contract.md` §9 already mandates counters for render
scheduled/completed, **resource upload (layer, scope, revision, bytes)**,
renderer lifecycle, and buffer lifecycle. Asset and placement work slots into
those existing signals; it does not need new telemetry vocabulary.

## 2. The scale this feature actually operates at

Performance intuition fails here without arithmetic, so here is the arithmetic.
A brick of 20 × 10 cm with a 1 cm joint, on a 4 m × 3 m wall:

- along the wall: 4 / 0.21 ≈ **19 per course**
- up the wall: 3 / 0.11 ≈ **27 courses**
- **≈ 513 placements for one wall**

Extending that:

| Scene | Placements | Instance buffer @ 40 B (T+R+S) |
| --- | ---: | ---: |
| one wall | ~513 | ~20 KB |
| one 5×5 m room, 4 walls | ~2,600 | ~104 KB |
| a six-room house | ~15,000 | ~600 KB |
| fifty structures | ~750,000 | ~30 MB |

Two things follow immediately.

**The data volume is fine.** 30 MB of instance data for a large map is
comfortable in VRAM, and 40 bytes per placement is why §3.3 of the contracts
document chose separate T/R/S arrays over 64-byte `mat4`.

**The recomputation volume is not obviously fine.** The existing benchmark's
64-surfaces-per-stroke becomes 64 × ~513 ≈ **32,000 placements recomputed per
brush stroke**. Fitting that in 1.67 ms means ~52 ns per placement, including
the polygon coverage test, the transform, and the variant draw. That is
plausible in Rust and *not* plausible once Wasm transfer and GPU upload are
added on top.

This single number is why §4 exists.

## 3. Proposed frame budget

Sixteen point seven milliseconds, allocated:

| Stage | Budget | Notes |
| --- | ---: | --- |
| graph edit + surface mesh derivation | 1.67 ms | already measured, already met |
| covering resolution + placement plan | 2.0 ms | new; §4 keeps this off the drag path |
| Wasm transfer | 1.0 ms | new; the JSON blocker (§5) |
| GPU upload | 1.0 ms | new; per dirty chunk only |
| render + UI | ~11 ms | everything else |

Budgets are per *frame during interaction*. Bulk operations (opening a map,
generating a district) are explicitly a different budget with a different
acceptance target — the existing benchmark already separates these, recording
6.567 s of construction time for a 1M-surface map as a load-time concern
rather than a frame-time failure.

## 4. The one design decision that matters most

**Do not compute the full dressing during a drag.**

The repository already has the mechanism: `vtt-rendering-runtime-contract.md`
§8 defines a pointer gesture transaction, and `ADR-0023` requires that "gesture
completion submits exactly one operation; cancellation submits none." High
frequency preview is already separated from confirmed state by design.

Applied here:

| Phase | What runs | Cost |
| --- | --- | --- |
| during drag | region geometry updates; covering shows a cheap preview — the region outline, or a coarse low-density placement | within the existing 1.67 ms |
| on commit | full placement plan for the affected chunks only | one-time, off the per-frame path |

This converts the 32,000-placements-per-stroke problem into a
32,000-placements-once problem, and it costs nothing to adopt because the
gesture boundary already exists. Getting this wrong — dressing on every pointer
move — is the single most likely way this feature becomes unusable, and no
amount of later optimization recovers from it.

## 5. Known costs, with the lever for each

### 5.1 Wasm transfer — the identified blocker

Everything crosses as a JSON string today (`construction-wasm`'s `editing.rs`;
the adapter reads positions as `readonly number[]` then converts with
`Float32Array.from`). At 32,000 placements × 10 floats, that is 320,000 numbers
through `JSON.parse` per rebuild. This will not fit the 1.0 ms budget by any
margin.

**Lever:** typed-array views over Wasm memory for the numeric buffers, JSON
retained for the small structural envelope. Because transport is not contract
(`vtt-covering-contracts.md` rule 4), this changes one adapter.

### 5.2 Draw calls — a cost this design introduces

Phase 2 of the transformation plan re-keys chunks from `spatialBucket` to
`(spatialBucket × coveringKey)`. That is correct for classification, and it
**multiplies chunk count by the number of distinct coverings present**. One
hundred spatial buckets across five coverings is 500 draw calls where there
were 100.

This is a real trade-off introduced by the design, not an incidental detail.

**Levers, in order of preference:** size chunks by measured draw-call cost
rather than by spatial intuition; group by covering first and bucket second so
a covering used everywhere does not fragment; merge single-member chunks.

**Signal to watch:** draw calls per frame, which is not in `FrameReport` today
(§6).

### 5.3 Texture memory

A 2048² RGBA texture is 16 MB in VRAM regardless of file size
(`docs/research/asset-management-prior-art.md` §1). Forty of them is 640 MB —
enough to fail on a laptop GPU.

**Levers:** the asset store's refcount and disposal (the whole reason it
exists); a working VRAM ceiling stated as a number; KTX2/Basis for a measured
4–8× reduction when the ceiling is actually hit — which is why
`ImageResource` was left open to compressed form.

### 5.4 Redundant redraw

**Lever:** already built. `FrameReport.visualsRebuilt` and `viewsSkipped` make
over-redraw testable, and the render-3d `AGENTS.md` already classifies
regressions here as defects.

### 5.5 Load time

Distinct budget, distinct target. The existing benchmark's 6.567 s for a 1M
map is the precedent for treating this separately.

**Levers:** progressive/deferred dressing (regions first, coverings after),
and the asset store's per-`(ref, revision)` load deduplication.

## 6. What is missing from instrumentation

Everything in `vtt-rendering-runtime-contract.md` §9 stays. Three signals this
feature needs that are not there yet:

| Signal | Fields | Why |
| --- | --- | --- |
| draw calls per frame | count, by layer | the §5.2 cost is otherwise invisible |
| placement plan computed | surface count, placement count, duration, cause | separates plan cost from transfer and upload |
| asset store inventory | per ref: state, holders, revision, bytes | leak detection; already designed as `inventory()` |

`FrameReport` is the natural home for the first. The other two are app-level
and fit the existing §9 table's shape.

## 7. Reference scenes

A benchmark against a trivial scene proves nothing — the Definition of Done's
"not based on an irrelevant microbenchmark" clause exists for this. Three
fixed scenes, versioned with the benchmark:

1. **One wall with a door** — ~500 placements. The correctness case: shared
   pattern frame across sibling surfaces around the opening.
2. **A six-room house** — ~15,000 placements. The interaction case: drag a node
   and measure only the affected chunks rebuilding.
3. **Fifty structures on terrain** — ~750,000 placements. The scale case:
   draw calls, VRAM, and culling behavior as the camera moves.

Scene 2 is the one that decides whether the feature is usable. Scene 3 is the
one that decides chunk size and LOD thresholds.

## 8. Method

Follow the existing benchmark document's structure exactly — Question and
threshold → Method → Representative result → Disposition → Caveats — because
it already produces reviewable evidence and a decision, not just numbers.

1. State the threshold **before** measuring. A measurement without a
   pre-declared threshold rationalizes whatever it finds.
2. Measure in Rust natively *and* through Wasm. The existing benchmark used a
   non-shipped `examples/` harness in `libs/graph/core`; the same pattern
   applies to the dressing crate.
3. Measure in the browser for anything involving draw calls, upload, or VRAM.
   Native Rust timings say nothing about those.
4. Record hardware and versions (Definition of Done).
5. Write a **Disposition** — what the numbers decided. The surface-mesh
   benchmark's disposition ("no mesh cache is justified") is the model: it
   closed a design question rather than filing numbers.

## 9. Order of work

Measure before optimizing, but not in a fixed order — measure the thing whose
answer changes the design:

1. **Placement plan cost in native Rust** (scene 2). If this misses budget, the
   layout algorithm changes and nothing downstream matters yet.
2. **Wasm transfer** (§5.1). Known blocker; measure JSON to quantify it, then
   the typed-array path to confirm the fix.
3. **Draw calls vs. chunk size** (scene 3). Decides chunk sizing, which is a
   contract-visible parameter.
4. **VRAM under realistic texture counts** (scene 3). Decides whether KTX2 is
   V1 or deferred.
5. **LOD thresholds** (scene 3). Last, because it optimizes a path that must
   first work correctly.

## 10. Open decisions

1. **Frame budget split (§3)** — the 2.0/1.0/1.0 ms allocation is an educated
   guess, not a measurement. First benchmark should confirm or redistribute it.
2. **Target hardware.** "60 fps" is meaningless without saying on what. A
   stated minimum machine turns every budget above into a real pass/fail.
3. **Chunk size.** Deliberately unset — §9.3 decides it from measurement, per
   `vtt-procedural-geometric-surfacing.md`'s own rule that thresholds "must
   come from a browser benchmark, not from an unmeasured constant in an ADR."
4. **Degradation policy** when a budget is exceeded: drop to lower LOD, drop to
   painted covering, or let the frame rate fall? This is a product decision, not
   a technical one.

## 11. References

- `docs/benchmarks/vtt-surface-mesh-recomputation-2026-08-12.md` — the existing
  threshold, method, and headroom this budget spends
- `docs/DEFINITION_OF_DONE.md` — the performance evidence standard
- `docs/architecture/vtt-rendering-runtime-contract.md` §8–§9 — gesture
  transaction and required observability
- `docs/research/vtt-procedural-geometric-surfacing.md` §11 — the measured
  spike this budget operationalizes
- `docs/research/asset-management-prior-art.md` §1, §4 — texture memory facts
- `packages/render-3d/src/contracts/engine.ts` — `FrameReport`
