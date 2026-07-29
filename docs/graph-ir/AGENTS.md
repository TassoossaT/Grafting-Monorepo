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
- keep JSON Schema responsible for document shape and the adjacent adapter
  responsible only for Graph IR-specific provenance and canonicalization rules;
- implement reusable graph structure and algorithm validation only in
  `grafting-graph-core`, including duplicate identities, missing endpoints,
  traversal, ordering algorithms, cycles, and other graph mathematics
  (DEC-051).

`graph-ir-candidate.schema.json` and `grafting.graph.spike.json` are frozen
spike-era artifacts during migration. They MUST NOT be relabeled as v1.

I-004 delivered the real extractor: `tools/scripts/graph-ir-extract.mjs`
(`pnpm graph:extract` / `graph:extract:check`) reads the committed Nx project
graph and each project's manifest and produces the real
`docs/generated/grafting.graph.json`, covering `project`/`target` nodes and
`contains`/`depends_on` edges only -- the Nx-sourced slice of the contract.
It self-checks against both validation layers (the JS schema/semantic
validator and the Rust `graph-ir-cli` structural layer, per DEC-051) before
writing. `grafting.graph.spike.json` and the Architecture Studio spike
viewer that reads it are untouched and stay frozen until I-006 does the real
viewer cutover -- I-004 does not migrate or remove them. Task/agent/handoff/
skill/prompt coverage (`.ai/`-sourced, not Nx-sourced) remains out of this
extractor's scope; see I-006/J-012.
