namespace Grafting.Isekai.Interop;

/// <summary>
/// Mirrors <c>grafting-isekai-capi</c>'s <c>EngineStatus</c> (Rust
/// <c>status.rs</c>) exactly -- values must stay in sync by hand until a
/// real codegen pipeline exists (master source S12.2).
/// </summary>
public enum EngineStatus
{
    Ok = 0,
    NullPointer = -1,
    InvalidHandle = -2,
    EngineNotReady = -3,
    Poisoned = -4,
    InternalPanic = -5,
    JobNotComplete = -6,
    StructSizeMismatch = -7,
}
