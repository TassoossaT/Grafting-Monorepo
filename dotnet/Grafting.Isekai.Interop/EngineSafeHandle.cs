using System.Runtime.InteropServices;

namespace Grafting.Isekai.Interop;

/// <summary>
/// Wraps a <c>grafting-isekai-capi</c> engine handle (a <c>u64</c> value,
/// not a real OS handle -- stored in <see cref="SafeHandle"/>'s
/// <c>IntPtr</c> slot purely as an 8-byte container, never dereferenced
/// as a pointer). <see cref="ReleaseHandle"/> calls <c>engine_destroy</c>,
/// which is idempotent-safe against double release (S11.3).
/// </summary>
public sealed class EngineSafeHandle : SafeHandle
{
    public EngineSafeHandle()
        : base(IntPtr.Zero, ownsHandle: true)
    {
    }

    public ulong Raw => unchecked((ulong)handle.ToInt64());

    internal void SetRaw(ulong raw) => SetHandle(unchecked((IntPtr)(long)raw));

    public override bool IsInvalid => handle == IntPtr.Zero;

    protected override bool ReleaseHandle()
    {
        return NativeMethods.engine_destroy(Raw) == EngineStatus.Ok;
    }
}
