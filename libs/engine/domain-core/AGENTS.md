# AGENTS.md -- `engine-domain-core`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

This crate is pure domain logic (`GRAFTING_MASTER_SOURCE.md` S4.2). It
MUST NOT depend on: Three.js, C#, Web APIs, sockets, a database, `wgpu`,
the host filesystem, or a non-injected global clock. It MUST NOT inspect
`cfg(target_os)`/RID directly (DEC-042 -- that belongs in `polymath`).

Real business logic (Command, DomainEvent, Snapshot, state hash) belongs
to Epic C, not this scaffold task -- do not add domain rules here without
the corresponding Epic C task ID.
