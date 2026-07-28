# `Grafting.Isekai.Interop`

Safe, generic .NET wrapper over `grafting-isekai-capi`. No engine
dependency (`docs/adr/ADR-0002-engine-desktop.md` Track 1). See master
source S12.6.

## Current status

D-006 done: `SafeHandle` subclasses per handle kind (`EngineSafeHandle`,
`JobSafeHandle`, `BufferSafeHandle` -- jobs/buffers hold a reference to
their owning engine handle, since they're scoped per-engine natively),
`LibraryImport` P/Invoke declarations (`NativeMethods`, internal),
centralized `EngineStatus` → `EngineException` translation, idempotent
`Dispose`. Buffer bytes are exposed only via `Engine.WithBufferView`'s
callback -- never returned or stored past the lease.

`Engine.GetAbiInfo()` is the S12.3 "C# wrapper validates this at startup"
entry point -- `AbiInfo.IsCompatible` checks `AbiMajor` against what this
wrapper was built against.

Smoke-tested against the real DLL (not mocked) in
`../Grafting.Isekai.Interop.Tests` -- 13 tests, all passing, covering the
realistically-reachable subset of master source S19.4's ABI test list
(see that project's own file header for the full list and what's flagged
as out of reach this pass).

RID packaging targets `win-x64` only, matching GATE-003's current V1
scope -- no multi-RID attempt yet.
