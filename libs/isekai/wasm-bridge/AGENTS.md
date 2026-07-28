# AGENTS.md -- `isekai-wasm-bridge`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

This crate is the Wasm boundary (master source S4.2, S11.7). It MUST NOT
build a general Command/DomainEvent byte codec without C-005/C-006
(FlatBuffers) landing first -- see `README.md`.

**Do not add a Rust-side `Poisoned` lifecycle variant or a `catch_unwind`
call expecting it to work.** `src/engine.rs`'s module docs record an
empirically-verified fact: panics are not catchable in Rust on
`wasm32-unknown-unknown`. Any change touching panic/error handling here
must re-read that module's docs first, not assume native-side behavior
transfers.

Do not expose raw offsets/pointers to JS -- `wasm-bindgen`'s own
`Vec<u8>`/object-handle marshaling is the boundary; JS never sees a
memory address.
