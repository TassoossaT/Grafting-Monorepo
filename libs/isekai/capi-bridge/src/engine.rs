//! Engine lifecycle (master source S12.4: `Creating → Ready →
//! ShuttingDown → Destroyed`, plus `→ Poisoned → Destroyed`) and the one
//! real operation this v1 exposes, `engine_submit_increment` (see the
//! crate-level docs for why this isn't the fully generic
//! `engine_submit(bytes)` from S11.6).
//!
//! # Panic handling (S12.5)
//!
//! Only the actual domain-logic call (`apply_command`) is wrapped in
//! `catch_unwind`, while the registry `MutexGuard` is held in an *outer*
//! scope the panic never unwinds through -- so the registry mutex itself
//! is never poisoned by a domain-logic panic. On a caught panic, the
//! specific engine's `lifecycle` is set to `Poisoned` **explicitly** and
//! every subsequent call on that handle is refused before touching
//! `state`/`rng` again. This is deliberately not the mutex-poison
//! recover-and-continue shortcut `spikes/rust-capi-dotnet` used (that
//! spike's own README already flags it as "not the intended production
//! design") -- S12.5: "do not continue simulating in a doubtful state."

use std::panic::{self, AssertUnwindSafe};
use std::sync::{Mutex, OnceLock};

use grafting_domain_core::apply::apply_command;
use grafting_domain_core::command::Command;
use grafting_domain_core::hash::state_hash;
use grafting_domain_core::rng::DeterministicRng;
use grafting_domain_core::state::State;

use crate::buffer::BufferRecord;
use crate::handle::{HandleKind, HandleTable};
use crate::job::{JobRecord, JobStateCode};
use crate::status::EngineStatus;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineLifecycle {
    /// Real state in the shared vocabulary; unreachable in this v1 since
    /// engine creation has no async initialization work (no GPU device,
    /// no multiplayer handshake) -- `engine_create` goes straight to
    /// `Ready`.
    Creating,
    Ready,
    ShuttingDown,
    Destroyed,
    Poisoned,
}

struct Engine {
    lifecycle: EngineLifecycle,
    state: State,
    rng: DeterministicRng,
    sequence: u64,
    jobs: HandleTable<JobRecord>,
    buffers: HandleTable<BufferRecord>,
}

fn registry() -> &'static Mutex<HandleTable<Engine>> {
    static REGISTRY: OnceLock<Mutex<HandleTable<Engine>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HandleTable::new(HandleKind::Engine)))
}

/// S12.2: every public struct begins with `struct_size`. Carries an
/// explicit RNG seed (correction from design review: defaulting it
/// inside Rust would hide state the host can't reproduce or control,
/// cutting against DEC-044's replay-determinism claim -- `Snapshot.rng_seed`
/// is already treated as essential, caller-visible state in `domain-core`).
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct EngineCreateInfo {
    pub struct_size: u32,
    pub seed: [u8; 32],
}

/// # Safety
/// `create_info` and `out_engine` must be valid pointers of their
/// documented types; `create_info` must be readable, `out_engine` writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_create(
    create_info: *const EngineCreateInfo,
    out_engine: *mut u64,
) -> EngineStatus {
    if create_info.is_null() || out_engine.is_null() {
        return EngineStatus::NullPointer;
    }
    let info = unsafe { *create_info };
    if info.struct_size as usize != std::mem::size_of::<EngineCreateInfo>() {
        return EngineStatus::StructSizeMismatch;
    }

    let engine = Engine {
        lifecycle: EngineLifecycle::Ready,
        state: State::new(),
        rng: DeterministicRng::from_seed(info.seed),
        sequence: 0,
        jobs: HandleTable::new(HandleKind::Job),
        buffers: HandleTable::new(HandleKind::Buffer),
    };

    let mut engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    let handle = engines.insert(engine);
    unsafe {
        *out_engine = handle;
    }
    EngineStatus::Ok
}

/// Idempotent (S12.6): shutting down an already-`ShuttingDown`/
/// `Destroyed`/`Poisoned` engine is not an error.
#[unsafe(no_mangle)]
pub extern "C" fn engine_shutdown(engine: u64) -> EngineStatus {
    let mut engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    match engines.get_mut(engine) {
        Some(eng) => {
            if eng.lifecycle != EngineLifecycle::Poisoned {
                eng.lifecycle = EngineLifecycle::ShuttingDown;
            }
            EngineStatus::Ok
        }
        None => EngineStatus::InvalidHandle,
    }
}

/// Removing the handle bumps its generation (`handle::HandleTable`), so a
/// second `engine_destroy` with the same raw handle correctly returns
/// `InvalidHandle` (D-002's "double-release tested").
#[unsafe(no_mangle)]
pub extern "C" fn engine_destroy(engine: u64) -> EngineStatus {
    let mut engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    match engines.remove(engine) {
        Some(_) => EngineStatus::Ok,
        None => EngineStatus::InvalidHandle,
    }
}

/// The one real operation this v1 exposes -- see crate-level docs for why
/// this is concretely typed rather than a generic byte-oriented
/// `engine_submit`.
///
/// # Safety
/// `out_job` must be a valid, writable `u64*`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_submit_increment(
    engine: u64,
    amount: i64,
    out_job: *mut u64,
) -> EngineStatus {
    if out_job.is_null() {
        return EngineStatus::NullPointer;
    }

    let mut engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    let eng = match engines.get_mut(engine) {
        Some(e) => e,
        None => return EngineStatus::InvalidHandle,
    };

    match eng.lifecycle {
        EngineLifecycle::Ready => {}
        EngineLifecycle::Poisoned => return EngineStatus::Poisoned,
        _ => return EngineStatus::EngineNotReady,
    }

    eng.sequence += 1;
    let sequence = eng.sequence;

    // Only this call is caught -- see module docs on why the registry
    // guard above is never touched by this unwind.
    let outcome = panic::catch_unwind(AssertUnwindSafe(|| {
        apply_command(&mut eng.state, &mut eng.rng, Command::Increment { amount })
    }));

    let job_handle = match outcome {
        Ok(Ok(_events)) => {
            let hash = state_hash(&eng.state, sequence);
            let mut bytes = Vec::with_capacity(40);
            bytes.extend_from_slice(&eng.state.value.to_le_bytes());
            bytes.extend_from_slice(&hash.0);
            eng.jobs.insert(JobRecord::completed(bytes))
        }
        Ok(Err(command_error)) => eng
            .jobs
            .insert(JobRecord::failed(format!("{command_error:?}"))),
        Err(_panic) => {
            eng.lifecycle = EngineLifecycle::Poisoned;
            return EngineStatus::InternalPanic;
        }
    };

    unsafe {
        *out_job = job_handle;
    }
    EngineStatus::Ok
}

/// Test-only hook: deliberately panics inside a live engine to exercise
/// the `Poisoned` path (mirrors `spikes/rust-capi-dotnet`'s
/// `spike_capi_trigger_panic`, now producing real, persistent poisoning
/// instead of transient mutex-poison recovery).
#[unsafe(no_mangle)]
pub extern "C" fn engine_debug_trigger_panic(engine: u64) -> EngineStatus {
    let mut engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    let eng = match engines.get_mut(engine) {
        Some(e) => e,
        None => return EngineStatus::InvalidHandle,
    };

    let outcome = panic::catch_unwind(AssertUnwindSafe(|| {
        panic!("engine_debug_trigger_panic: deliberate panic to test the Poisoned lifecycle path");
    }));

    match outcome {
        Ok(()) => EngineStatus::Ok,
        Err(_) => {
            eng.lifecycle = EngineLifecycle::Poisoned;
            EngineStatus::InternalPanic
        }
    }
}

/// Test-only hook (D-009): the engine's current outstanding job count
/// (`HandleTable::len`, i.e. inserted-but-not-yet-released). Exists so a
/// caller (e.g. a .NET `SafeHandle` finalizer test) has a way to observe
/// whether a handle was *really* released rather than inferring it only
/// from "nothing else broke."
///
/// # Safety
/// `out_count` must be a valid, writable `u64*`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_debug_job_count(
    engine: u64,
    out_count: *mut u64,
) -> EngineStatus {
    if out_count.is_null() {
        return EngineStatus::NullPointer;
    }
    let engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    let eng = match engines.get(engine) {
        Some(e) => e,
        None => return EngineStatus::InvalidHandle,
    };
    unsafe {
        *out_count = eng.jobs.len() as u64;
    }
    EngineStatus::Ok
}

/// Test-only hook (D-009): same as [`engine_debug_job_count`] for the
/// buffer table.
///
/// # Safety
/// `out_count` must be a valid, writable `u64*`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_debug_buffer_count(
    engine: u64,
    out_count: *mut u64,
) -> EngineStatus {
    if out_count.is_null() {
        return EngineStatus::NullPointer;
    }
    let engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    let eng = match engines.get(engine) {
        Some(e) => e,
        None => return EngineStatus::InvalidHandle,
    };
    unsafe {
        *out_count = eng.buffers.len() as u64;
    }
    EngineStatus::Ok
}

/// # Safety
/// `out_state` must be a valid, writable `JobStateCode*`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_job_poll(
    engine: u64,
    job: u64,
    out_state: *mut JobStateCode,
) -> EngineStatus {
    if out_state.is_null() {
        return EngineStatus::NullPointer;
    }
    let mut engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    let eng = match engines.get_mut(engine) {
        Some(e) => e,
        None => return EngineStatus::InvalidHandle,
    };
    let record = match eng.jobs.get(job) {
        Some(r) => r,
        None => return EngineStatus::InvalidHandle,
    };
    unsafe {
        *out_state = JobStateCode::from(&record.state);
    }
    EngineStatus::Ok
}

/// Moves a completed job's result bytes into a new buffer lease. Fails
/// with `JobNotComplete` for any non-`Completed` state, including
/// `Failed` -- this v1 doesn't cross the failure reason over the ABI
/// (S11.2: no `String`).
///
/// # Safety
/// `out_buffer` must be a valid, writable `u64*`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_job_take_result(
    engine: u64,
    job: u64,
    out_buffer: *mut u64,
) -> EngineStatus {
    if out_buffer.is_null() {
        return EngineStatus::NullPointer;
    }
    let mut engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    let eng = match engines.get_mut(engine) {
        Some(e) => e,
        None => return EngineStatus::InvalidHandle,
    };
    let record = match eng.jobs.get_mut(job) {
        Some(r) => r,
        None => return EngineStatus::InvalidHandle,
    };
    match record.result.take() {
        Some(bytes) => {
            let buffer_handle = eng.buffers.insert(BufferRecord::new(bytes));
            unsafe {
                *out_buffer = buffer_handle;
            }
            EngineStatus::Ok
        }
        None => EngineStatus::JobNotComplete,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_job_release(engine: u64, job: u64) -> EngineStatus {
    let mut engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    let eng = match engines.get_mut(engine) {
        Some(e) => e,
        None => return EngineStatus::InvalidHandle,
    };
    match eng.jobs.remove(job) {
        Some(_) => EngineStatus::Ok,
        None => EngineStatus::InvalidHandle,
    }
}

/// # Safety
/// `out_data`/`out_length` must be valid, writable pointers. The returned
/// `*out_data` is valid only until `engine_buffer_release` is called for
/// this handle -- callers must not retain it past that point.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_buffer_view(
    engine: u64,
    buffer: u64,
    out_data: *mut *const u8,
    out_length: *mut u64,
) -> EngineStatus {
    if out_data.is_null() || out_length.is_null() {
        return EngineStatus::NullPointer;
    }
    let mut engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    let eng = match engines.get_mut(engine) {
        Some(e) => e,
        None => return EngineStatus::InvalidHandle,
    };
    let record = match eng.buffers.get(buffer) {
        Some(r) => r,
        None => return EngineStatus::InvalidHandle,
    };
    unsafe {
        *out_data = record.data.as_ptr();
        *out_length = record.data.len() as u64;
    }
    EngineStatus::Ok
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_buffer_release(engine: u64, buffer: u64) -> EngineStatus {
    let mut engines = registry().lock().unwrap_or_else(|e| e.into_inner());
    let eng = match engines.get_mut(engine) {
        Some(e) => e,
        None => return EngineStatus::InvalidHandle,
    };
    match eng.buffers.remove(buffer) {
        Some(_) => EngineStatus::Ok,
        None => EngineStatus::InvalidHandle,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_engine() -> u64 {
        let info = EngineCreateInfo {
            struct_size: std::mem::size_of::<EngineCreateInfo>() as u32,
            seed: [1; 32],
        };
        let mut handle = 0u64;
        let status = unsafe { engine_create(&info, &mut handle) };
        assert_eq!(status, EngineStatus::Ok);
        handle
    }

    #[test]
    fn create_submit_take_result_destroy_round_trip() {
        let engine = create_engine();

        let mut job = 0u64;
        let status = unsafe { engine_submit_increment(engine, 5, &mut job) };
        assert_eq!(status, EngineStatus::Ok);

        let mut state_code = JobStateCode::Pending;
        assert_eq!(
            unsafe { engine_job_poll(engine, job, &mut state_code) },
            EngineStatus::Ok
        );
        assert_eq!(state_code, JobStateCode::Completed);

        let mut buffer = 0u64;
        assert_eq!(
            unsafe { engine_job_take_result(engine, job, &mut buffer) },
            EngineStatus::Ok
        );

        let mut data: *const u8 = std::ptr::null();
        let mut length: u64 = 0;
        assert_eq!(
            unsafe { engine_buffer_view(engine, buffer, &mut data, &mut length) },
            EngineStatus::Ok
        );
        assert_eq!(length, 40);
        let bytes = unsafe { std::slice::from_raw_parts(data, length as usize) };
        let new_value = i64::from_le_bytes(bytes[0..8].try_into().unwrap());
        assert_eq!(new_value, 5);

        assert_eq!(engine_buffer_release(engine, buffer), EngineStatus::Ok);
        assert_eq!(engine_job_release(engine, job), EngineStatus::Ok);
        assert_eq!(engine_destroy(engine), EngineStatus::Ok);
    }

    #[test]
    fn double_destroy_is_rejected() {
        let engine = create_engine();
        assert_eq!(engine_destroy(engine), EngineStatus::Ok);
        assert_eq!(engine_destroy(engine), EngineStatus::InvalidHandle);
    }

    #[test]
    fn struct_size_mismatch_is_rejected() {
        let info = EngineCreateInfo {
            struct_size: 1, // wrong on purpose
            seed: [0; 32],
        };
        let mut handle = 0u64;
        let status = unsafe { engine_create(&info, &mut handle) };
        assert_eq!(status, EngineStatus::StructSizeMismatch);
    }

    #[test]
    fn null_pointers_are_rejected_everywhere_not_crashing() {
        assert_eq!(
            unsafe { engine_create(std::ptr::null(), std::ptr::null_mut()) },
            EngineStatus::NullPointer
        );
        let engine = create_engine();
        assert_eq!(
            unsafe { engine_submit_increment(engine, 1, std::ptr::null_mut()) },
            EngineStatus::NullPointer
        );
    }

    #[test]
    fn invalid_handle_is_rejected_everywhere() {
        let bogus = 0xDEAD_BEEFu64;
        let mut job = 0u64;
        assert_eq!(
            unsafe { engine_submit_increment(bogus, 1, &mut job) },
            EngineStatus::InvalidHandle
        );
        assert_eq!(engine_shutdown(bogus), EngineStatus::InvalidHandle);
        assert_eq!(engine_destroy(bogus), EngineStatus::InvalidHandle);
    }

    #[test]
    fn a_zero_handle_is_always_invalid() {
        let mut job = 0u64;
        assert_eq!(
            unsafe { engine_submit_increment(0, 1, &mut job) },
            EngineStatus::InvalidHandle
        );
    }

    #[test]
    fn overflow_fails_the_job_not_the_process() {
        let engine = create_engine();
        // Push value to i64::MAX first, in two steps that stay in range,
        // then overflow deliberately.
        let mut job = 0u64;
        unsafe { engine_submit_increment(engine, i64::MAX, &mut job) };
        unsafe { engine_submit_increment(engine, 1, &mut job) };

        let mut state_code = JobStateCode::Pending;
        unsafe { engine_job_poll(engine, job, &mut state_code) };
        assert_eq!(state_code, JobStateCode::Failed);

        let mut buffer = 0u64;
        assert_eq!(
            unsafe { engine_job_take_result(engine, job, &mut buffer) },
            EngineStatus::JobNotComplete
        );
    }

    #[test]
    fn a_panic_poisons_the_engine_and_the_process_survives() {
        let engine = create_engine();
        assert_eq!(
            engine_debug_trigger_panic(engine),
            EngineStatus::InternalPanic
        );

        // The engine is now Poisoned: further real work is refused ...
        let mut job = 0u64;
        assert_eq!(
            unsafe { engine_submit_increment(engine, 1, &mut job) },
            EngineStatus::Poisoned
        );
        // ... but the process is demonstrably still alive and the
        // registry itself still works for other engines.
        let other_engine = create_engine();
        let mut other_job = 0u64;
        assert_eq!(
            unsafe { engine_submit_increment(other_engine, 1, &mut other_job) },
            EngineStatus::Ok
        );
    }

    #[test]
    fn submitting_after_shutdown_is_refused() {
        let engine = create_engine();
        assert_eq!(engine_shutdown(engine), EngineStatus::Ok);
        let mut job = 0u64;
        assert_eq!(
            unsafe { engine_submit_increment(engine, 1, &mut job) },
            EngineStatus::EngineNotReady
        );
    }

    #[test]
    fn shutdown_with_a_pending_job_does_not_leak_or_crash() {
        let engine = create_engine();
        let mut job = 0u64;
        unsafe { engine_submit_increment(engine, 1, &mut job) };
        // Neither polled nor taken before shutdown.
        assert_eq!(engine_shutdown(engine), EngineStatus::Ok);
        assert_eq!(engine_destroy(engine), EngineStatus::Ok);
    }

    /// D-009: the "target scenario" -- one persistent engine driven
    /// through many submit/poll/take/view/release cycles -- must not grow
    /// its job/buffer tables. Checks both occupied count (`len`, a plain
    /// handle leak) and total slot count (`slot_count`, "arena growth" --
    /// a broken free-slot-reuse scan could leave `len` flat while this
    /// still climbs).
    #[test]
    fn repeated_increment_cycles_do_not_grow_the_job_or_buffer_tables() {
        let engine = create_engine();

        for i in 1..=5_000u64 {
            let mut job = 0u64;
            assert_eq!(
                unsafe { engine_submit_increment(engine, 1, &mut job) },
                EngineStatus::Ok
            );

            let mut state_code = JobStateCode::Pending;
            assert_eq!(
                unsafe { engine_job_poll(engine, job, &mut state_code) },
                EngineStatus::Ok
            );
            assert_eq!(state_code, JobStateCode::Completed);

            let mut buffer = 0u64;
            assert_eq!(
                unsafe { engine_job_take_result(engine, job, &mut buffer) },
                EngineStatus::Ok
            );

            let mut data: *const u8 = std::ptr::null();
            let mut length: u64 = 0;
            assert_eq!(
                unsafe { engine_buffer_view(engine, buffer, &mut data, &mut length) },
                EngineStatus::Ok
            );
            let bytes = unsafe { std::slice::from_raw_parts(data, length as usize) };
            let new_value = i64::from_le_bytes(bytes[0..8].try_into().unwrap());
            assert_eq!(new_value, i as i64);

            assert_eq!(engine_buffer_release(engine, buffer), EngineStatus::Ok);
            assert_eq!(engine_job_release(engine, job), EngineStatus::Ok);

            let engines = registry().lock().unwrap_or_else(|e| e.into_inner());
            let eng = engines.get(engine).unwrap();
            assert_eq!(eng.jobs.len(), 0, "iteration {i}: job table leaked an entry");
            assert_eq!(
                eng.buffers.len(),
                0,
                "iteration {i}: buffer table leaked an entry"
            );
            assert_eq!(
                eng.jobs.slot_count(),
                1,
                "iteration {i}: job table's slot count grew (arena growth)"
            );
            assert_eq!(
                eng.buffers.slot_count(),
                1,
                "iteration {i}: buffer table's slot count grew (arena growth)"
            );
        }

        assert_eq!(engine_destroy(engine), EngineStatus::Ok);
    }

    /// D-009: repeated engine create+destroy must not grow the engine
    /// table. Deliberately does **not** go through `registry()` --
    /// `cargo test` runs tests in parallel and every other test in this
    /// module shares that one process-wide static, several of them
    /// (`null_pointers_are_rejected_everywhere_not_crashing`,
    /// `overflow_fails_the_job_not_the_process`,
    /// `a_panic_poisons_the_engine_and_the_process_survives`,
    /// `submitting_after_shutdown_is_refused`) deliberately never destroy
    /// the engine they create (each is a single-shot smoke test, not
    /// meant to clean up after itself) -- confirmed empirically: an
    /// earlier version of this test asserted against `registry()` and
    /// failed intermittently for exactly this reason (observed a
    /// baseline-vs-after mismatch caused by a concurrently-running
    /// sibling test's permanent, by-design leftover engine, not an actual
    /// leak). A local `HandleTable<Engine>` exercises the identical
    /// `insert`/`remove` logic `registry()` itself wraps, without sharing
    /// state with anything else -- the C-ABI `engine_create`/
    /// `engine_destroy` wrapper logic (struct_size validation etc.) is
    /// already covered once by other tests in this module; this test's
    /// job is only to prove the table mechanism itself stays bounded
    /// under repetition.
    #[test]
    fn repeated_engine_create_destroy_does_not_grow_the_engine_table() {
        let mut table: HandleTable<Engine> = HandleTable::new(HandleKind::Engine);

        for _ in 0..1_000 {
            let engine = Engine {
                lifecycle: EngineLifecycle::Ready,
                state: State::new(),
                rng: DeterministicRng::from_seed([1; 32]),
                sequence: 0,
                jobs: HandleTable::new(HandleKind::Job),
                buffers: HandleTable::new(HandleKind::Buffer),
            };
            let handle = table.insert(engine);
            assert!(table.remove(handle).is_some());
        }

        assert_eq!(table.len(), 0, "engine table leaked an entry");
        assert_eq!(
            table.slot_count(),
            1,
            "engine table's slot count grew (arena growth)"
        );
    }
}
