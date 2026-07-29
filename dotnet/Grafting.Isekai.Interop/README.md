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
`../Grafting.Isekai.Interop.Tests` -- 13 tests (`EngineSmokeTests.cs`),
all passing, covering the realistically-reachable subset of master
source S19.4's ABI test list (see that project's own file header for the
full list and what's flagged as out of reach this pass).

D-009 (memory test) adds `MemorySmokeTests.cs` (2 tests): one persistent
`Engine` driven through 5,000 `IncrementAndWait` cycles proving the
native handle tables stay bounded (via two new test-only exports,
`DebugJobCount`/`DebugBufferCount`), and a GC-finalizer test that
deliberately abandons a `JobSafeHandle` without disposing it, forces a
blocking collection, and confirms the native handle was really released
-- the concrete "caller forgot `Dispose()`" scenario `SafeHandle` exists
for, which nothing else in this project exercised before. That test
keeps its `Engine` (and `EngineSafeHandle`) rooted for its whole
duration on purpose: `JobSafeHandle`/`BufferSafeHandle.ReleaseHandle()`
call back into their owning `EngineSafeHandle`, and .NET does not
guarantee finalization order between two independently-finalizable
objects that become garbage at the same time.

RID packaging targets `win-x64` only, matching GATE-003's current V1
scope -- no multi-RID attempt yet.
