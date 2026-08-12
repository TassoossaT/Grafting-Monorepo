# AGENTS.md — Graph IR Contracts

Scope-local addendum to root `AGENTS.md`.

## 1. CONTRACT BOUNDARIES
- `graph-ir-v1.schema.json` is the canonical vendor-neutral Graph IR contract.
- Schema modifications (required fields, IDs, authority classes) require a versioned schema update and an ADR.
- UI presentation (X6, DOM, viewport, colors) MUST remain outside Graph IR.
- Reusable graph structures and algorithm validations belong to `grafting-graph-core` (DEC-051).

## 2. EXTRACTOR & VALIDATION
- `tools/scripts/graph-ir-extract.mjs` (`pnpm graph:extract`) extracts the committed Nx graph into `docs/generated/grafting.graph.json`.
- Contract changes MUST pass `pnpm graph:v1:check` and `pnpm graph:v1:test`.
