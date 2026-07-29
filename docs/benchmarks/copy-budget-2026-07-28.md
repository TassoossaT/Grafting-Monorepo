# Copy-budget spike — 2026-07-28

Task: A-009 / foundational spike 5.

Status: **accepted on 2026-07-29.** Native, managed/unmanaged, and real-browser
Web/Worker measurements are complete.

## Environment

- Windows x64;
- Rust 1.97.1, optimized release build;
- .NET SDK 10.0.302, optimized release build;
- owner-run real browser on Windows x64 (browser/version was not captured);
- payloads: 4 KiB, 64 KiB, 1 MiB, 4 MiB, and 16 MiB;
- approximately 512 MiB copied per native measurement, bounded iteration count.

These are synthetic boundary measurements on one machine. They are evidence for
a transport budget, not a prediction of the future solver or GPU crossover.

## Native contiguous copy

| Bytes | Iterations | Elapsed ms | GiB/s |
| ---: | ---: | ---: | ---: |
| 4,096 | 20,000 | 0.623 | 122.423 |
| 65,536 | 8,192 | 256.071 | 1.953 |
| 1,048,576 | 512 | 32.945 | 15.177 |
| 4,194,304 | 128 | 38.213 | 13.085 |
| 16,777,216 | 32 | 67.039 | 7.458 |

The 4 KiB result is timer/cache dominated, and the 64 KiB result is an
outlier relative to adjacent sizes; neither should set policy by itself.

## Managed ↔ unmanaged copy

| Direction | Bytes | Iterations | Elapsed ms | GiB/s |
| --- | ---: | ---: | ---: | ---: |
| managed → unmanaged | 4,096 | 20,000 | 9.390 | 8.125 |
| unmanaged → managed | 4,096 | 20,000 | 1.086 | 70.272 |
| managed → unmanaged | 65,536 | 8,192 | 10.369 | 48.219 |
| unmanaged → managed | 65,536 | 8,192 | 10.167 | 49.180 |
| managed → unmanaged | 1,048,576 | 512 | 32.902 | 15.197 |
| unmanaged → managed | 1,048,576 | 512 | 53.355 | 9.371 |
| managed → unmanaged | 4,194,304 | 128 | 33.045 | 15.131 |
| unmanaged → managed | 4,194,304 | 128 | 36.324 | 13.765 |
| managed → unmanaged | 16,777,216 | 32 | 62.250 | 8.032 |
| unmanaged → managed | 16,777,216 | 32 | 65.021 | 7.690 |

## Web/Worker path

The spike page compares structured cloning with transferable `ArrayBuffer`
round trips and exposes machine-readable results in the DOM. Its source is
under `spikes/copy-budget/web/`. The owner ran it in a real browser and reported
`PASS: all clone and transferable-buffer round trips completed`.

| Mode | Bytes | Iterations | Median ms | p95 ms |
| --- | ---: | ---: | ---: | ---: |
| clone | 4,096 | 40 | 0.1 | 0.2 |
| clone | 65,536 | 40 | 0.2 | 0.3 |
| clone | 1,048,576 | 40 | 1.4 | 2.2 |
| clone | 4,194,304 | 20 | 5.9 | 8.6 |
| clone | 16,777,216 | 12 | 28.8 | 43.9 |
| transfer | 4,096 | 40 | 0.0 | 0.2 |
| transfer | 65,536 | 40 | 0.0 | 0.1 |
| transfer | 1,048,576 | 40 | 0.0 | 0.1 |
| transfer | 4,194,304 | 20 | 0.0 | 0.4 |
| transfer | 16,777,216 | 12 | 0.1 | 3.0 |

## Provisional interpretation

The native results support the existing rules, without changing them:

- batch FFI calls; do not cross the boundary per entity;
- structured control messages should stay small;
- large numeric payloads use explicit contiguous layouts;
- the C# lease API should avoid a managed copy when the caller can consume a
  callback-scoped view;
- routine structured-clone control payloads should remain at or below 64 KiB;
- a 1 MiB clone is suitable only for infrequent, non-frame-critical work;
- payloads of 4 MiB or more should transfer `ArrayBuffer` ownership or use an
  explicitly backpressured/chunked protocol instead of cloning;
- the 16 MiB transfer result is evidence for ownership transfer, not permission
  to allocate or hand off such buffers without lifecycle and memory budgets;
- never describe the whole pipeline as zero-copy.

The clone path crossed a 16.7 ms frame budget at 16 MiB (28.8 ms median,
43.9 ms p95). The transfer path remained below 3.0 ms p95 across the measured
sizes, but near-zero medians are timer-resolution dominated and must not be
treated as literal zero-cost operations.

## Disposition

A-009 is accepted. The measurements support the existing batched-boundary and
transferable-buffer direction without changing an ABI, persisted protocol, or
GPU contract. Product workloads still require their own end-to-end budgets.

## Reproduction

See `spikes/copy-budget/README.md`. The spike is ignored from version control by
policy; this report is the tracked evidence record.
