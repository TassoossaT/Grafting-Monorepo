# ADR-0003: Platforms supported in V1 (GATE-003)

- Status: **Accepted — GATE-003 closed.**
- Proposal date: 2026-07-26
- Decision date: 2026-07-26
- Related gate: `GATE-003`
- Related gates (interaction, not scope of this ADR): `GATE-006` (fallback policy when
  WebGPU is unavailable), `GATE-002` (desktop engine defines viable RIDs)
- Authority: in case of conflict, `GRAFTING_MASTER_SOURCE.md` prevails over this ADR.

## Context

`GATE-003` defines the CI matrix and the formats published in V1. Together with GATE-001
and GATE-002, it blocks the final scaffold of the applications
(`docs/decisions/DECISION-LOG.md` §3.3). The Rust core
itself is portable; the real limitation lies in the hosts (Web, Desktop) and the GPU backend
(DEC-008, `wgpu`/WebGPU with guaranteed CPU fallback per DEC-009).

## Options considered

The master source already records a **suggested pragmatic default** (`docs/decisions/GATES.md`, GATE-003):

- Web: modern browsers with WebAssembly.
- Web GPU: WebGPU when available.
- Desktop V1: Windows x64.
- Linux/macOS: core compilable and progressively validated, without promising a final
  client in the first milestone.

Broader alternative (higher cost): include Linux x64 and/or macOS arm64 as published desktop
clients already in V1, requiring a native CI matrix (section 18.3) and additional RIDs from
the start, as well as expanding the validation surface of the engine chosen in `GATE-002`.

## Objective decision criteria

1. Actual expected user-base size per platform (owner information, not engineering).
2. Cost of native runners per additional platform in CI (section 18.3).
3. Maturity of WebGPU in target browsers and the need for a fallback policy (`GATE-006`).
4. Packaging effort per RID imposed by the engine coming out of `GATE-002`.

## Recommendation (adopted)

Default already recorded in the master source — modern Web + WebGPU when available, Desktop
V1 restricted to Windows x64, with Linux/macOS kept only as core compilation targets (not as
a published client).

## Consequences

- V1 CI needs only a native Windows runner for the desktop client, reducing cost and
  complexity (section 18.3).
- Linux/macOS continue to be validated via core builds (not the full client), preserving the
  option to expand without rewriting the core.
- The **Polymath** package (DEC-042,
  `docs/adr/ADR-0006-polymath-platform-abstraction.md`) is the mechanism that makes this
  restriction cheap to reverse: since all OS/runtime inspection is already isolated in
  `polymath`/`@grafting/polymath`/`Grafting.Polymath`, adding Linux and/or macOS as
  published clients later means implementing new variants within those modules (going from
  "stub" to "supported"), not rewriting the core or the hosts.
- Closes a precondition of the scaffold checklist (section 27) together with GATE-001;
  `GATE-002` remains the sole outstanding item of that trio.

## Risks

- If there is market expectation (e.g., a Linux/macOS VTT community) not communicated to
  engineering, deferring the client for those platforms could be a mistaken product
  decision — mitigated by the fact that Polymath keeps that door open at no rework cost,
  rather than by an informal promise.
- The engine choice in `GATE-002` may make Linux/macOS desktop more or less expensive to
  add later; this must be checked when `GATE-002` is resumed.

## Decision

> **Closed on 2026-07-26 by the project owner.** V1 scope: **Windows x64 only** as the
> published desktop client. Linux/macOS remain as core compilation targets, validated
> progressively, with no packaged client in V1. Rationale: the Polymath package (DEC-042)
> already exists specifically to absorb platform differences, so restricting to Windows in
> V1 is a sequencing decision (what gets published first), not an architectural limitation —
> expanding to Linux/macOS later does not require rewriting the core, hosts, or business
> logic.

## Next steps after closing

- [x] Update `docs/decisions/DECISION-LOG.md` (record as `LOCKED`) citing this ADR —
      done in this revision (see new DEC).
- [ ] Define the native CI matrix (section 18.3) with the corresponding Windows runner.
- [ ] Close `GATE-006` (fallback policy without WebGPU) separately — remains open.
