# ADR-0004: Required degree of determinism (GATE-005)

- Status: **Accepted — GATE-005 closed.**
- Proposal date: 2026-07-26
- Decision date: 2026-07-26
- Related gate: `GATE-005`
- Related `LOCKED` decisions: DEC-016 (V1 multiplayer is authoritative replication with
  journal and snapshots, not full Event Sourcing), DEC-007/008/009 (GPU only in Rust, wgpu
  + CPU fallback)
- Related gates (interaction, not scope of this ADR): `GATE-004` (authoritative server
  host), `GATE-009` (multiplayer persistence)
- Authority: in case of conflict, `GRAFTING_MASTER_SOURCE.md` prevails over this ADR.

## Context

The master source (`docs/decisions/GATES.md`, GATE-005) distinguishes four notions of determinism that
cannot be treated as one:

1. **Semantic determinism** — the same input produces the same result with equivalent game
   meaning, without requiring identical bits.
2. **Same-platform replay determinism** — given the same binary/OS/CPU, replay reproduces
   exactly the same state.
3. **Cross-platform bit-for-bit determinism** — Windows, Linux, macOS, and Web produce the
   same result byte for byte.
4. **Mathematical validity within tolerance** — a result accepted within an error margin
   (`epsilon`), without requiring equality.

Rule already fixed: floating-point GPU must not be used for decisions that require
bit-for-bit equality between machines; a solver may use GPU for search and CPU to validate
the final solution (sections 5 and 13).

## Why this is not an isolated choice

The multiplayer model is already `LOCKED` as authoritative replication (DEC-016, section
15): the server is the single source of truth, the journal records `AcceptedCommand` +
`DomainEvents` + `state hash` (section 15.5), and recovery recomputes the hash from a
snapshot (section 15.7). This differs from peer-to-peer lockstep, where each client
recomputes the same state locally.

Objective consequence: since only the authoritative server computes the "true" state,
cross-platform bit-for-bit determinism is strictly necessary only if:

- the authoritative server can migrate between OS/CPU architecture in production, or
- there is client-side prediction/reconciliation that needs to match the server byte for
  byte, or
- there is replay/audit that needs to be verified on a platform different from the one that
  generated the journal.

Without these requirements, **same-platform replay determinism (level 2)** already covers
the journal/snapshot/state hash validation described in section 15.

## Options considered

| Level | Engineering cost | Covers journal/snapshot (section 15)? | Allows floating-point GPU on the authoritative path? |
| --- | --- | --- | --- |
| 1. Semantic | low | not on its own — lacks a guarantee of a stable state hash | yes |
| 2. Same-platform replay | medium | yes, if the authoritative server always runs on the same platform/build | yes, as long as final validation does not depend on bit-exactness across machines |
| 3. Cross-platform bit-exact | high (may require fixed-point/soft-float on the authoritative path) | yes, and also across host migrations | no — floating-point GPU is banned from the path requiring this equality |
| 4. Mathematical tolerance | low-medium | partially — useful for solver/physics, not for the journal hash | yes |

These levels are not mutually exclusive: it is possible, for example, to require level 2 for
the journal/state hash and level 4 for the physics/optimization solver, as long as the
boundary between the two is explicit (which is already the rule in section 13.5: GPU
searches, CPU validates).

## Objective decision criteria

1. Can the authoritative server migrate between different OS/CPU in production? (depends on
   `GATE-004`, still open)
2. Is there a requirement for auditable replay outside the platform that generated the
   journal? (intersects with `GATE-009`)
3. Will there be client-side prediction that needs to match the server byte for byte, or is
   the client always "dumb" and only applies `ReplicationDelta`?
4. Which subsystems (physics, pathfinding, solver) tolerate `epsilon` and which require a
   stable hash?

## Recommendation (adopted, with additional detail from the owner)

Same-platform replay determinism (level 2) for the authoritative path, mathematical
tolerance (level 4) for numerical subsystems and GPU, semantic (level 1) for non-authoritative
rendering/effects. Cross-platform bit-for-bit (level 3) is not a V1 requirement. The owner
specified precisely what "same platform" means and how GPU results relate to the state
hash — see Decision.

## Consequences

- `domain-core` may use standard numeric types (float) on the authoritative path, as long as
  build ID, target, protocol/schema versions, features, and numeric configuration are fixed
  per session — fixed-point/soft-float is not needed for V1.
- `compute-wgpu` never writes directly to the state hash: every GPU result passes through
  validation, canonicalization, and deterministic tie-breaking on the CPU before entering the
  authoritative path (reinforcing the rule in section 13.5 — GPU searches, CPU validates).
- The authoritative host stays fixed to a single target during a session; migrating targets
  mid-session is not supported in V1.
- Rendering and purely visual effects (non-authoritative) are free to use any
  precision/algorithm, requiring only semantic equivalence.

## Risks

- Migrating the authoritative host's target during a session breaks the "same platform"
  premise (build ID, protocol/schema, numeric config, RNG) — hence the decision fixes this as
  an operational rule, not merely an engineering assumption.
- This decision will be revisited when `GATE-004` (authoritative host) and `GATE-009`
  (multiplayer persistence) are closed, in case they change the premises around host
  migration between sessions or in the long term.

## Decision

> **Closed on 2026-07-26 by the project owner.**
>
> V1 will adopt same-platform-and-build replay determinism for the authoritative path,
> including command ordering, RNG, DomainEvents, snapshots, and state hash.
>
> "Same platform" means the same build ID, target, protocol and schema versions, features,
> numeric configuration, and RNG algorithm.
>
> Numerical subsystems and GPU compute will use mathematical validity within explicitly
> defined tolerances. GPU results will not directly alter the authoritative state nor enter
> the state hash raw: they will be validated, canonicalized, and subjected to deterministic
> tie-breaking on the CPU.
>
> Non-authoritative rendering and effects require only semantic determinism.
>
> Cross-platform bit-for-bit determinism will not be a V1 requirement. The authoritative host
> will remain fixed to a target during a session, and this decision will be revisited when
> `GATE-004` and `GATE-009` are closed.

## Next steps

- [x] Update `docs/decisions/DECISION-LOG.md` (record as `LOCKED`) citing this ADR —
      done in this revision (see new DEC).
- [ ] Revisit this decision when `GATE-004` and `GATE-009` are closed, in case they change
      the premises around host migration or persistence.
- [ ] Define, in a spike or complementary ADR, the exact format of "numeric configuration
      and RNG algorithm" fixed per build (for use in `Command`/`DomainEvent`/`Snapshot`,
      section 15.2).
