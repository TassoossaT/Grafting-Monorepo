# `engine-domain-core` (`grafting-domain-core`)

Pure domain core: business rules, authoritative state, the state machine,
Command validation, DomainEvent generation, controlled RNG, and the state
hash. See `GRAFTING_MASTER_SOURCE.md` S4.2.

## Current status

Epic C (C-001, C-002, C-003, C-007, C-004, C-008) is done against a
deliberately generic example domain -- **not** a real game/VTT domain.
Nothing in the project docs specifies actual game content yet; inventing
it here would mean inventing product requirements. Instead, a minimal
"tally counter" state machine exercises every real architectural
requirement:

- `state::State` -- a single `i64` value.
- `command::Command` -- `Increment`, `Decrement`, `Reset`, `RollAndAdd`
  (the one command that uses the controlled RNG), each with typed
  validation (`CommandError`), never a panic.
- `event::DomainEvent` -- the semantic facts each command produces.
- `apply::apply_command` -- ties `Command` + `State` + RNG together.
- `rng::DeterministicRng` -- a seeded `ChaCha8Rng` wrapper (chosen over
  `StdRng` because ChaCha8's algorithm is fixed by construction --
  `StdRng`'s is not guaranteed stable across `rand` versions, which
  DEC-044's "RNG algorithm fixed per build" needs).
- `hash::state_hash` -- SHA-256 over an explicit, hand-written byte
  encoding of `(state, sequence)`.
- `snapshot::Snapshot` -- state + RNG seed/position + sequence + hash +
  `core_version` (`String`, not `&'static str` -- a decoded snapshot's
  version is real data read from bytes, not always the current build's).
  Round-trip is proven two ways now: `#[derive(Clone, PartialEq)]` for
  in-process cloning, and a real FlatBuffers encode/decode round trip
  (`contracts::SnapshotMessage`, via `wire::encode_snapshot`/
  `decode_snapshot`) for the wire format master source S10.1 names
  Snapshot for (DEC-013, `LOCKED`) -- see `contracts/README.md`.
- `contracts/*.fbs` + `wire.rs` -- C-005/C-006 done: FlatBuffers schemas
  for `Command`/`DomainEvent`/`Snapshot`, generated Rust/TS/C# code, a
  real round-trip test covering every variant
  (`tests/flatbuffers_round_trip.rs`), and a real schema-evolution/
  compatibility test (`tests/flatbuffers_evolution.rs`, C-006). See
  `contracts/README.md` for the schema design and what's deliberately
  not done yet (`ReplicationDelta`, the generic `engine_submit(bytes)`
  FFI entry point, TS/C# live consumers).

Real content still open, and why:

- **DEC-044's "same platform" is only partially captured.**
  `Snapshot.core_version` is one of six axes ADR-0004 lists (build ID,
  target, protocol/schema versions, features, numeric configuration, RNG
  algorithm). A real determinism manifest covering all six doesn't exist
  anywhere in this repo yet.
- No multiplayer (`AcceptedCommand`, journal, `ReplicationDelta`,
  transport) -- Phase 6/Epic H.
- No real VTT/game domain -- awaits an actual product decision.

## Targets

- `generate` -- regenerates `contracts/*.fbs` into Rust/TS/C# (see
  `contracts/README.md`); a real `dependsOn` of `check`/`test` below,
  not a manual step.
- `check` -- `cargo check -p grafting-domain-core`
- `test` -- `cargo test -p grafting-domain-core` (unit tests) plus
  `tests/replay_determinism.rs` (property tests, `proptest`),
  `tests/flatbuffers_round_trip.rs` (C-005), `tests/flatbuffers_evolution.rs`
  (C-006)

Run via Nx: `pnpm nx run engine-domain-core:check` /
`pnpm nx run engine-domain-core:test`.
