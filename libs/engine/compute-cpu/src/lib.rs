//! Synchronous CPU reference implementation of the `compute-api` job
//! contract (master source S4.2, S23 E-002: "correct baseline").
//!
//! `submit` computes immediately and stores a terminal state
//! (`Completed`/`Failed`) -- there is no async work here to observe
//! `Pending`/`Running`/`Cancelled` mid-flight. Those remain real variants
//! of the *shared* `JobState` contract that an async backend
//! (`compute-wgpu`, not built yet) will actually exercise; this backend
//! only ever produces them at the seams (`take_result` before
//! completion), which is unreachable by construction in a synchronous
//! implementation -- documented here rather than silently absent.
//!
//! CPU-vs-GPU differential testing (S4.2's `compute-cpu` responsibility;
//! E-009) is structurally unreachable until `compute-wgpu` (E-005)
//! exists -- an open gap, not something "correct baseline" implies is
//! covered.

use std::collections::HashMap;

use grafting_compute_api::{
    ComputeBackend, ComputeCapabilities, ComputeError, ComputeOp, ComputePlan, ComputeResult,
    JobHandle, JobState,
};

struct JobRecord {
    state: JobState,
    result: Option<ComputeResult>,
}

#[derive(Default)]
pub struct CpuBackend {
    next_id: u64,
    jobs: HashMap<JobHandle, JobRecord>,
}

impl CpuBackend {
    pub fn new() -> Self {
        Self::default()
    }
}

impl ComputeBackend for CpuBackend {
    fn capabilities(&self) -> ComputeCapabilities {
        ComputeCapabilities {
            backend_name: "cpu",
            supports_gpu: false,
        }
    }

    fn submit(&mut self, plan: ComputePlan) -> JobHandle {
        self.next_id += 1;
        let handle = JobHandle(self.next_id);

        let record = match plan.op {
            ComputeOp::ScaleF32 { input, factor } => {
                if factor.is_finite() {
                    let output: Vec<f32> = input.iter().map(|x| x * factor).collect();
                    JobRecord {
                        state: JobState::Completed,
                        result: Some(ComputeResult::F32(output)),
                    }
                } else {
                    JobRecord {
                        state: JobState::Failed {
                            reason: format!("factor must be finite, got {factor}"),
                        },
                        result: None,
                    }
                }
            }
        };

        self.jobs.insert(handle, record);
        handle
    }

    fn poll(&mut self, job: JobHandle) -> Result<JobState, ComputeError> {
        self.jobs
            .get(&job)
            .map(|record| record.state.clone())
            .ok_or(ComputeError::UnknownJob)
    }

    fn take_result(&mut self, job: JobHandle) -> Result<ComputeResult, ComputeError> {
        let record = self.jobs.get(&job).ok_or(ComputeError::UnknownJob)?;
        match &record.state {
            JobState::Completed => Ok(record
                .result
                .clone()
                .expect("a Completed job always has a result (internal invariant)")),
            JobState::Failed { reason } => Err(ComputeError::JobFailed {
                reason: reason.clone(),
            }),
            other => Err(ComputeError::JobNotComplete {
                state: other.clone(),
            }),
        }
    }

    fn release(&mut self, job: JobHandle) -> Result<(), ComputeError> {
        self.jobs
            .remove(&job)
            .map(|_| ())
            .ok_or(ComputeError::UnknownJob)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scale(input: Vec<f32>, factor: f32) -> ComputePlan {
        ComputePlan {
            op: ComputeOp::ScaleF32 { input, factor },
        }
    }

    #[test]
    fn capabilities_report_no_gpu() {
        let backend = CpuBackend::new();
        let caps = backend.capabilities();
        assert_eq!(caps.backend_name, "cpu");
        assert!(!caps.supports_gpu);
    }

    #[test]
    fn submit_then_poll_immediately_returns_completed() {
        let mut backend = CpuBackend::new();
        let job = backend.submit(scale(vec![1.0, 2.0], 2.0));
        assert_eq!(backend.poll(job), Ok(JobState::Completed));
    }

    #[test]
    fn take_result_returns_correctly_scaled_values() {
        let mut backend = CpuBackend::new();
        let job = backend.submit(scale(vec![1.0, 2.0, 3.0], 2.0));
        assert_eq!(
            backend.take_result(job),
            Ok(ComputeResult::F32(vec![2.0, 4.0, 6.0]))
        );
    }

    #[test]
    fn empty_input_produces_empty_output_without_panicking() {
        let mut backend = CpuBackend::new();
        let job = backend.submit(scale(vec![], 3.0));
        assert_eq!(backend.take_result(job), Ok(ComputeResult::F32(vec![])));
    }

    #[test]
    fn non_finite_factor_fails_the_job_instead_of_panicking() {
        let mut backend = CpuBackend::new();
        let job = backend.submit(scale(vec![1.0], f32::NAN));
        assert!(matches!(backend.poll(job), Ok(JobState::Failed { .. })));
        assert!(matches!(
            backend.take_result(job),
            Err(ComputeError::JobFailed { .. })
        ));
    }

    #[test]
    fn unknown_handle_is_rejected_everywhere_not_panicking() {
        let mut backend = CpuBackend::new();
        let bogus = JobHandle(999);
        assert_eq!(backend.poll(bogus), Err(ComputeError::UnknownJob));
        assert_eq!(backend.take_result(bogus), Err(ComputeError::UnknownJob));
        assert_eq!(backend.release(bogus), Err(ComputeError::UnknownJob));
    }

    #[test]
    fn double_release_is_rejected() {
        let mut backend = CpuBackend::new();
        let job = backend.submit(scale(vec![1.0], 1.0));
        assert_eq!(backend.release(job), Ok(()));
        assert_eq!(backend.release(job), Err(ComputeError::UnknownJob));
    }

    #[test]
    fn operations_after_release_are_rejected() {
        let mut backend = CpuBackend::new();
        let job = backend.submit(scale(vec![1.0], 1.0));
        backend.release(job).unwrap();
        assert_eq!(backend.poll(job), Err(ComputeError::UnknownJob));
        assert_eq!(backend.take_result(job), Err(ComputeError::UnknownJob));
    }
}
