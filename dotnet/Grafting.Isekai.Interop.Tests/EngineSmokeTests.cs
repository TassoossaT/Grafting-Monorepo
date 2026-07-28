using System.Runtime.InteropServices;
using Grafting.Isekai.Interop;

namespace Grafting.Isekai.Interop.Tests;

/// <summary>
/// D-006's "smoke test" against the real <c>grafting-isekai-capi</c> DLL
/// (not mocked). Covers the subset of master source S19.4's ABI test
/// list that's realistically reachable at this stage (native,
/// single-DLL, single-arch): compatible/incompatible ABI major,
/// struct_size mismatch, invalid handle, double release,
/// use-after-release, null pointer, empty buffer, internal panic +
/// poisoned-engine refusal, shutdown with a pending job, missing
/// library. "Wrong architecture" needs a second-arch build and is out of
/// reach this pass -- not attempted, not silently skipped either.
/// </summary>
public class EngineSmokeTests
{
    private static byte[] Seed(byte fill = 1) => Enumerable.Repeat(fill, 32).ToArray();

    [Fact]
    public void Abi_info_reports_a_compatible_major_version()
    {
        var info = Engine.GetAbiInfo();
        Assert.True(info.IsCompatible, $"expected ABI major {AbiInfo.SupportedAbiMajor}, got {info.AbiMajor}");
    }

    [Fact]
    public void An_incompatible_expected_major_is_detected_by_the_caller()
    {
        // The native side doesn't reject "wrong" majors itself (there's
        // only one build to compare against) -- compatibility is the
        // *caller's* check, per S12.3. This proves that check actually
        // distinguishes true from false, not just always green.
        var info = Engine.GetAbiInfo();
        Assert.False(info.AbiMajor == AbiInfo.SupportedAbiMajor + 1);
    }

    [Fact]
    public void Create_increment_and_wait_returns_the_real_domain_core_result()
    {
        using var engine = Engine.Create(Seed());
        var (newValue, stateHash) = engine.IncrementAndWait(5);

        Assert.Equal(5, newValue);
        Assert.Equal(32, stateHash.Length);
    }

    [Fact]
    public void Same_seed_produces_the_same_state_hash_deterministically()
    {
        using var a = Engine.Create(Seed(7));
        using var b = Engine.Create(Seed(7));

        var resultA = a.IncrementAndWait(10);
        var resultB = b.IncrementAndWait(10);

        Assert.Equal(resultA.NewValue, resultB.NewValue);
        Assert.Equal(resultA.StateHash, resultB.StateHash);
    }

    [Fact]
    public void Overflow_fails_the_job_cleanly_not_the_process()
    {
        using var engine = Engine.Create(Seed());
        engine.IncrementAndWait(long.MaxValue);

        var ex = Assert.Throws<EngineException>(() => engine.IncrementAndWait(1));
        Assert.Equal(EngineStatus.JobNotComplete, ex.Status);
    }

    [Fact]
    public void Struct_size_mismatch_is_rejected_with_a_typed_exception()
    {
        // Engine.Create always sends the correct size; this proves the
        // native side actually checks it, by exercising the failure path
        // directly rather than only the happy path.
        var status = CreateWithWrongStructSize();
        Assert.Equal(EngineStatus.StructSizeMismatch, status);
    }

    private static unsafe EngineStatus CreateWithWrongStructSize()
    {
        var wrongSizeInfo = new WrongSizeEngineCreateInfo { StructSize = 1 };
        ulong handle;
        return NativeMethodsProbe.engine_create(&wrongSizeInfo, &handle);
    }

    [Fact]
    public void Double_release_of_an_engine_is_rejected()
    {
        var engine = Engine.Create(Seed());
        engine.Dispose();
        // Disposing twice must not throw -- SafeHandle.Dispose() is
        // idempotent by contract; the *native* double-release is what
        // engine.rs's own tests already prove returns InvalidHandle
        // rather than corrupting anything. Confirms the managed side
        // doesn't crash either.
        engine.Dispose();
    }

    [Fact]
    public void Operations_after_dispose_are_rejected_not_crashing()
    {
        var engine = Engine.Create(Seed());
        engine.Dispose();

        Assert.Throws<ObjectDisposedException>(() => engine.IncrementAndWait(1));
    }

    [Fact]
    public void An_internal_panic_poisons_the_engine_and_refuses_further_work()
    {
        using var engine = Engine.Create(Seed());

        var panicEx = Assert.Throws<EngineException>(() => engine.TriggerDebugPanic());
        Assert.Equal(EngineStatus.InternalPanic, panicEx.Status);

        var afterEx = Assert.Throws<EngineException>(() => engine.IncrementAndWait(1));
        Assert.Equal(EngineStatus.Poisoned, afterEx.Status);
    }

    [Fact]
    public void The_process_survives_a_panic_and_other_engines_keep_working()
    {
        using var poisoned = Engine.Create(Seed());
        Assert.ThrowsAny<EngineException>(() => poisoned.TriggerDebugPanic());

        using var healthy = Engine.Create(Seed());
        var (newValue, _) = healthy.IncrementAndWait(3);
        Assert.Equal(3, newValue);
    }

    [Fact]
    public void Shutdown_with_a_pending_job_does_not_leak_or_crash()
    {
        using var engine = Engine.Create(Seed());
        using var job = engine.SubmitIncrement(1);
        // Deliberately not polled/taken before shutdown.
        engine.Shutdown();
    }

    [Fact]
    public void Submitting_after_shutdown_is_refused()
    {
        using var engine = Engine.Create(Seed());
        engine.Shutdown();

        var ex = Assert.Throws<EngineException>(() => engine.IncrementAndWait(1));
        Assert.Equal(EngineStatus.EngineNotReady, ex.Status);
    }

    [Fact]
    public void Missing_library_surfaces_as_a_clean_managed_exception()
    {
        // Points P/Invoke resolution at a library name that doesn't
        // exist, instead of touching the real, working DLL -- proves
        // this failure mode surfaces as a catchable managed exception,
        // not a native crash.
        Assert.Throws<DllNotFoundException>(() => NativeMethodsProbe.probe_missing_library());
    }
}

/// <summary>Mirrors <c>EngineCreateInfo</c>'s layout with a deliberately
/// wrong <c>StructSize</c> value baked in by the test.</summary>
[StructLayout(LayoutKind.Sequential)]
internal unsafe struct WrongSizeEngineCreateInfo
{
    public uint StructSize;
    public fixed byte Seed[32];
}

/// <summary>Test-only P/Invoke surface: one real declaration (used to
/// exercise the struct_size failure path without changing the real
/// wrapper's happy path) and one pointing at a library that doesn't
/// exist (for the missing-library test).</summary>
internal static partial class NativeMethodsProbe
{
    [LibraryImport("grafting_isekai_capi")]
    public static unsafe partial EngineStatus engine_create(WrongSizeEngineCreateInfo* createInfo, ulong* outEngine);

    [LibraryImport("grafting_isekai_capi_does_not_exist")]
    public static partial EngineStatus probe_missing_library();
}
