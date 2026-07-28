namespace Grafting.Isekai.Interop;

/// <summary>
/// Thrown whenever a native call returns a non-<see cref="EngineStatus.Ok"/>
/// status (master source S12.6: centralized status translation).
/// </summary>
public sealed class EngineException : Exception
{
    public EngineStatus Status { get; }

    public EngineException(EngineStatus status)
        : base($"grafting-isekai-capi call failed: {status}")
    {
        Status = status;
    }
}
