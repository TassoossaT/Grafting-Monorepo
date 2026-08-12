# `domain-core/contracts` — FlatBuffers wire schemas (C-005/C-006)

Master source §10.1 (DEC-013, `LOCKED`) names `Command`, `DomainEvent`,
`ReplicationDelta`, and `Snapshot` for FlatBuffers. `ReplicationDelta`
isn't modeled anywhere in this codebase yet (Phase 6/Epic H) -- a schema
can't be written for a type with no Rust definition, so this directory
covers the three that do exist: `command.fbs`, `domain_event.fbs`,
`snapshot.fbs`.

`map_state.fbs` was removed by E1.5. It was a VTT-specific, unconsumed
experiment generated beside these global execution contracts but never wired
into `domain-core`'s Rust module, conversions, round-trip tests, TypeScript, or
C# consumers. Its free-geometry shape was also superseded by ADR-0022. A future
map persistence, Worker, or transport contract belongs to the domain of its
first executable consumer and must be designed from that consumer's canonical
types; this directory does not speculate that boundary in advance.

These schemas are **not the source of truth**. `domain-core`'s own
hand-written `Command`/`DomainEvent`/`Snapshot` (`src/command.rs`,
`src/event.rs`, `src/snapshot.rs`) stay canonical; these `.fbs` files
define the *wire* representation, converted to/from via
`src/wire.rs`. Nothing in this codebase crosses a real process/language
boundary with encoded bytes yet (`libs/isekai/capi-bridge`'s
`engine_submit_increment` still takes a plain `i64`, not bytes -- see
that crate's own docs for why) -- `wire.rs`'s conversions exist so the
schema is proven correct by a real round trip
(`../tests/flatbuffers_round_trip.rs`), not left as "it compiles."

## Why a `union` of per-variant tables, not one flat table

`Command`/`DomainEvent` are Rust sum types (four variants each). A
FlatBuffers `union` of one table per variant (rather than one flat table
with a discriminant field and every variant's fields marked optional)
gets `flatc`'s own structural verifier for free -- it rejects a decoded
message whose type tag doesn't match its payload table, satisfying
§10.4's "untrusted messages are verified before use" without a
hand-written cross-field check. It also lets each variant evolve
independently instead of entangling field names shared across unrelated
variants (`amount` on `Increment`/`Decrement`, `new_value` on three of
`DomainEvent`'s four variants). `Snapshot` isn't a sum type, so
`snapshot.fbs` is a single table, no union.

`Snapshot.rng_seed`/`state_hash` are `[u8; 32]` on the Rust side but
`[ubyte]` (variable-length) here, not a FlatBuffers fixed-length
`struct` array -- `struct` is reserved for truly stable layouts (§10.4),
and these are explicitly "versionable messages." `src/wire.rs` validates
the decoded length is exactly 32 by hand; a wrong-length buffer is
rejected, not truncated or panicking (see
`../tests/flatbuffers_round_trip.rs`'s
`a_wrong_length_rng_seed_is_rejected_not_truncated`).

## Regenerating

```bash
nx run engine-domain-core:generate
```

Writes Rust into `../src/generated/` (gitignored, wired via
`../src/contracts.rs`), TS into
`../../../packages/isekai-web-client/src/generated/`, and C# into
`../../../dotnet/Grafting.Isekai.Protocol/Generated/` -- all three
gitignored (§10.3: not the source of truth, regenerated on demand).

Rust and TS use the primary pinned `flatc` (`tools/flatc-version.txt`,
on `PATH`). **C# uses a second, older, separately-pinned `flatc`**
(`tools/scripts/get-flatc-csharp.ps1`, downloaded on demand) --
`Google.FlatBuffers` on NuGet lags the primary pin (confirmed: NuGet's
latest is several releases behind crates.io's/npm's), and generated C#
embeds a version-marker call
(`FlatBufferConstants.FLATBUFFERS_<version>()`) that only compiles
against a runtime published by the *same* generator version. Not a
theoretical risk -- this failed to compile with the primary `flatc`
during this task, confirmed empirically. Re-check NuGet periodically and
drop the second pin once it catches up.

## C-006: the evolution/compatibility test

`fixtures/command_v1.fbs` is a frozen, committed copy of `command.fbs`
from before `Increment` gained `sequence_hint`. Its generated Rust code
(`../tests/generated_v1/command_v1_generated.rs`) is committed too, via
the documented exception in
`docs/adr/ADR-0009-committed-flatbuffers-fixture.md` -- see that ADR for
why. `../tests/flatbuffers_evolution.rs` encodes with the old schema and
decodes with the current one (and the reverse), proving §10.4's
backward/forward-compatibility rules hold for real. Never hand-edit
`fixtures/command_v1.fbs` or its generated code; a future "v2" fixture
would be a new frozen file, not a regeneration of this one.

## Deliberately not done, and why

- **`ReplicationDelta`** -- not modeled anywhere yet (Phase 6/Epic H).
- **VTT map state** -- no live persistence, Worker, or transport consumer owns
  this wire boundary yet. E1.5 removed the stale unconsumed schema rather than
  replacing it with another speculative contract.
- **Rewiring `engine_submit_increment`/`WasmEngine::submit_increment`
  to a generic byte-oriented `engine_submit`** (master source §11.6) --
  a separate, larger, not-yet-backlogged task; C-005/C-006's own
  criteria are schema generation + an evolution test, not this.
- **TS/C# round-trip consumers** -- both are verified compile-only
  (`tsc --noEmit`, `dotnet build`), since neither has a real consumer of
  these types yet either (same "no live consumer" honesty as the Rust
  side, just without the round-trip proof Rust gets from `wire.rs`).
