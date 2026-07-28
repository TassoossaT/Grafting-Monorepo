//! `WasmEngine`: one `domain_core::State` + one seeded RNG, exposed as a
//! `wasm-bindgen` class (master source S4.2's `isekai-wasm`
//! responsibilities: adapting linear memory, exposing numeric handles,
//! converting errors into stable structures, never duplicating domain
//! rules). Web-side mirror of `isekai-capi-bridge::engine`'s
//! `EngineHandle` + `engine_submit_increment`.
//!
//! # Panic handling is fundamentally different from the native side --
//! empirically verified, not assumed
//!
//! `std::panic::catch_unwind` does **not** catch a panic on
//! `wasm32-unknown-unknown` (verified: it traps as `unreachable`,
//! surfacing to JS as an uncaught `RuntimeError`, even with
//! `panic = "unwind"` set). So unlike `isekai-capi-bridge::engine`, there
//! is **no explicit `Poisoned` lifecycle variant here** -- Rust never
//! gets to run code after the trap to set one.
//!
//! What actually happens instead (verified with real heap-allocating
//! work -- `Vec` push/grow, `String::format`, matching
//! `apply_command`/`state_hash`'s real shape -- in both Node and a real
//! headless-browser session): `wasm-bindgen`'s own runtime borrow guard
//! marks the *specific* panicking `WasmEngine` instance as permanently
//! unusable (`recursive use of an object detected` on any further call),
//! while every other `WasmEngine` instance, all other heap allocations,
//! and the ability to allocate *new* heap memory all remain completely
//! unaffected. This is a real, per-object failure mode, not a global one
//! -- `isekai-web-client` (the JS/TS layer) is what classifies "this
//! specific engine is now dead" by catching the exception; there is
//! nothing for Rust itself to track. (This appears to contradict
//! `wasm-bindgen`'s own "hard abort" docs and a Cloudflare Workers
//! postmortem describing instance-wide poisoning -- most likely those
//! describe a different failure category, e.g. `panic = "abort"`'s
//! default or an older `wasm-bindgen` version. Re-verify with the same
//! method -- two independent stateful instances, real heap allocation,
//! one deliberately panicked -- before trusting this design if
//! `wasm-bindgen` is ever upgraded.)

use wasm_bindgen::prelude::*;

use grafting_domain_core::apply::apply_command;
use grafting_domain_core::command::Command;
use grafting_domain_core::hash::state_hash;
use grafting_domain_core::rng::DeterministicRng;
use grafting_domain_core::state::State;

use crate::buffer::BufferRecord;
use crate::handle::HandleTable;
use crate::job::{JobRecord, JobStateCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EngineLifecycle {
    Ready,
    ShuttingDown,
    Destroyed,
}

#[wasm_bindgen]
pub struct WasmEngine {
    lifecycle: EngineLifecycle,
    state: State,
    rng: DeterministicRng,
    sequence: u64,
    jobs: HandleTable<JobRecord>,
    buffers: HandleTable<BufferRecord>,
}

#[wasm_bindgen]
impl WasmEngine {
    /// `seed` must be exactly 32 bytes -- caller-visible and
    /// caller-controlled on purpose (DEC-044), same as the native side's
    /// `EngineCreateInfo.seed`.
    #[wasm_bindgen(constructor)]
    pub fn new(seed: Vec<u8>) -> Result<WasmEngine, JsValue> {
        console_error_panic_hook::set_once();
        let seed_array: [u8; 32] = seed
            .try_into()
            .map_err(|_| JsValue::from_str("seed must be exactly 32 bytes"))?;
        Ok(WasmEngine {
            lifecycle: EngineLifecycle::Ready,
            state: State::new(),
            rng: DeterministicRng::from_seed(seed_array),
            sequence: 0,
            jobs: HandleTable::new(),
            buffers: HandleTable::new(),
        })
    }

    /// The one real operation this v1 exposes (same scoping rationale as
    /// `isekai-capi-bridge::engine::engine_submit_increment`: a generic
    /// Command/DomainEvent channel needs a wire format DEC-013 locks to
    /// FlatBuffers, not built yet). Returns `Err` only for "engine not
    /// Ready" -- a validation failure inside the command (e.g. overflow)
    /// is a normal `Ok` job handle whose job ends up `Failed`, never a
    /// thrown exception. A thrown exception from *this* function is
    /// reserved for lifecycle misuse, not for genuine panics (which, per
    /// the module docs, can't be caught here at all).
    pub fn submit_increment(&mut self, amount: i64) -> Result<u64, JsValue> {
        if self.lifecycle != EngineLifecycle::Ready {
            return Err(JsValue::from_str("engine is not Ready"));
        }

        self.sequence += 1;
        let sequence = self.sequence;

        let record = match apply_command(
            &mut self.state,
            &mut self.rng,
            Command::Increment { amount },
        ) {
            Ok(_events) => {
                let hash = state_hash(&self.state, sequence);
                let mut bytes = Vec::with_capacity(40);
                bytes.extend_from_slice(&self.state.value.to_le_bytes());
                bytes.extend_from_slice(&hash.0);
                JobRecord::completed(bytes)
            }
            Err(command_error) => JobRecord::failed(format!("{command_error:?}")),
        };

        Ok(self.jobs.insert(record))
    }

    pub fn poll(&self, job: u64) -> Result<JobStateCode, JsValue> {
        self.jobs
            .get(job)
            .map(|record| JobStateCode::from(&record.state))
            .ok_or_else(|| JsValue::from_str("invalid job handle"))
    }

    /// Moves a completed job's result bytes into a new buffer lease.
    /// Fails for any non-`Completed` state, including `Failed` -- this v1
    /// doesn't cross the failure reason to JS (mirrors the native side).
    pub fn take_result(&mut self, job: u64) -> Result<u64, JsValue> {
        let record = self
            .jobs
            .get_mut(job)
            .ok_or_else(|| JsValue::from_str("invalid job handle"))?;
        match record.result.take() {
            Some(bytes) => Ok(self.buffers.insert(BufferRecord::new(bytes))),
            None => Err(JsValue::from_str("job not complete")),
        }
    }

    pub fn job_release(&mut self, job: u64) -> Result<(), JsValue> {
        self.jobs
            .remove(job)
            .map(|_| ())
            .ok_or_else(|| JsValue::from_str("invalid job handle"))
    }

    /// Returns a fresh copy of the buffer's bytes (a `Vec<u8>` crossing
    /// out of Wasm always copies into a new `Uint8Array` -- there is no
    /// zero-copy view out of linear memory across this specific boundary
    /// the way native pointer views work).
    pub fn buffer_view(&self, buffer: u64) -> Result<Vec<u8>, JsValue> {
        self.buffers
            .get(buffer)
            .map(|record| record.data.clone())
            .ok_or_else(|| JsValue::from_str("invalid buffer handle"))
    }

    pub fn buffer_release(&mut self, buffer: u64) -> Result<(), JsValue> {
        self.buffers
            .remove(buffer)
            .map(|_| ())
            .ok_or_else(|| JsValue::from_str("invalid buffer handle"))
    }

    /// Idempotent: shutting down an already-`ShuttingDown`/`Destroyed`
    /// engine is not an error.
    pub fn shutdown(&mut self) {
        if self.lifecycle != EngineLifecycle::Destroyed {
            self.lifecycle = EngineLifecycle::ShuttingDown;
        }
    }

    /// Test-only: deliberately panics (after real mutation, matching the
    /// scratch probe that established this module's panic-handling
    /// design) to exercise `wasm-bindgen`'s per-object poisoning. Always
    /// traps -- there is no normal return.
    pub fn debug_trigger_panic(&mut self) {
        self.sequence += 1;
        panic!(
            "debug_trigger_panic: deliberate panic to exercise wasm-bindgen's per-object poisoning"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    fn seed(fill: u8) -> Vec<u8> {
        vec![fill; 32]
    }

    #[wasm_bindgen_test]
    fn create_submit_take_result_round_trip() {
        let mut engine = WasmEngine::new(seed(1)).unwrap();
        let job = engine.submit_increment(5).unwrap();
        assert_eq!(engine.poll(job).unwrap(), JobStateCode::Completed);

        let buffer = engine.take_result(job).unwrap();
        let bytes = engine.buffer_view(buffer).unwrap();
        assert_eq!(bytes.len(), 40);
        let new_value = i64::from_le_bytes(bytes[0..8].try_into().unwrap());
        assert_eq!(new_value, 5);

        engine.buffer_release(buffer).unwrap();
        engine.job_release(job).unwrap();
    }

    #[wasm_bindgen_test]
    fn overflow_fails_the_job_not_the_call() {
        let mut engine = WasmEngine::new(seed(2)).unwrap();
        engine.submit_increment(i64::MAX).unwrap();
        let job = engine.submit_increment(1).unwrap();
        assert_eq!(engine.poll(job).unwrap(), JobStateCode::Failed);
        assert!(engine.take_result(job).is_err());
    }

    #[wasm_bindgen_test]
    fn invalid_handles_are_rejected_not_panicking() {
        let mut engine = WasmEngine::new(seed(3)).unwrap();
        assert!(engine.poll(0xDEAD_BEEF).is_err());
        assert!(engine.take_result(0xDEAD_BEEF).is_err());
        assert!(engine.buffer_view(0xDEAD_BEEF).is_err());
    }

    #[wasm_bindgen_test]
    fn double_release_is_rejected() {
        let mut engine = WasmEngine::new(seed(4)).unwrap();
        let job = engine.submit_increment(1).unwrap();
        assert!(engine.job_release(job).is_ok());
        assert!(engine.job_release(job).is_err());
    }

    #[wasm_bindgen_test]
    fn submitting_after_shutdown_is_refused() {
        let mut engine = WasmEngine::new(seed(5)).unwrap();
        engine.shutdown();
        assert!(engine.submit_increment(1).is_err());
    }

    // Deliberately NOT tested here: "does a panic in one WasmEngine leave
    // another untouched." A Wasm trap unconditionally halts execution at
    // the point it occurs -- unlike native, `std::panic::catch_unwind`
    // cannot intercept it here (see module docs), so any Rust statement
    // written after a call to `debug_trigger_panic()` within the *same*
    // test function would simply never run; the trap can only be
    // observed from *outside* the Wasm call, i.e. from JS. That is
    // exactly what `packages/isekai-web-client`'s test suite verifies
    // against this same compiled module, with real `try`/`catch` --
    // see that package's tests for the real proof of this module's
    // central design claim.
}
