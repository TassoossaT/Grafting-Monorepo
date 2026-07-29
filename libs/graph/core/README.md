# `graph-core` (`grafting-graph-core`)

Generic Grafting-owned graph structures and deterministic algorithms. The
initial capability is a directed multigraph with stable node/edge identities,
endpoint validation, deterministic predecessor/successor queries, immutable
snapshots, and deterministic topological ordering with explicit cycle errors.

The public API does not expose `petgraph`, `serde`, Graph IR, X6, DOM, or
application presentation types. `petgraph` is the current private storage
engine and can be replaced without changing consumers. More graph kinds,
algorithms, or mathematical dependencies are added only for a real consumer.

Graph IR structural validation is an optional CLI adapter:

```powershell
cargo run -p grafting-graph-core --features graph-ir-cli --bin validate-graph-ir -- docs/graph-ir/fixtures/valid-minimal.graph.json
```

Targets:

- `graph-core:format` — Rust formatting check;
- `graph-core:check` — all targets and features;
- `graph-core:lint` — Clippy with warnings denied;
- `graph-core:test` — unit, behavior, public-contract, and Graph IR CLI tests;
- `graph-core:api-check` — compile-time protection for the currently consumed
  public names and signatures;
- `graph-core:graph-ir-check` — valid Graph IR fixture through the Rust adapter.

I-003 will add the generated, Git-tracked API baseline shared by all languages.
The compile-time API contract and behavioral tests already prevent silent
renames and signature/obligation drift for this crate.
