# `engine-domain-core` (`grafting-domain-core`)

Pure domain core: business rules, authoritative state, the state machine,
Command validation, DomainEvent generation, controlled RNG, and the state
hash. See `GRAFTING_MASTER_SOURCE.md` S4.2.

## Current status

Empty of real domain logic on purpose. This crate exists right now only to
prove the Cargo + Nx workspace pipeline (Epic B / Phase 1). Real content
(Command, DomainEvent, Snapshot, state hash, invariant tests) is added in
Epic C (`GRAFTING_MASTER_SOURCE.md` S23, C-001 through C-008).

## Targets

- `check` -- `cargo check -p grafting-domain-core`
- `test` -- `cargo test -p grafting-domain-core`

Run via Nx: `pnpm nx run engine-domain-core:check`.
