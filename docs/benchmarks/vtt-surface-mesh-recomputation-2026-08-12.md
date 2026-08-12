# Benchmark: VTT surface mesh recomputation — 2026-08-12

Status: complete. Scope: the recomputation-cost follow-up left open by
`ADR-0022` after `vtt-roadmap.md` E1.1 measured graph traversal but not full
surface-to-mesh derivation. This is Epic 1 evidence, not Epic 3 implementation.

## Question and threshold

Can a representative construction brush move shared graph nodes, identify and
deduplicate affected surfaces, and derive their polygon mesh inside the frame
budget without storing a second authoritative mesh copy?

The pre-existing E1.1 threshold is retained: **1.67 ms per brush stroke**, 10%
of a 60 fps frame, leaving the rest for rendering, Wasm transfer, and UI work.

## Method

- Harness: `libs/graph/core/examples/surface_mesh_bench.rs`, a non-shipped
  reproducible example.
- Topology: shared-node quad surfaces at approximately 1k, 10k, 100k, and 1M
  surfaces. Adjacent surfaces share corner `NodeId`s through the production
  `SurfaceRegistry` reverse index.
- Workload: 200 deterministic 7×7-node brush strokes. Each stroke calls the
  production `move_node`, deduplicates affected `SurfaceKey`s, resolves each
  cycle's current positions from `Graph`, materializes vertices and triangle
  indices, and computes centroid plus Newell normal.
- Command:
  `cargo run --release --example surface_mesh_bench -p grafting-graph-core -- --huge`.
- Measurement: single-machine wall-clock timing. Treat the result as
  order-of-magnitude decision evidence, not a continuous regression suite.

## Representative result

| Scale | Surfaces | Construction | 200 strokes | Per stroke | Derived surfaces/stroke |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1k | 1,024 | 3.626 ms | 23.323 ms | 116.6 µs | 63.4 |
| 10k | 10,000 | 42.528 ms | 38.687 ms | 193.4 µs | 63.8 |
| 100k | 99,856 | 479.390 ms | 70.162 ms | 350.8 µs | 63.9 |
| 1M | 1,000,000 | 6.567 s | 48.221 ms | 241.1 µs | 63.9 |

For the currently implemented quad generators, the 1M preset is approximately
**6.9× below** the 1.67 ms threshold. Variation between scales is dominated by
single-run machine/cache effects rather than topology growth: each brush
invalidates about 64 quad surfaces through the reverse index, independent of
total map size.

## Disposition

- **No mesh cache is justified for the current quad generators.** The measured
  path supports keeping mesh derived from the ordered stable node cycle.
- **No second authoritative geometry copy.** The benchmark supports the
  accepted graph → mesh → surface layering rather than reopening ADR-0022.
- **Construction/load time remains separate.** The 1M build took 6.567 s,
  confirming E1.1's existing load-time concern. Async/background construction
  or coarser defaults remain a future UX decision; they do not justify mesh
  persistence.

## Caveats

- The benchmark derives the planar quads currently emitted by terrain and
  structure generation. Arbitrary authored meshes, concave/holed polygons, or
  unusually high vertex counts require their own representative measurement.
- The benchmark's fan triangulation is valid for the measured convex quads; it
  is not evidence for a future robust triangulator over arbitrary polygons.
- Native release-mode execution does not measure a future Wasm adapter,
  JavaScript/Worker boundary calls, serialization, buffer copies, or pooling.
- GPU upload, chunk rebuilding, Worker transfer, and render scheduling are not
  included. Those are consumer/runtime costs and are deliberately outside this
  Epic 1 measurement.
- The harness uses release-mode `Instant` timing on one machine and is kept for
  reproducibility, not as a CI performance gate.
