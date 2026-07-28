using System.Runtime.InteropServices;

namespace Grafting.Isekai.Interop;

/// <summary>
/// Buffers are scoped to a specific engine, same as <see cref="JobSafeHandle"/>.
/// The bytes behind this handle must only be viewed through
/// <see cref="Engine.WithBufferView{T}"/>'s callback -- never returned or
/// stored past the lease (master source S12.6).
/// </summary>
public sealed class BufferSafeHandle : SafeHandle
{
    private readonly EngineSafeHandle _engine;

    public BufferSafeHandle(EngineSafeHandle engine)
        : base(IntPtr.Zero, ownsHandle: true)
    {
        _engine = engine;
    }

    public ulong Raw => unchecked((ulong)handle.ToInt64());

    internal void SetRaw(ulong raw) => SetHandle(unchecked((IntPtr)(long)raw));

    public override bool IsInvalid => handle == IntPtr.Zero;

    protected override bool ReleaseHandle()
    {
        return NativeMethods.engine_buffer_release(_engine.Raw, Raw) == EngineStatus.Ok;
    }
}
