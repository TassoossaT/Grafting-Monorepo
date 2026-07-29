using System.Runtime.CompilerServices;

namespace Grafting.Isekai.Interop.Tests;

/// <summary>
/// D-009's "no leak in the target scenario": one persistent
/// <see cref="Engine"/> driven through many repeated submit/poll/take/
/// view/release cycles -- proving the shape
/// <see cref="Engine.IncrementAndWait"/> already exercises once stays
/// bounded under repetition, not just correct on a single pass -- plus a
/// deliberately-undisposed handle proving <c>SafeHandle</c>'s
/// GC-finalizer safety net actually releases the native handle, not just
/// that nothing else happened to notice.
/// </summary>
public class MemorySmokeTests
{
    private static byte[] Seed(byte fill = 1) => Enumerable.Repeat(fill, 32).ToArray();

    [Fact]
    public void Repeated_increment_cycles_do_not_grow_native_handle_tables()
    {
        using var engine = Engine.Create(Seed());

        for (var i = 1; i <= 5_000; i++)
        {
            var (newValue, _) = engine.IncrementAndWait(1);
            Assert.Equal(i, newValue);
            Assert.Equal(0ul, engine.DebugJobCount());
            Assert.Equal(0ul, engine.DebugBufferCount());
        }
    }

    [Fact]
    public void An_undisposed_job_handle_is_still_released_by_its_finalizer()
    {
        // The Engine (and its EngineSafeHandle) must stay rooted for the
        // whole test: JobSafeHandle.ReleaseHandle() calls back into its
        // owning EngineSafeHandle, and .NET does not guarantee
        // finalization order between two independently-finalizable
        // objects that become garbage at the same time. Disposing
        // `engine` before the post-GC assertions below would
        // reintroduce that classic SafeHandle ordering hazard.
        using var engine = Engine.Create(Seed());

        Assert.Equal(0ul, engine.DebugJobCount());
        CreateAndAbandonJob(engine);
        Assert.Equal(1ul, engine.DebugJobCount());

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        Assert.Equal(0ul, engine.DebugJobCount());
    }

    // NoInlining: in an unoptimized build the JIT can otherwise extend a
    // local's liveness across this method's caller frame, which would
    // keep the JobSafeHandle rooted and defeat GC.Collect() above.
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void CreateAndAbandonJob(Engine engine)
    {
        _ = engine.SubmitIncrement(1);
        // Deliberately not disposed and not stored -- the only reference
        // goes out of scope here.
    }
}
