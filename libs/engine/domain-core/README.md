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
  `core_version`. Round-trip is proven with `#[derive(Clone, PartialEq)]`,
  **not** a serialization crate -- master source S10.1 names Snapshot for
  FlatBuffers (DEC-044, `LOCKED`); a `serde`-based stand-in here, even
  labeled temporary, would be a second real format for an already-decided
  surface.

Real content still open, and why:

- **C-005 (flatc config) / C-006 (schema evolution): blocked, not just
  deferred.** C-005 depends on B-001, B-002, **B-004** (the .NET solution),
  which is still open (tied to Epic D). No real FlatBuffers contract for
  Command/DomainEvent/Snapshot exists yet.
- **DEC-044's "same platform" is only partially captured.**
  `Snapshot.core_version` is one of six axes ADR-0004 lists (build ID,
  target, protocol/schema versions, features, numeric configuration, RNG
  algorithm). A real determinism manifest covering all six doesn't exist
  anywhere in this repo yet.
- No multiplayer (`AcceptedCommand`, journal, `ReplicationDelta`,
  transport) -- Phase 6/Epic H.
- No real VTT/game domain -- awaits an actual product decision.

## Targets

- `check` -- `cargo check -p grafting-domain-core`
- `test` -- `cargo test -p grafting-domain-core` (unit tests) plus
  `tests/replay_determinism.rs` (property tests, `proptest`)

Run via Nx: `pnpm nx run engine-domain-core:check` /
`pnpm nx run engine-domain-core:test`.
