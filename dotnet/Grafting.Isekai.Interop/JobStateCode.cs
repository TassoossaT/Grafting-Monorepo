namespace Grafting.Isekai.Interop;

/// <summary>
/// Mirrors <c>grafting-isekai-capi</c>'s <c>JobStateCode</c> (Rust
/// <c>job.rs</c>) exactly. Deliberately smaller than the Rust-internal
/// <c>JobState</c>: no failure-reason string crosses the ABI (S11.2).
/// </summary>
public enum JobStateCode
{
    Pending = 0,
    Running = 1,
    Completed = 2,
    Failed = 3,
    Cancelled = 4,
}
