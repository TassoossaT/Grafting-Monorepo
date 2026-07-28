using System.Runtime.InteropServices;

namespace Grafting.Isekai.Interop;

/// <summary>
/// Jobs are scoped to a specific engine in <c>grafting-isekai-capi</c>
/// (releasing one needs both handles), so this holds a reference to its
/// owning <see cref="EngineSafeHandle"/> rather than just its own raw
/// value.
/// </summary>
public sealed class JobSafeHandle : SafeHandle
{
    private readonly EngineSafeHandle _engine;

    public JobSafeHandle(EngineSafeHandle engine)
        : base(IntPtr.Zero, ownsHandle: true)
    {
        _engine = engine;
    }

    public ulong Raw => unchecked((ulong)handle.ToInt64());

    internal void SetRaw(ulong raw) => SetHandle(unchecked((IntPtr)(long)raw));

    public override bool IsInvalid => handle == IntPtr.Zero;

    protected override bool ReleaseHandle()
    {
        return NativeMethods.engine_job_release(_engine.Raw, Raw) == EngineStatus.Ok;
    }
}
