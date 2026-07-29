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
- `graph-core:api-check` — regenerates the public API in memory with the pinned
  Rustdoc JSON toolchain, compares it with the tracked snapshot, then runs the
  compile-time consumer contract;
- `graph-core:graph-ir-check` — valid Graph IR fixture through the Rust adapter.

The Rust public API baseline is generated from Rustdoc JSON and tracked at
`tests/snapshots/public-api.txt`. It contains both signatures and the Rustdoc
text for authored public items. The separately pinned nightly is used only
because Rustdoc JSON is not stable; the crate's authoritative compiler remains
the stable version in the root `rust-toolchain.toml`.

Install the exact extraction toolchain once:

```powershell
rustup toolchain install (Get-Content tools/rust-public-api-toolchain.txt) --profile minimal
```

To intentionally update the baseline after changing public source and docs:

```powershell
$env:UPDATE_SNAPSHOTS = "yes"
cargo test --locked -p grafting-graph-core --test public_api_snapshot -- --ignored --exact generated_public_api_matches_snapshot
Remove-Item Env:UPDATE_SNAPSHOTS
```

Review the snapshot diff together with affected consumers and behavioral
tests. A normal `graph-core:api-check` never updates or installs anything.
