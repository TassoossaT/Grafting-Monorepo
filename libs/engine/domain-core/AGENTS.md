# AGENTS.md -- `engine-domain-core`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

This crate is pure domain logic (`GRAFTING_MASTER_SOURCE.md` S4.2). It
MUST NOT depend on: Three.js, C#, Web APIs, sockets, a database, `wgpu`,
the host filesystem, or a non-injected global clock. It MUST NOT inspect
`cfg(target_os)`/RID directly (DEC-042 -- that belongs in `polymath`).

Epic C (C-001, C-002, C-003, C-007, C-004, C-008) is done, against a
deliberately generic example domain (a "tally counter") -- not a real
game/VTT domain, since none is specified in the docs. Do not add real
game/product domain rules here without an explicit product decision
first; do not add multiplayer (`AcceptedCommand`, journal,
`ReplicationDelta`) here -- that's Phase 6/Epic H, in a different scope.

C-005/C-006 (FlatBuffers codegen/schema evolution) stay out of this crate
until B-004 (the .NET solution) unblocks them -- see `README.md`.
