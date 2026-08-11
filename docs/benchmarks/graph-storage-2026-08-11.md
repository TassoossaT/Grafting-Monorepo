# Graph storage benchmark — E1.1 measurement spike — 2026-08-11

Status: **complete (revised twice after follow-up questions: first widened scope to ~1M cells and real backend candidates, then added an indexed, no-`String` query comparison).**
- **Query/traversal path verdict:** Existing `BTreeMap`-backed `Graph<N, E>` is fast enough at every scale tested up to ~1M cells; no new storage backend needed. Optional non-blocking win: skip `String` round-trip for purely-internal callers (3-10x faster).
- **Bulk-insertion path verdict:** Real, measured problem at ~1M cells. Fix is a targeted identity-map swap inside existing type (`BTreeMap` -> `HashMap`), not the second dense storage backend/trait assumed in E1.2.

Scope: `docs/architecture/vtt-roadmap.md` E1.1.
- **Goal:** Measure if `Graph<N, E>`'s existing `BTreeMap<NodeId, NodeIndex>` translation layer (`libs/graph/core/src/model.rs`) is fast enough for construction's real workload before E1.2 decides whether to add a second, dense-index-only storage backend behind a shared trait.
- **Non-goal:** Not a determinism question — replay is explicitly out of scope for this roadmap (see the roadmap's own note).

## Revision note

- **First pass finding:** Measured up to 100k cells, brush-stroke-shaped neighbor queries only, hand-rolled "dense" comparison with no identity resolution; concluded no new backend needed anywhere.
- **Trigger for revision:** Roadmap owner follow-up questions (querying beyond brush strokes; half-second build at 100k cells scaling to millions of nodes) pushed on both axes and changed the conclusion on construction.
- **Revision changes:**
  - Extended all presets to ~1M cells.
  - Added dispersed (non-clustered) query benchmark.
  - Replaced naive "dense array" comparison with two realistic candidates built from identical resolvable `String`-id input passed to the real constructor.

## Threshold, stated before running

- **Per-frame neighbor-query threshold:** **10% of 60 fps frame budget (~1.67 ms ceiling out of 16.67 ms/frame)** for neighbor-query recompute per brush stroke, leaving headroom for rendering, WASM boundary crossing, and mesh rebuild.
- **Bulk insertion threshold:** No fixed per-frame budget (one-time operation at map generation/load); evaluated against user-perceptible load-time cost.

## Method

- **Harness & Workload:** `libs/graph/core/examples/storage_bench.rs` (non-shipped `example`, run on demand). Builds 6-slot prism-grid topology (`PrismGridMesh`: N/E/S/W/Bottom/Top) across four scales:
  - Small: ~1k cells (`18x18x3` = 972 cells)
  - Medium: ~10k cells (`58x58x3` = 10,092 cells)
  - Large: ~100k cells (`183x183x3` = 100,467 cells)
  - Huge: ~1M cells (`577x577x3` = 998,787 cells)
- **Execution Command:** `cargo run --release --example storage_bench -p grafting-graph-core` (wall-clock, single machine, 2 full runs to verify variance; bulk ratios move ~20-30% run-to-run; treat numbers as order-of-magnitude evidence, not continuous regression suite).

**Query/traversal candidates:**
- **existing:** `Graph<(), ()>::try_from_parts`, `.node()`, `.successors()`/`.predecessors()` (production path).
- **dense floor:** Plain `Vec<[u32; 6]>` adjacency array addressed by `x, y, l -> usize` index math; no `String`, no map. Lower bound only (lacks identity stability, removal, compaction).

**Operations tested:**
- Bulk insertion (1 graph build).
- Point lookup by id (20,000 random lookups).
- Clustered neighbor query (200 brush strokes; 7x7=49 cells/cluster on 1 random layer; `successors` & `predecessors` called per cell).
- Dispersed neighbor query (20,000 random individual cells across full grid; checks whether locality flattens existing path).

**Bulk-insertion candidates (all built from `Vec<String>` node ids & `Vec<(String, String)>` edge pairs):**
- **existing:** `BTreeMap<String, NodeIndex>` + `petgraph::StableDiGraph` (current production code).
- **hashmap+stablegraph:** `std::collections::HashMap` identity resolution + `petgraph::StableDiGraph` engine (isolates map choice vs engine choice).
- **hashmap+csr:** `std::collections::HashMap` identity resolution + `petgraph::csr::Csr::from_sorted_edges` (`O(|V|+|E|)` bulk constructor; avoids `Csr::add_edge` `O(|V|*|E|)` cost).

## Results (representative run)

### Query/traversal (existing path only; dense floor shown for scale)

| Scale | Cells | Point lookup/op | Clustered query/stroke | Dispersed query/op |
| --- | --- | --- | --- | --- |
| Small | 972 | 216-248 ns | 44.6-47.1 µs | 993-1065 ns |
| Medium | 10,092 | 302-366 ns | 55.0-74.4 µs | 1446-2075 ns |
| Large | 100,467 | 513-738 ns | 76.4-83.4 µs | 2632-3504 ns |
| **Huge** | **998,787** | **1137-1337 ns** | **95.1-104.9 µs** | **4315-4578 ns** |

### Indexed (no-`String`) query, vs. the existing `String`-returning path

- **Overhead Sources in Existing `successors()`/`predecessors()`:**
  1. Map lookup resolving `NodeId` to internal index.
  2. `String::clone()` per neighbor in result.
  3. Sorting result `Vec<NodeId>` by string comparison instead of integer comparison.
- **Indexed Variant Mechanism:** Reuses `hashmap+stablegraph`; calls `petgraph`'s `neighbors_directed` directly with `NodeIndex`, returning raw `NodeIndex` results sorted as integers. Skips all 3 overhead points simultaneously (measures full index-based API vs full `String`-based API for callers staying in index space, e.g. K-step neighborhood recompute).

| Scale | Cells | Clustered speedup vs. existing | Dispersed speedup vs. existing | Dispersed ns/op |
| --- | --- | --- | --- | --- |
| Small | 972 | 3.3x | 5.7x | 187 |
| Medium | 10,092 | 10.4x | 9.4x | 244 |
| Large | 100,467 | 6.5x | 4.7x | 804 |
| **Huge** | **998,787** | **6.1x** | **3.8x** | **1173** |

### Bulk insertion, four candidates

| Scale | Cells | existing | hashmap+stablegraph | hashmap+csr | dense floor |
| --- | --- | --- | --- | --- | --- |
| Small | 972 | 2.3-2.7 ms | 313-317 µs (7.5-8.2x) | 300-380 µs (6.1-7.9x) | 4-12 µs |
| Medium | 10,092 | 35-37 ms | 5.3-6.2 ms (6.0-6.6x) | 4.9-5.9 ms (6.4-7.1x) | 0.12-0.28 ms |
| Large | 100,467 | 421-488 ms | 68-98 ms (5.0-6.2x) | 65-84 ms (5.8-6.4x) | 0.84-0.95 ms |
| **Huge** | **998,787** | **5.0-6.9 s** | **1.1-1.4 s (4.6-4.8x)** | **1.1-1.4 s (3.5-6.2x)** | **8-10 ms** |

(Ranges are the two independent runs; "Nx" is speedup vs. `existing` in that same run.)

## Interpretation against the stated threshold

- **Query/traversal path:**
  - **Verdict:** Well under threshold at every scale up to ~1M cells; no new backend needed across four orders of magnitude.
  - **Clustered data:** Worst case (huge, ~1M cells) is 95-105 µs/stroke = **~0.6% of 16.67 ms frame budget** (~16x under 1.67 ms ceiling).
  - **Dispersed data:** Costlier per-op (up to ~4.6 µs at 1M cells vs ~2 µs implied per clustered call) but negligible in per-frame terms; locality was not distorting results.

- **Indexed (no-`String`) query path:**
  - **Verdict:** Optional, non-blocking optimization.
  - **Data:** Skipping `String` `NodeId` round-trip returning raw `NodeIndex` is 3.3-10.4x faster (clustered) and 3.8-9.4x faster (dispersed) across all scales.
  - **Application:** Low-risk win for purely-internal hot-path callers (e.g. E3.3 `apply_cell_patch` K-step recompute) resolving `NodeId` only at graph boundary. Nice-to-have for E1.2 trait work.

- **Bulk insertion path:**
  - **Verdict:** Real problem at ~1M cells (5-7 s build time, user-perceptible load-time cost; super-linear ~n^1.1 growth due to `BTreeMap` `O(log n)` string-comparison inserts).
  - **Root Cause:** Dominant cost is the ordered map (`BTreeMap`), not the graph engine (`StableDiGraph` vs `Csr`).
  - **Solution:** Identity map swap (`BTreeMap` -> `HashMap`) inside `StableDiGraph` yields ~5-8x speedup, matching or beating engine swap to `Csr` (candidates are statistically indistinguishable).

## A real tradeoff the map swap introduces: determinism

- **Finding:** Swapping `BTreeMap` to `HashMap` breaks implicit iteration order and deterministic snapshot guarantees.
- **Affected Components:**
  - `GraphSnapshot`: Doc comment specifies nodes/edges are "sorted by stable node identity"; currently relies on `BTreeMap` key iteration order in `node_indices.values()` / `edge_indices.values()`.
  - `topological_order()`: Uses `BTreeSet` ready-queue for deterministic tie-breaking.
- **Mitigation:** Explicitly sort at observation points (`snapshot()`, etc.) instead of relying on map order.
- **Cost:** `O(n log n)` once when `snapshot()` is called (not on every insert/lookup); cheap relative to construction, but requires audit (grep) of callers relying on `BTreeMap` incidental ordering.

## Disposition

- **Query/traversal path:** No new backend required for E1.2 (confirmed from 1k to ~1M cells across clustered & dispersed access).
- **Bulk-insertion path:**
  - **Re-scope recommendation:** Re-scope E1.2 (or split into small task) to swap `Graph<N, E>`'s internal `BTreeMap<NodeId, NodeIndex>` / `BTreeMap<EdgeId, EdgeIndex>` to `HashMap`, adding explicit re-sorting where incidental key order is relied upon (`snapshot()` at minimum; grep for other callers).
  - **E1.2 Deliverables impact:** E1.2 deliverable 3 (second `Csr`-or-similar storage type implementing trait) is unneeded as `Csr` did not outperform the simple map swap. Trait-extraction deliverables (1, 2, 4, 5, 6) proceed as scoped.
- **Open Product/UX Question:**
  - **Observation:** Even with ~5-8x map swap speedup, ~1M cells costs 1-1.5 seconds to construct (multi-second for several million cells at finer tile resolution).
  - **Status:** Open UX decision — whether load time is acceptable synchronously, requires async/background construction, or requires coarser default cell resolution.

## Gaps / caveats

- **Timing Harness:** Uses single-machine `Instant`-based wall-clock timing instead of `criterion` (adequate for order-of-magnitude evaluation, not continuous regression tracking).
- **Topology:** Synthetic regular grid matching `PrismGridMesh` 6-slot connectivity, not an authored map.
- **Hasher Choice:** `hashmap+csr` used standard `std::collections::HashMap` (SipHash) for 1-variable comparison against `hashmap+stablegraph`. Faster hashers (`rustc-hash`/`FxHashMap`) were untried and would shift both realistic candidates uniformly without changing winner.
- **Artifact Role:** `libs/graph/core/examples/storage_bench.rs` preserved for reproducibility; not public API and not in build/CI gate.
