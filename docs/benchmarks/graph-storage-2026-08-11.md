# Graph storage benchmark — E1.1 measurement spike — 2026-08-11

Status: **complete (revised after a first pass under-scoped bulk insertion
and only tested one alternative graph engine).** Query/traversal path:
existing `BTreeMap`-backed `Graph<N, E>` is fast enough at every scale
tested, up to ~1M cells — no new backend needed there. Bulk insertion (map
generation/load) is a real, measured problem at that same scale — but the
fix is a targeted identity-map swap inside the existing type, not the
second dense storage backend/trait the roadmap's E1.2 detail assumed.

Scope: `docs/architecture/vtt-roadmap.md` E1.1. Measures whether
`Graph<N, E>`'s existing `BTreeMap<NodeId, NodeIndex>` translation layer
(`libs/graph/core/src/model.rs`) is fast enough for construction's real
workload, before E1.2 decides whether to add a second, dense-index-only
storage backend behind a shared trait. Not a determinism question — replay
is explicitly out of scope for this roadmap (see the roadmap's own note).

## Revision note

The first pass of this spec (measured up to 100k cells, brush-stroke-shaped
neighbor queries only, one hand-rolled "dense" comparison with no identity
resolution at all) concluded no new backend was needed anywhere, full stop.
Follow-up questions from the roadmap owner — was querying tested beyond
brush strokes, and does a half-second build at 100k cells hold up when a
real map has millions of nodes — were correct to push on both points and
changed the conclusion on the construction axis specifically. This version:
extends every preset to ~1M cells, adds a dispersed (non-clustered) query
benchmark, and replaces the single naive "dense array" comparison with two
realistic candidates built from the same resolvable `String`-id input the
real constructor receives (see Method).

## Threshold, stated before running

Per-frame cost (neighbor-query recompute for one brush stroke) must stay
well under the frame budget, leaving headroom for rendering, the WASM
boundary crossing, and mesh rebuild in the same frame. At 60 fps the budget
is 16.67 ms/frame; this spec treats **10% of that budget (~1.67 ms) as the
generous ceiling** for the existing path's per-stroke neighbor-query cost.
Bulk insertion (one-time, at map generation/load, not per-frame) has no
frame-budget threshold — evaluated instead against plain user-perceptible
load-time cost, since that is what the roadmap owner's question was really
asking.

## Method

`libs/graph/core/examples/storage_bench.rs` (not shipped/public-API code —
an `example`, run on demand, feeding this report). Builds the same 6-slot
prism-grid topology `PrismGridMesh` already uses (N/E/S/W/Bottom/Top) at
four scales (~1k/10k/100k/1M cells: `18x18x3`, `58x58x3`, `183x183x3`,
`577x577x3`), then measures several storage/construction paths on
identical topology.

**Query/traversal paths** (unchanged approach from the first pass):

- **existing** — `Graph<(), ()>::try_from_parts`, `.node()`,
  `.successors()`/`.predecessors()` (the real production path).
- **dense floor** — a plain `Vec<[u32; 6]>` adjacency array addressed by
  the grid's own `x, y, l -> usize` index math, no `String`, no map at all.
  Not a buildable candidate on its own (no identity stability, no
  removal/compaction story) — a lower bound only.

Operations: bulk insertion (one graph build), point lookup by id (20,000
random lookups), clustered neighbor query (200 simulated brush strokes,
each a 7x7 = 49-cell cluster on one random layer, `successors` and
`predecessors` both called per cell), and **new this revision**: dispersed
neighbor query (20,000 individual random cells across the whole grid, not
one cluster — checks whether the brush-stroke locality was flattering the
existing path).

**Bulk-insertion paths, new this revision** — all three built from
identical `Vec<String>` node ids and `Vec<(String, String)>` edge pairs
(the same shape a real caller passes to `try_from_parts`, unlike the dense
floor's index shortcut):

- **existing** — `BTreeMap<String, NodeIndex>` + `petgraph::StableDiGraph`
  (current production code).
- **hashmap+stablegraph** — same `StableDiGraph` engine, only the identity
  map changes to `std::collections::HashMap`. Isolates whether the
  *ordered-map* choice or the *graph engine* is the dominant cost.
- **hashmap+csr** — `std::collections::HashMap` for identity resolution,
  then `petgraph::csr::Csr::from_sorted_edges` (`petgraph`'s
  compressed-sparse-row type, the concrete alternative the roadmap's E1.2
  detail names by name as an existing multi-backend precedent). Uses the
  bulk `from_sorted_edges` constructor (`O(|V|+|E|)`), not one `add_edge`
  call per edge — `Csr::add_edge`'s own doc comment states that costs
  `O(|V|*|E|)` for the whole graph, which would make it the wrong
  comparison to run.

Run: `cargo run --release --example storage_bench -p grafting-graph-core`.
Wall-clock, single machine, two full runs to sanity-check variance.
Bulk-insertion ratios move by ~20-30% run to run and the two realistic
candidates (`hashmap+stablegraph` vs `hashmap+csr`) swap which is faster
between runs — read them as "same order of magnitude, no reliable winner
between the two," not as a precise ranking. Treat all numbers as
order-of-magnitude evidence for this spec's questions, not a regression
suite.

## Results (representative run)

### Query/traversal (existing path only; dense floor shown for scale)

| Scale | Cells | Point lookup/op | Clustered query/stroke | Dispersed query/op |
| --- | --- | --- | --- | --- |
| Small | 972 | 216-248 ns | 44.6-47.1 µs | 993-1065 ns |
| Medium | 10,092 | 302-366 ns | 55.0-74.4 µs | 1446-2075 ns |
| Large | 100,467 | 513-738 ns | 76.4-83.4 µs | 2632-3504 ns |
| **Huge** | **998,787** | **1137-1337 ns** | **95.1-104.9 µs** | **4315-4578 ns** |

### Bulk insertion, four candidates

| Scale | Cells | existing | hashmap+stablegraph | hashmap+csr | dense floor |
| --- | --- | --- | --- | --- | --- |
| Small | 972 | 2.3-2.7 ms | 313-317 µs (7.5-8.2x) | 300-380 µs (6.1-7.9x) | 4-12 µs |
| Medium | 10,092 | 35-37 ms | 5.3-6.2 ms (6.0-6.6x) | 4.9-5.9 ms (6.4-7.1x) | 0.12-0.28 ms |
| Large | 100,467 | 421-488 ms | 68-98 ms (5.0-6.2x) | 65-84 ms (5.8-6.4x) | 0.84-0.95 ms |
| **Huge** | **998,787** | **5.0-6.9 s** | **1.1-1.4 s (4.6-4.8x)** | **1.1-1.4 s (3.5-6.2x)** | **8-10 ms** |

(Ranges are the two independent runs; "Nx" is speedup vs. `existing` in
that same run.)

## Interpretation against the stated threshold

**Query/traversal path: still well under threshold at every scale,
including dispersed access.** Worst case (huge, ~1M cells, clustered
stroke) is 95-105 µs per brush stroke — **~0.6% of the 16.67 ms frame
budget**, ~16x under the generous 1.67 ms (10%) ceiling. Dispersed
(non-clustered) queries are costlier per-op than clustered ones (up to
~4.6 µs at 1M cells vs. ~2 µs implied per clustered call) but still
negligible in absolute per-frame terms — clustering was not doing the
existing path a hidden favor large enough to matter. **This axis needs no
new backend, confirmed now across four orders of magnitude, not just up to
100k.**

**Bulk insertion: a real problem at real scale, and the roadmap's assumed
fix (a second dense backend/trait) is not the most effective one measured.**
At ~1M cells the existing path takes 5-7 seconds — genuinely
user-perceptible, and the owner's instinct that "millions of nodes" makes
this worse, not better, is correct: growth is faster than linear (~n^1.1
across the four scales, consistent with `BTreeMap`'s `O(log n)`-with-string-
comparison insert cost). But the ~5-8x speedup available from just swapping
the identity map (`BTreeMap` -> `HashMap`) inside the *existing*
`StableDiGraph` engine matches or beats swapping the graph engine itself
(`Csr`) — the two realistic candidates are statistically indistinguishable
from each other across repeated runs, both consistently beating `existing`
by roughly the same margin. **The dominant cost is the ordered map, not the
graph engine.**

## A real tradeoff the map swap introduces: determinism

`Graph<N, E>`'s current `BTreeMap`-backed maps are not just an
implementation detail — `GraphSnapshot`'s doc comment states nodes/edges
are "sorted by stable node identity," and `snapshot()` currently gets that
ordering for free by iterating `node_indices.values()`/
`edge_indices.values()` in `BTreeMap`'s natural key order.
`topological_order()` similarly uses a `BTreeSet` as its ready-queue for
deterministic tie-breaking. A plain swap to `HashMap` breaks that guarantee
silently (`HashMap` iteration order is unspecified and varies per process)
unless `snapshot()` (and any other caller-visible ordering) explicitly sorts
at the point of observation instead of relying on map iteration order. That
sort is cheap relative to construction (`O(n log n)` once, only when
`snapshot()` is actually called, not on every insert/lookup) but it is a
real code change, not a drop-in type substitution, and any other caller
currently relying on `BTreeMap`'s incidental ordering (grep before
changing) needs the same treatment.

## Disposition

**Query/traversal path: E1.2 needs no new backend for this axis.**
Confirmed at 1k through ~1M cells, clustered and dispersed access alike.

**Bulk-insertion path: real, measured problem at map-generation scale, but
the fix this evidence points to is narrower than E1.2's originally-assumed
second storage backend.** Recommend re-scoping that part of E1.2 (or
splitting it into its own small task) to: replace `Graph<N, E>`'s internal
`BTreeMap<NodeId, NodeIndex>`/`BTreeMap<EdgeId, EdgeIndex>` with
`HashMap`s, and explicitly re-sort at the point(s) that currently rely on
`BTreeMap`'s incidental ordering (`snapshot()` at minimum; grep for other
callers before changing). This is a same-engine, same-trait-surface change
— it does not require `E1.2`'s deliverable 3 (a second, `Csr`-or-similar
storage type implementing the trait), because that alternative engine did
not reliably outperform the simpler map swap in this measurement. The
trait-extraction deliverables (1, 2, 4, 5, 6) are unaffected either way and
should proceed as already scoped.

**Still open, and explicitly a product/UX call, not a storage-architecture
one:** even with the ~5-8x map-swap speedup, ~1M cells still costs roughly
1-1.5 seconds to construct. A map with several million cells (plausible at
finer tile resolution) would still be multiple seconds. Whether that is
acceptable synchronous load time, or needs async/background construction,
or needs a coarser default cell resolution, is outside this spec's
storage-architecture scope and is the real remaining question for whoever
owns map-generation UX — flagging it rather than deciding it, per this
project's planning-phase discipline of not closing this kind of question
silently.

## Gaps / caveats

- Single-machine, `Instant`-based wall-clock timing, not a
  statistically-averaged `criterion` harness (no new dependency was added
  for a one-off measurement spike) — adequate for this spec's
  order-of-magnitude questions, not for ongoing regression tracking. If
  per-frame or per-load graph cost ever needs continuous regression
  tracking, that is a separate follow-up.
- Topology is a synthetic regular grid (matches `PrismGridMesh`'s existing
  6-slot connectivity), not a real authored map.
- The `hashmap+csr` candidate resolves identities with a plain
  `std::collections::HashMap` (SipHash) for a fair one-variable-at-a-time
  comparison against `hashmap+stablegraph`; a faster hasher (e.g.
  `rustc-hash`/`FxHashMap`) was not tried and could move both realistic
  candidates further, uniformly — not expected to change which one wins,
  since both would gain roughly the same relative amount.
- `libs/graph/core/examples/storage_bench.rs` is kept in the repo for
  reproducibility but is explicitly not public API and not part of any
  build/CI gate.
