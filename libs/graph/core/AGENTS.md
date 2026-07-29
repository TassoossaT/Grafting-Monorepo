# AGENTS.md — `grafting-graph-core`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

This crate is the authority for reusable graph structures, structural
validation, deterministic graph algorithms, queries, diffs, and graph/layout
mathematics (DEC-051). Keep one coherent crate with internal modules until a
measured boundary requires another deployable or independently versioned unit.

Third-party graph and mathematics libraries are private implementation
details. Public APIs MUST expose only Grafting-owned IDs, inputs, snapshots,
results, and errors. Presentation metadata such as labels, colors, icons,
tooltips, DOM state, viewport, and selection belongs to callers unless it
changes a shared calculation.

The Graph IR CLI is an adapter. Generic identity and endpoint rules call this
crate; evidence, provenance, source revisions, authority classes, and canonical
JSON serialization remain Graph IR concerns. Do not make Graph IR the generic
model and do not duplicate this crate's graph behavior in TypeScript, C#, or
Python.

Public API changes require `graph-core:api-check`, a reviewed update to the
generated `tests/snapshots/public-api.txt`, complete Rustdoc, and behavioral
contract tests. The API check uses the separately pinned Rustdoc JSON nightly
but MUST NOT install it or mutate the baseline during a normal validation run.
The compile-time consumer contract remains complementary evidence and must not
be weakened to accept an accidental breaking change.
