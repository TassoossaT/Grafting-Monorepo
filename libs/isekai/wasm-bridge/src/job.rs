//! Job lifecycle (master source S12.4), mirroring
//! `libs/isekai/capi-bridge/src/job.rs`'s design for the Wasm side.

use wasm_bindgen::prelude::*;

/// Rust-internal job state. Carries the failure reason for potential
/// future use; not exposed across to JS (see [`JobStateCode`]).
#[derive(Debug, Clone, PartialEq)]
pub enum JobState {
    Pending,
    Running,
    Completed,
    Failed { reason: String },
    Cancelled,
}

/// The JS-facing state code. `wasm-bindgen` exposes a plain C-style enum
/// like this directly as a JS enum-like object.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobStateCode {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
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
    /// taken yet (`take_result` moves it into a buffer).
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
