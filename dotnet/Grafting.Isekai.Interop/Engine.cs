namespace Grafting.Isekai.Interop;

/// <summary>
/// Safe wrapper over one <c>grafting-isekai-capi</c> engine instance --
/// one <c>domain_core::State</c> + one seeded RNG, i.e. one "session"
/// (master source S11.6 conceptual API, scoped down per this task's plan:
/// only <c>SubmitIncrement</c> is exposed, not a generic
/// <c>engine_submit(bytes)</c> -- see <c>grafting-isekai-capi</c>'s
/// crate-level docs for why).
/// </summary>
public sealed class Engine : IDisposable
{
    private readonly EngineSafeHandle _handle;
    private bool _disposed;

    private Engine(EngineSafeHandle handle)
    {
        _handle = handle;
    }

    public static unsafe AbiInfo GetAbiInfo()
    {
        EngineAbiInfo info;
        var status = NativeMethods.engine_get_abi_info(&info);
        ThrowIfNotOk(status);
        return new AbiInfo(info.AbiMajor, info.AbiMinor, info.FeatureFlags, info.ProtocolVersion);
    }

    /// <param name="seed">Exactly 32 bytes -- the RNG seed, caller-visible
    /// and caller-controlled on purpose (DEC-044).</param>
    public static Engine Create(ReadOnlySpan<byte> seed)
    {
        if (seed.Length != 32)
        {
            throw new ArgumentException("seed must be exactly 32 bytes", nameof(seed));
        }

        EngineStatus status;
        ulong raw;
        unsafe
        {
            var createInfo = new EngineCreateInfo { StructSize = (uint)sizeof(EngineCreateInfo) };
            for (var i = 0; i < 32; i++)
            {
                createInfo.Seed[i] = seed[i];
            }

            status = NativeMethods.engine_create(&createInfo, &raw);
        }
        ThrowIfNotOk(status);

        var handle = new EngineSafeHandle();
        handle.SetRaw(raw);
        return new Engine(handle);
    }

    public JobSafeHandle SubmitIncrement(long amount)
    {
        ThrowIfDisposed();
        EngineStatus status;
        ulong jobRaw;
        unsafe
        {
            status = NativeMethods.engine_submit_increment(_handle.Raw, amount, &jobRaw);
        }
        ThrowIfNotOk(status);

        var job = new JobSafeHandle(_handle);
        job.SetRaw(jobRaw);
        return job;
    }

    public JobStateCode Poll(JobSafeHandle job)
    {
        ThrowIfDisposed();
        EngineStatus status;
        JobStateCode state;
        unsafe
        {
            status = NativeMethods.engine_job_poll(_handle.Raw, job.Raw, &state);
        }
        ThrowIfNotOk(status);
        return state;
    }

    /// <summary>Throws <see cref="EngineException"/> with
    /// <see cref="EngineStatus.JobNotComplete"/> if the job hasn't
    /// reached <see cref="JobStateCode.Completed"/> yet.</summary>
    public BufferSafeHandle TakeResult(JobSafeHandle job)
    {
        ThrowIfDisposed();
        EngineStatus status;
        ulong bufferRaw;
        unsafe
        {
            status = NativeMethods.engine_job_take_result(_handle.Raw, job.Raw, &bufferRaw);
        }
        ThrowIfNotOk(status);

        var buffer = new BufferSafeHandle(_handle);
        buffer.SetRaw(bufferRaw);
        return buffer;
    }

    /// <summary>The span is valid only for the duration of
    /// <paramref name="reader"/> -- never store or return it (S12.6).</summary>
    public T WithBufferView<T>(BufferSafeHandle buffer, ReadOnlySpanFunc<T> reader)
    {
        ThrowIfDisposed();
        unsafe
        {
            byte* data;
            ulong length;
            var status = NativeMethods.engine_buffer_view(_handle.Raw, buffer.Raw, &data, &length);
            ThrowIfNotOk(status);
            return reader(new ReadOnlySpan<byte>(data, checked((int)length)));
        }
    }

    /// <summary>Convenience: submit, poll once (this v1's backend is
    /// synchronous, so one poll is always enough), take the result, and
    /// decode this operation's fixed 40-byte shape (new value + state
    /// hash). Disposes the intermediate job/buffer handles itself.</summary>
    public (long NewValue, byte[] StateHash) IncrementAndWait(long amount)
    {
        using var job = SubmitIncrement(amount);
        var state = Poll(job);
        if (state != JobStateCode.Completed)
        {
            throw new EngineException(EngineStatus.JobNotComplete);
        }

        using var buffer = TakeResult(job);
        return WithBufferView(buffer, static span => (
            BitConverter.ToInt64(span[..8]),
            span[8..40].ToArray()
        ));
    }

    /// <summary>Test-only: deliberately panics inside the engine to
    /// exercise the Poisoned lifecycle path. Always throws
    /// <see cref="EngineException"/> (the native side never returns Ok
    /// for this call by design).</summary>
    public void TriggerDebugPanic()
    {
        ThrowIfDisposed();
        var status = NativeMethods.engine_debug_trigger_panic(_handle.Raw);
        throw new EngineException(status);
    }

    /// <summary>Test-only (D-009): the engine's current outstanding job
    /// count -- exists to observe whether a handle was really released
    /// (e.g. by a <see cref="JobSafeHandle"/> finalizer) rather than
    /// inferring it only from "nothing else broke".</summary>
    public ulong DebugJobCount()
    {
        ThrowIfDisposed();
        ulong count;
        unsafe
        {
            ThrowIfNotOk(NativeMethods.engine_debug_job_count(_handle.Raw, &count));
        }
        return count;
    }

    /// <summary>Test-only (D-009): same as <see cref="DebugJobCount"/> for
    /// the buffer table.</summary>
    public ulong DebugBufferCount()
    {
        ThrowIfDisposed();
        ulong count;
        unsafe
        {
            ThrowIfNotOk(NativeMethods.engine_debug_buffer_count(_handle.Raw, &count));
        }
        return count;
    }

    public void Shutdown()
    {
        ThrowIfDisposed();
        ThrowIfNotOk(NativeMethods.engine_shutdown(_handle.Raw));
    }

    private static void ThrowIfNotOk(EngineStatus status)
    {
        if (status != EngineStatus.Ok)
        {
            throw new EngineException(status);
        }
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new ObjectDisposedException(nameof(Engine));
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        _handle.Dispose();
    }
}

public delegate T ReadOnlySpanFunc<T>(ReadOnlySpan<byte> span);
