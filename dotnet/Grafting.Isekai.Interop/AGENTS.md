# AGENTS.md -- `Grafting.Isekai.Interop`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

Generic, engine-free by construction (ADR-0002 Track 1) -- MUST NOT take
a dependency on any game engine SDK. `NativeMethods` stays `internal`;
`Engine` (and the `*SafeHandle` types) are the only public surface (S12.6:
centralized status translation, no raw P/Invoke exposed to consumers).

Never return or store a `Span`/pointer from a buffer view past its lease
-- always go through `Engine.WithBufferView`'s callback shape.
