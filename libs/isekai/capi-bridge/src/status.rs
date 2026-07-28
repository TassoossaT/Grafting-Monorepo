//! Status codes crossing the ABI (master source S11.2: fixed-width types
//! only; S21.2: every export returns a status, never unwinds).

/// `#[repr(i32)]` so the C header sees a plain, fixed-width enum -- never
/// a bare Rust enum without a fixed representation (S11.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum EngineStatus {
    Ok = 0,
    NullPointer = -1,
    InvalidHandle = -2,
    EngineNotReady = -3,
    Poisoned = -4,
    InternalPanic = -5,
    JobNotComplete = -6,
    StructSizeMismatch = -7,
}
