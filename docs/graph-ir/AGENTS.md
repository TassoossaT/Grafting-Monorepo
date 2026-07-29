# AGENTS.md - Graph IR contracts

Scope-local addendum to the root `AGENTS.md`.

`graph-ir-v1.schema.json` is the accepted vendor-neutral Graph IR contract.
Changes to required fields, stable-ID rules, authority classes, provenance,
evidence, or relation semantics require a versioned schema change and an ADR
when compatibility or authority changes materially.

Agents MUST:

- keep X6, DOM, layout, viewport, color, and application presentation outside
  Graph IR;
- keep derived records read-only and traceable to normalized repository paths
  and content hashes;
- run `pnpm graph:v1:check` and `pnpm graph:v1:test` after contract or validator
  changes;
- preserve valid and invalid fixtures for every enforced compatibility rule;
- update the semantic validator only for invariants JSON Schema cannot express
  across records.

`graph-ir-candidate.schema.json` and `grafting.graph.spike.json` are frozen
spike-era artifacts during migration. They MUST NOT be relabeled as v1. I-004
owns the real extractor and `docs/generated/grafting.graph.json` cutover.
