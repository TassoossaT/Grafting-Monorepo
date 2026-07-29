using System.Runtime.InteropServices;

namespace Grafting.Isekai.Interop;

/// <summary>
/// Mirrors <c>grafting-isekai-capi</c>'s <c>EngineCreateInfo</c> (Rust
/// <c>engine.rs</c>) exactly, including the explicit RNG seed (master
/// source DEC-044: the seed must be caller-visible/reproducible, never
/// silently defaulted inside Rust).
/// </summary>
[StructLayout(LayoutKind.Sequential)]
internal unsafe struct EngineCreateInfo
{
    public uint StructSize;
    public fixed byte Seed[32];
}

/// <summary>
/// Mirrors <c>grafting-isekai-capi</c>'s <c>EngineAbiInfo</c> (Rust
/// <c>abi_info.rs</c>) exactly. See master source S12.3 -- this is a
/// scoped-down v1 (no build ID/target fields yet).
/// </summary>
[StructLayout(LayoutKind.Sequential)]
internal struct EngineAbiInfo
{
    public uint StructSize;
    public uint AbiMajor;
    public uint AbiMinor;
    public uint FeatureFlags;
    public uint ProtocolVersion;
}

/// <summary>
/// Raw P/Invoke declarations. Nothing here is public -- <see cref="Engine"/>
/// is the safe surface consumers use (master source S12.6).
/// </summary>
internal static partial class NativeMethods
{
    private const string LibraryName = "grafting_isekai_capi";

    [LibraryImport(LibraryName)]
    public static unsafe partial EngineStatus engine_get_abi_info(EngineAbiInfo* outInfo);

    [LibraryImport(LibraryName)]
    public static unsafe partial EngineStatus engine_create(EngineCreateInfo* createInfo, ulong* outEngine);

    [LibraryImport(LibraryName)]
    public static partial EngineStatus engine_shutdown(ulong engine);

    [LibraryImport(LibraryName)]
    public static partial EngineStatus engine_destroy(ulong engine);

    [LibraryImport(LibraryName)]
    public static unsafe partial EngineStatus engine_submit_increment(ulong engine, long amount, ulong* outJob);

    [LibraryImport(LibraryName)]
    public static partial EngineStatus engine_debug_trigger_panic(ulong engine);

    [LibraryImport(LibraryName)]
    public static unsafe partial EngineStatus engine_debug_job_count(ulong engine, ulong* outCount);

    [LibraryImport(LibraryName)]
    public static unsafe partial EngineStatus engine_debug_buffer_count(ulong engine, ulong* outCount);

    [LibraryImport(LibraryName)]
    public static unsafe partial EngineStatus engine_job_poll(ulong engine, ulong job, JobStateCode* outState);

    [LibraryImport(LibraryName)]
    public static unsafe partial EngineStatus engine_job_take_result(ulong engine, ulong job, ulong* outBuffer);

    [LibraryImport(LibraryName)]
    public static partial EngineStatus engine_job_release(ulong engine, ulong job);

    [LibraryImport(LibraryName)]
    public static unsafe partial EngineStatus engine_buffer_view(ulong engine, ulong buffer, byte** outData, ulong* outLength);

    [LibraryImport(LibraryName)]
    public static partial EngineStatus engine_buffer_release(ulong engine, ulong buffer);
}
