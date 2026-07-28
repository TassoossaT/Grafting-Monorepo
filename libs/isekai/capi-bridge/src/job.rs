//! Job lifecycle (master source S12.4: `Pending → Running → Completed`/
//! `Failed`/`Cancelled → Released`), applied to `engine_submit_increment`.
//! `engine_submit_increment` computes synchronously (same pattern as
//! `engine-compute-cpu`'s `CpuBackend`) and stores a terminal state
//! immediately -- `Pending`/`Running`/`Cancelled` are real parts of this
//! *shared* lifecycle vocabulary, not reachable from this synchronous v1
//! (documented, not silently absent -- same honesty pattern as
//! `compute-cpu`'s README).

/// Rust-internal job state. Carries the failure reason for future use;
/// not yet exposed across the ABI (see [`JobStateCode`], which cannot
/// carry a `String` per S11.2).
#[derive(Debug, Clone, PartialEq)]
pub enum JobState {
    Pending,
    Running,
    Completed,
    Failed { reason: String },
    Cancelled,
}

/// The FFI-facing state code (`#[repr(i32)]`, fixed-width, S11.2) --
/// deliberately smaller than [`JobState`]: no failure-reason string
/// crosses the boundary in this v1.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum JobStateCode {
    Pending = 0,
    Running = 1,
    Completed = 2,
    Failed = 3,
    Cancelled = 4,
}

impl From<&JobState> for JobStateCode {
    fn from(state: &JobState) -> Self {
        match state {
            JobState::Pending => JobStateCode::Pending,
            JobState::Running => JobStateCode::Running,
            JobState::Completed => JobStateCode::Completed,
            JobState::Failed { .. } => JobStateCode::Failed,
            JobState::Cancelled => JobStateCode::Cancelled,
        }
    }
}

pub struct JobRecord {
    pub state: JobState,
    /// `Some` only while `state == Completed` and the result hasn't been
    /// taken yet (`engine_job_take_result` moves it into a buffer).
    pub result: Option<Vec<u8>>,
}

impl JobRecord {
    pub fn completed(bytes: Vec<u8>) -> Self {
        JobRecord {
            state: JobState::Completed,
            result: Some(bytes),
        }
    }

    pub fn failed(reason: String) -> Self {
        JobRecord {
            state: JobState::Failed { reason },
            result: None,
        }
    }
}
