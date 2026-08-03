# ADR-0002: Desktop game engine in C# (GATE-002)

- Status: **Engine decision in indefinite standby; generic ABI feasibility proven.**
  This ADR does not close the gate. Work resumes only when the owner explicitly starts a
  concrete C# game project.
- Date: 2026-07-26 (proposed and revised on the same day)
- Related gate: `GATE-002`
- Already-`LOCKED` decisions that constrain the choice space: DEC-001 (Rust is the single
  source of logic/solver — the engine never duplicates rules), DEC-006 (dotnet/MSBuild),
  DEC-011 (versioned C ABI with opaque handles), DEC-010 (batched FFI calls)
- Related `PROVISIONAL` decision: PROV-001 (`@nx/dotnet`, subject to maturity validation in
  a spike)
- Authority: in case of conflict, `GRAFTING_MASTER_SOURCE.md` prevails over this ADR.

## Context

The core (`domain-core`, `compute-*`) is Rust and is exposed to the C# world only through
the `isekai-capi` boundary (C ABI, generational handles, `catch_unwind`, never exposing
Rust `Vec`/`String`/enum — sections 4.2 and 11 of the master source). The master source is
explicit:

> The core must not assume Unity, Godot, or another engine until the gate closes.

This means this ADR cannot be decided by engine preference alone — it needs to assess how
each engine hosts a native Rust DLL via P/Invoke, under the threading and packaging model
already defined for the core.

## Owner input (2026-07-26)

There is not yet a concrete C# game or engine under evaluation. The original purpose of
having Rust as the core was to enable this integration *if* it ever becomes necessary — not
to commit to a specific engine ahead of time. Deciding now would mean choosing without a
real project to validate against.

This is exactly the situation the master source already anticipated: "the core must not
assume Unity, Godot, or another engine until the gate closes" (`docs/decisions/GATES.md`).
The correct
response is not to invent a choice, nor to lock all C#-related work — it is to separate what
is generic by construction from what is engine-specific.

### Standby confirmation (2026-07-28)

The owner confirmed that GATE-002 remains paused for an indefinite period. The implemented
C ABI and generic C# interop were intended to prove feasibility; that objective is now met.
No engine comparison, desktop scaffold, engine-specific wrapper, or further C# game work is
authorized until the owner explicitly resumes this gate with a concrete game project.

### Two tracks

**Track 1 — generic, can proceed now, without choosing an engine.**
The `isekai-capi` boundary is already designed to be engine-agnostic (simple C ABI, opaque
generational handles, `catch_unwind`, batched calls — DEC-010, DEC-011, sections 4.2 and 11).
This means the ABI itself can be built and validated with:

- the Rust `isekai-capi` crate (`extern "C"` exports, ABI version, handle creation/release,
  status codes);
- the generic .NET interop library already planned in the section 6.1 tree,
  `dotnet/Grafting.Isekai.Interop/`, as a pure class library with no dependency on any engine
  SDK — only P/Invoke against the DLL/cdylib;
- a simple validation harness (console app or .NET test project) that exercises
  create/execute/destroy and the error paths, satisfying the acceptance criterion of spike
  A-005 ("create/execute/destroy and error work") **without needing an engine**.

When an engine is chosen later, it consumes this generic library instead of talking directly
to the DLL — reducing migration cost and avoiding rework on the ABI.

**Track 2 — engine-specific, remains deferred.**
Only comes into play once there is a real game project:

- choice among Unity/Godot C#/MonoGame/Stride/custom engine;
- threading model and integration with the engine's loop;
- window/input access;
- native packaging per RID for that specific engine;
- license restrictions (intersects with `GATE-008`).

## Questions the gate needs to answer

1. Is it feasible to distribute and load a Rust DLL (cdylib) inside the engine, per
   RID/platform?
2. What is the engine's threading model, and how does it interact with synchronous and
   asynchronous FFI calls (sections 11.4/11.5)?
3. Is P/Invoke support direct, or does it require additional layers (e.g., IL2CPP, AOT
   trimming)?
4. How does the engine control native packaging per RID (win-x64, linux-x64,
   osx-x64/arm64)?
5. Is there a native-plugin policy that restricts unmanaged code?
6. How does the engine provide window/input access to integrate with the core?
7. Are there relevant license restrictions (intersects with `GATE-008`)?
8. Is it possible to run tests without opening the editor (headless/CI)?

## Options considered

| Option | P/Invoke → Rust DLL | Editor required for tests | License | Notes |
| --- | --- | --- | --- | --- |
| **Unity** | Supported via native plugins; IL2CPP may require extra marshaling validation (AOT) | Unity Test Framework runs in batch mode, but still depends on the Editor/CLI runtime | Commercial use may carry costs and terms that vary by revenue tier — check current terms before deciding (intersects `GATE-008`) | Largest ecosystem and asset-pipeline tooling |
| **Godot C# (.NET)** | Standard .NET interop, should work without an extra layer | Godot runs headless without opening the editor window | MIT | Smaller community than Unity; active .NET module (Godot 4+) |
| **MonoGame** | It's just a .NET application — direct P/Invoke, full control over threading | No editor — it's a framework, not a GUI engine | MIT | No scene editor/asset pipeline; more custom code (UI, tooling) |
| **Stride** | Native .NET, interop should be direct | Has an editor, but it's a regular .NET project | MIT | Much smaller community; less production-validated than the others |
| **Custom engine** | Full control | Full control | N/A | Increases project scope in the opposite direction from the "single core" principle; not recommended without strong justification |

These characterizations come from general knowledge about the tools, not from the master
source — **they must be validated by the Epic A spike (A-005, Rust/C# ABI)** before any
decision, testing at least the two finalists chosen by the owner.

## Objective decision criteria

1. Cost of validating P/Invoke + opaque-handle marshaling under the engine's execution model
   (managed/IL2CPP/CoreCLR).
2. Ability to run integration tests without a GUI, in CI.
3. Absence of license costs/terms incompatible with the policy that comes out of
   `GATE-008`.
4. Effort of native packaging per RID within the Nx pipeline (section 7.6).
5. Real need for an asset pipeline/scene editor for this type of game (desktop VTT).

## Recommendation

For Track 1 (generic): proceed now with `isekai-capi` + a generic .NET interop library
(`Grafting.Isekai.Interop`) + an engine-free validation harness, satisfying the spirit of
spike A-005 in an engine-agnostic way.

For Track 2 (engine choice): no default recommendation is made here — the master source
does not define a default for this gate (unlike GATE-001 and GATE-003) and calls for
evaluation against a real project before any assumption. Objective, non-binding observation,
preserved for when the gate is resumed: MonoGame and Godot C# eliminate the IL2CPP/AOT
variable and require no editor to test, which reduces FFI risk; Unity brings more ready-made
tooling but introduces marshaling-validation cost under IL2CPP and a licensing variable to
resolve alongside `GATE-008`. It is a product decision (tooling vs. control) that only makes
sense with a real game to calibrate against.

## Consequences

- The engine chosen in the future defines the *specific* C# wrapper for the ABI
  (section 12.6), the threading model on the desktop side (section 14.2), and the native
  distribution format per RID — but it does not redefine the ABI itself, which is already
  generic.
- `Grafting.Isekai.Interop` (Track 1) becomes the stable layer between `isekai-capi` and any
  future engine, isolating the cost of an eventual engine switch.

## Risks

- If the design of `Grafting.Isekai.Interop` implicitly assumes a specific threading model
  (e.g., calls only from the main thread), this may need adjustment once a concrete engine is
  chosen — keeping the API as close as possible to the ABI's pure batched contract (DEC-010)
  minimizes this risk.
- Unity, if chosen later: risk of licensing-terms changes during development — must be
  reassessed at the closing of `GATE-008` before committing.

## Decision

> **GATE-002 remains `OPEN`, formally deferred until a concrete C# game project exists** —
> owner decision on 2026-07-26. Authorized to proceed now, independent of this decision: the
> `isekai-capi` crate and the generic `Grafting.Isekai.Interop` library validated by a
> .NET harness without an engine. No agent should choose an engine by default nor treat this
> ADR as closing the gate.
>
> **Confirmed on 2026-07-28:** Track 1 is complete and the remaining Track 2 is in
> indefinite standby. Time passing, new agent sessions, or unrelated C# maintenance do not
> implicitly resume it.

## Next steps

- [x] Implement `isekai-capi` (Track 1) and the generic validation harness, covering the
      original acceptance criterion of spike A-005 without depending on an engine.
- Once a C# game project is defined: reopen this ADR, run spike A-005 specifically against
  the candidate engine(s), and only then fill in Track 2.
- Close `GATE-008` (license) alongside the engine choice, if it depends on that.
