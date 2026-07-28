# AGENTS.md -- `isekai-capi-bridge`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

This crate is the C ABI boundary (master source S4.2, S11). It MUST:

- validate every pointer/length/handle before use, never trust the
  caller;
- wrap every risky call in `catch_unwind` -- no unwind may ever cross
  `extern "C"` (S21.2);
- never expose `Vec`/`String`/trait objects/a Rust enum without a fixed
  representation across the boundary (S11.2);
- mark an engine `Poisoned` explicitly on a caught panic and refuse
  further work on it -- never silently recover and continue (S12.5).

It MUST NOT build a general Command/DomainEvent byte codec without
C-005/C-006 (FlatBuffers) landing first -- see `README.md`. Do not add a
second concretely-typed operation here as a workaround for "we need more
than Increment" -- that pressure is exactly the signal that the real,
generic `engine_submit` (and FlatBuffers contracts) are needed, not
another one-off function.
