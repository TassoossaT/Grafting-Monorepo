# Graph storage benchmark — E1.1 measurement spike — 2026-08-11

Status: **complete — existing `BTreeMap`-backed path is fast enough; E1.2
needs no new storage backend.**

Scope: `docs/architecture/vtt-roadmap.md` E1.1. Measures whether
`Graph<N, E>`'s existing `BTreeMap<NodeId, NodeIndex>` translation layer
(`libs/graph/core/src/model.rs`) is fast enough for construction's real
workload, before E1.2 decides whether to add a second, dense-index-only
storage backend behind a shared trait. Not a determinism question — replay
is explicitly out of scope for this roadmap (see the roadmap's own note).

## Threshold, stated before running

Per-frame cost (neighbor-query recompute for one brush stroke) must stay
well under the frame budget, leaving headroom for rendering, the WASM
boundary crossing, and mesh rebuild in the same frame. At 60 fps the budget
is 16.67 ms/frame; this spec treats **10% of that budget (~1.67 ms) as the
generous ceiling** for the existing path's per-stroke neighbor-query cost —
everything else in the frame gets the rest. Bulk insertion (one-time, at map
generation/load, not per-frame) has no frame-budget threshold; it is
reported for completeness only.

## Method

`libs/graph/core/examples/storage_bench.rs` (not shipped/public-API code —
an `example`, run on demand, feeding this report). Builds the same 6-slot
prism-grid topology `PrismGridMesh` already uses (N/E/S/W/Bottom/Top) at
three scales, then measures two storage paths on identical topology:

- **existing** — `Graph<(), ()>::try_from_parts`, `.node()`,
  `.successors()`/`.predecessors()` (the real production path, `String`
  `NodeId` + `BTreeMap` lookup).
- **dense baseline** — a plain `Vec<[u32; 6]>` adjacency array, `usize`
  indices only, no `String`, no `BTreeMap`. This isolates the translation
  layer's own cost as a real number, per the roadmap's ask; it is
  deliberately not a usable alternative on its own (no identity stability,
  no removal/compaction story) — only a floor for comparison.

Operations measured separately: bulk insertion (one graph build), point
lookup by id (20,000 random lookups), and neighbor query (200 simulated
brush strokes, each a 7x7 = 49-cell cluster on one random layer, both
`successors` and `predecessors` called per cell — 9,800 neighbor-query calls
total per preset).

Run: `cargo run --release --example storage_bench -p grafting-graph-core`.
Wall-clock, single machine, two runs to sanity-check variance (~15-25% run
to run, consistent with `Instant`-based measurement and no warm-up/repeat
averaging a `criterion`-style harness would give). Treat all numbers below
as order-of-magnitude evidence, not a precise SLA — sufficient for this
spec's yes/no question, not for regression-tracking.

## Results (representative run)

| Scale | Cells | Bulk insertion (existing / dense) | Point lookup (existing / dense, per-op) | Neighbor query (existing / dense, per-stroke) |
| --- | --- | --- | --- | --- |
| Small | 972 (18x18x3) | 2.67 ms / 11.6 µs (230x) | 238 ns / 2.1 ns | 47.1 µs / 0.05 µs (1024x) |
| Medium | 10,092 (58x58x3) | 42.5 ms / 113.9 µs (373x) | 344 ns / 4.7 ns | 70.1 µs / 0.16 µs (432x) |
| Large | 100,467 (183x183x3) | 473.3 ms / 1.2 ms (395x) | 704 ns / 18.1 ns | 111.6 µs / 0.28 µs (398x) |

(Second run: same order of magnitude throughout, e.g. large-preset neighbor
query 91.1 µs/stroke vs. 111.6 µs/stroke — within expected wall-clock
variance, does not change the conclusion.)

## Interpretation against the stated threshold

**Per-frame path (neighbor query): well under threshold at every scale.**
Worst case (large, 100k cells) is 111.6 µs per brush stroke — **~0.67% of
the 16.67 ms frame budget, ~15x under even the generous 1.67 ms (10%)
ceiling** this spec set before running. The existing `BTreeMap` + `String`
`NodeId` translation costs roughly 400x the dense floor in relative terms,
but the absolute existing-path cost is negligible next to a frame budget
that also has to cover rendering, WASM boundary crossing, and mesh rebuild.
Point lookups are similarly negligible in absolute terms (704 ns worst
case, single digits of microseconds even at hundreds of lookups/frame).

**Bulk insertion: real cost, but not a per-frame cost, and out of this
spec's threshold.** 473 ms to build a 100k-cell graph from scratch is the
one number here that a user could plausibly notice — but it happens once,
at map generation or load, not once per frame, so it is not measured
against the frame-budget threshold this spec set. If large-map generation
latency becomes its own concern later, that is a separate, narrower
question (e.g. background/async construction) than "is the per-frame
storage path fast enough," which is what E1.1 was scoped to answer.

## Disposition

**E1.2 needs no new storage backend.** The existing `Graph<N, E>` path
clears the stated per-frame threshold with wide margin at all three
measured scales, including the ~100k-cell "large" preset. Per the roadmap's
own conditional (E1.2 detail, deliverable 3: "a second... storage type...
[b]uilt... only if E1.1's numbers justify it"), they do not. E1.2 should
proceed as trait extraction only: define the minimal graph-operation
trait(s) in `grafting-graph-core`, have the existing `Graph<N, E>` implement
it unchanged, and stop there — no second backend, no `NodeIndex`/`usize`
storage type to build or maintain.

The one open question this spec deliberately did not answer, because it is
outside its stated scope: whether 473 ms one-time bulk-insertion cost at
the 100k-cell scale is itself acceptable for map generation/load latency.
That is a product/UX call, not a storage-architecture one, and does not
block E1.2.

## Gaps / caveats

- Single-machine, `Instant`-based wall-clock timing, not a
  statistically-averaged `criterion` harness (no new dependency was added
  for a one-off measurement spike) — adequate for this yes/no threshold
  question, not for ongoing regression tracking. If per-frame graph cost
  ever needs continuous regression tracking, that is a separate follow-up,
  not part of this spec.
- Topology is a synthetic regular grid (matches `PrismGridMesh`'s existing
  6-slot connectivity), not a real authored map; real maps may have
  different edge density at boundaries, but the per-cell operation cost
  measured here does not depend on global map shape.
- `libs/graph/core/examples/storage_bench.rs` is kept in the repo for
  reproducibility but is explicitly not public API and not part of any
  build/CI gate.
