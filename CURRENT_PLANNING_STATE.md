# Current planning state

> **Type:** mutable operational status
> **Authority:** does not alter the architecture; in case of conflict,
> `GRAFTING_MASTER_SOURCE.md` wins.
> **Updated on:** July 26, 2026

## Situation

- Git repository created on July 26, 2026; first documentation commit made.
- `README.md`, `GRAFTING_MASTER_SOURCE.md` (v1.8.0), `CURRENT_PLANNING_STATE.md`,
  `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `docs/adr/` (8 ADRs), and a minimal
  `.ai/` (`README.md` + the `task-completion` skill, active) all exist. The
  remaining directories from the canonical `.ai/` layout (section 29.1) have
  not been created yet.
- English is now the default documentation language for the entire
  repository (DEC-047): every pre-existing Portuguese document was
  translated to English in this pass. This supersedes the earlier rule that
  only required new files to be written in English going forward.
- No workspaces, lockfiles, applications, crates, pipelines, installed
  toolchains (except git/node/dotnet on the owner's machine), or running
  infrastructure exist yet. The project is exclusively in the architecture
  and preparation phase — none of this should be treated as implemented.
- The active architectural source is `GRAFTING_MASTER_SOURCE.md`; `docs/adr/`
  is the decision history that feeds it.

## Current phase

```text
planning
→ adversarial review           (not yet formally executed)
→ closing the Decision Gates     ← done
→ ADRs                            ← done
→ full English translation pass   ← done
→ disposable spikes                ← next step
→ scaffold
```

## Decision Gates — consolidated status

| Gate | Status | Decision | Record |
| --- | --- | --- | --- |
| GATE-001 | **closed** | Web host = Next.js; the VTT is a client-only route, not the whole app | DEC-041 · ADR-0001 |
| GATE-002 | open, **formally deferred** | The C# engine choice awaits a concrete game; generic `isekai-capi`/`Grafting.Isekai.Interop` work is released | ADR-0002 |
| GATE-003 | **closed** | V1 desktop client = Windows x64; Linux/macOS core-build only | DEC-043 · ADR-0003 |
| GATE-004 | open, **formally deferred** | The authoritative server host choice awaits Phase 6 / Epic H | ADR-0005 |
| GATE-005 | **closed** | Replay determinism on the same platform/build; GPU never writes directly to the state hash | DEC-044 · ADR-0004 |
| GATE-007 | **closed** | Single monorepo; "selling" a product means packaging that app's artifact, not splitting the repository | DEC-045 · ADR-0007 |
| GATE-006, 008, 009 | open, unprioritized | WebGPU-less fallback; license/proprietary policy; multiplayer persistence | — |

No agent may close GATE-002, GATE-004, or any gate from GATE-006 to
GATE-009 without an explicit decision from the owner.

## Complementary structural decisions (not numbered gates)

| Decision | Content | Record |
| --- | --- | --- |
| Polymath | One package per runtime (`polymath`/`@grafting/polymath`/`Grafting.Polymath`) is the only place allowed to inspect OS/runtime/RID | DEC-042 · ADR-0006 |
| `libs/` boundary + domain map | A capability used by more than one product is born in `libs/domains`/`packages/`, never duplicated inside an app. Initial map: `narrative` and `session` are generic; the VTT's X6 map is product-specific (only `packages/x6-canvas` is shared with the Architecture Studio); Discord and transcription are external integrations, not domains | DEC-046 · ADR-0008 · master source §4.4 |
| Documentation language | English is the default documentation language repository-wide; all pre-existing Portuguese docs were translated | DEC-047 · master source §3.1 |

Pending, but not blocking Phase 0: standard directory for external
integrations (`apps/integrations/` vs. `tools/`) once Discord/transcription
move from idea to implementation.

Full ADR index, with status and links: `docs/adr/README.md`.

## Foundational spikes planned (Phase 0 — next step)

1. Rust → Wasm in a Dedicated Worker, under the Next.js host (GATE-001);
2. generic Rust C ABI/DLL → C# (`isekai-capi` + `Grafting.Isekai.Interop`),
   without choosing an engine — independent of GATE-002;
3. the same WGSL shader in native and Web wgpu, respecting the GATE-005
   determinism floor (GPU never writes directly to the state hash);
4. Polymath v0 (`libs/platform/polymath`, `packages/polymath`) — real
   support for Windows only, explicit stubs for other platforms;
5. batching and copy-budget benchmark;
6. initial Nx and toolchain validation;
7. minimal Graph IR and read-only X6 visualization;
8. minimal AI Control Plane, without a gateway or advanced self-evolution.

Toolchain on the owner's machine (verified 2026-07-26): git, node, and
dotnet installed; **missing**: rustc/cargo, pnpm, uv, wasm-pack, flatc
(the last one is only needed starting in Phase 2).

## Recommended next action

Structural planning is complete — every priority gate and the multi-product
reuse decisions are either resolved or formally deferred, and the full
repository documentation set is now in English (DEC-047). The next step is
to install the missing toolchains and start spikes 1–4 above, in that order
or in parallel.

## Update rule

This file records only: real status, current phase, next steps, blockers,
and decisions awaiting the owner. Actual architectural decisions live in the
master source or an ADR — this file points to them, it does not repeat them.
