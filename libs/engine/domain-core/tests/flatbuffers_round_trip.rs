//! C-005's real proof: every `Command`/`DomainEvent`/`Snapshot` variant
//! survives a genuine FlatBuffers encode/decode round trip through the
//! generated `contracts::*` types (`contracts/*.fbs`), not just "the
//! schema compiles." See `libs/engine/domain-core/src/wire.rs` for the
//! conversions under test, and `contracts/README.md` for the schema
//! design (union of per-variant tables) and why nothing outside this
//! test currently consumes them.
//!
//! C-006's compatibility test lives in `flatbuffers_evolution.rs`.

use grafting_domain_core::command::Command;
use grafting_domain_core::event::DomainEvent;
use grafting_domain_core::hash::StateHash;
use grafting_domain_core::rng::DeterministicRng;
use grafting_domain_core::snapshot::Snapshot;
use grafting_domain_core::state::State;
use grafting_domain_core::wire::{
    WireError, decode_command, decode_domain_event, decode_snapshot, encode_command,
    encode_domain_event, encode_snapshot,
};

fn assert_command_round_trips(command: Command) {
    let bytes = encode_command(&command);
    let decoded = decode_command(&bytes).expect("valid Command bytes must decode");
    assert_eq!(decoded, command);
}

#[test]
fn every_command_variant_round_trips() {
    assert_command_round_trips(Command::Increment { amount: 5 });
    assert_command_round_trips(Command::Decrement { amount: 3 });
    assert_command_round_trips(Command::Reset);
    assert_command_round_trips(Command::RollAndAdd { min: 1, max: 20 });
}

fn assert_domain_event_round_trips(event: DomainEvent) {
    let bytes = encode_domain_event(&event);
    let decoded = decode_domain_event(&bytes).expect("valid DomainEvent bytes must decode");
    assert_eq!(decoded, event);
}

#[test]
fn every_domain_event_variant_round_trips() {
    assert_domain_event_round_trips(DomainEvent::Incremented {
        amount: 5,
        new_value: 5,
    });
    assert_domain_event_round_trips(DomainEvent::Decremented {
        amount: 2,
        new_value: 3,
    });
    assert_domain_event_round_trips(DomainEvent::WasReset { previous_value: 3 });
    assert_domain_event_round_trips(DomainEvent::RolledAndAdded {
        rolled: 4,
        new_value: 7,
    });
}

#[test]
fn snapshot_round_trips_including_32_byte_fields() {
    let rng = DeterministicRng::from_seed([9; 32]);
    let snapshot = Snapshot {
        state: State { value: 42 },
        rng_seed: [9; 32],
        rng_word_pos: rng.word_pos(),
        sequence: 7,
        state_hash: StateHash([200; 32]),
        core_version: "0.0.0".to_string(),
    };

    let bytes = encode_snapshot(&snapshot);
    let decoded = decode_snapshot(&bytes).expect("valid Snapshot bytes must decode");
    assert_eq!(decoded, snapshot);
}

/// S10.4: "untrusted messages are verified before use." A completely
/// invalid buffer (not a truncated *valid* one -- flatc's verifier
/// checks structure, not semantic length invariants this crate itself
/// owns) must be rejected, not panic or silently produce garbage.
#[test]
fn garbage_bytes_are_rejected_not_panicking() {
    let garbage = [0xFFu8; 16];
    assert_eq!(decode_command(&garbage), Err(WireError::InvalidBuffer));
    assert_eq!(
        decode_domain_event(&garbage),
        Err(WireError::InvalidBuffer)
    );
    assert_eq!(decode_snapshot(&garbage), Err(WireError::InvalidBuffer));
}

/// The other half of S10.4's verification requirement: `rng_seed`/
/// `state_hash` must be exactly 32 bytes. flatc's own structural
/// verifier has no opinion on a `[ubyte]` vector's *length* (any length
/// is structurally valid) -- this crate's own `to_array32` check in
/// `wire.rs` is what actually enforces it, and this test proves that
/// check is real, not assumed.
#[test]
fn a_wrong_length_rng_seed_is_rejected_not_truncated() {
    use flatbuffers::FlatBufferBuilder;
    use grafting_domain_core::contracts;

    let mut fbb = FlatBufferBuilder::new();
    let short_seed = fbb.create_vector::<u8>(&[1, 2, 3]); // not 32 bytes
    let state_hash = fbb.create_vector(&[0u8; 32]);
    let core_version = fbb.create_string("0.0.0");
    let state = contracts::StateTable::create(&mut fbb, &contracts::StateTableArgs { value: 1 });
    let message = contracts::SnapshotMessage::create(
        &mut fbb,
        &contracts::SnapshotMessageArgs {
            state: Some(state),
            rng_seed: Some(short_seed),
            rng_word_pos: 0,
            sequence: 0,
            state_hash: Some(state_hash),
            core_version: Some(core_version),
        },
    );
    fbb.finish(message, None);

    let result = decode_snapshot(fbb.finished_data());
    assert_eq!(
        result,
        Err(WireError::InvalidLength {
            field: "rng_seed",
            expected: 32,
            actual: 3,
        })
    );
}
