//! Hand-written conversions between `domain-core`'s canonical
//! `Command`/`DomainEvent`/`Snapshot` and their FlatBuffers wire form
//! (`contracts::CommandMessage`/`DomainEventMessage`/`SnapshotMessage`,
//! generated from `contracts/*.fbs` -- master source S10.1, DEC-013,
//! `LOCKED`). The generated types are the wire format; the hand-written
//! enums/struct in `command.rs`/`event.rs`/`snapshot.rs` stay the
//! canonical in-process representation -- this module is the boundary
//! between them, not a replacement for either side.
//!
//! No consumer crosses a real process/language boundary with these yet
//! (`engine_submit_increment` still takes a plain `i64`, not encoded
//! bytes -- see `libs/isekai/capi-bridge`'s crate docs for why) -- these
//! functions exist so the schema is proven correct by a real round trip
//! (`tests/flatbuffers_round_trip.rs`), not left as "it compiles."

use flatbuffers::FlatBufferBuilder;

use crate::command::Command;
use crate::contracts;
use crate::event::DomainEvent;
use crate::hash::StateHash;
use crate::snapshot::Snapshot;
use crate::state::State;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WireError {
    /// `flatc`'s own structural verifier rejected the buffer (S10.4:
    /// "untrusted messages are verified before use") -- corrupt bytes,
    /// truncated buffer, or a union discriminant/payload mismatch.
    InvalidBuffer,
    /// A required field was absent from an otherwise-valid buffer.
    MissingField(&'static str),
    /// A `[ubyte]` field that must be exactly 32 bytes (`rng_seed`/
    /// `state_hash`) was not.
    InvalidLength {
        field: &'static str,
        expected: usize,
        actual: usize,
    },
    /// A `CommandPayload`/`DomainEventPayload` union carried
    /// `NONE` or a variant the writer of this code didn't know about.
    UnknownVariant,
}

fn to_array32(field: &'static str, bytes: &[u8]) -> Result<[u8; 32], WireError> {
    bytes
        .try_into()
        .map_err(|_| WireError::InvalidLength {
            field,
            expected: 32,
            actual: bytes.len(),
        })
}

pub fn encode_command(command: &Command) -> Vec<u8> {
    let mut fbb = FlatBufferBuilder::new();
    let (payload_type, payload) = match *command {
        Command::Increment { amount } => (
            contracts::CommandPayload::Increment,
            // `sequence_hint` (C-006's evolution proof field) has no
            // real use yet -- left at its declared default rather than
            // adding a field to `Command` for something nothing reads.
            contracts::Increment::create(
                &mut fbb,
                &contracts::IncrementArgs {
                    amount,
                    ..Default::default()
                },
            )
            .as_union_value(),
        ),
        Command::Decrement { amount } => (
            contracts::CommandPayload::Decrement,
            contracts::Decrement::create(&mut fbb, &contracts::DecrementArgs { amount })
                .as_union_value(),
        ),
        Command::Reset => (
            contracts::CommandPayload::Reset,
            contracts::Reset::create(&mut fbb, &contracts::ResetArgs {}).as_union_value(),
        ),
        Command::RollAndAdd { min, max } => (
            contracts::CommandPayload::RollAndAdd,
            contracts::RollAndAdd::create(&mut fbb, &contracts::RollAndAddArgs { min, max })
                .as_union_value(),
        ),
    };
    let message = contracts::CommandMessage::create(
        &mut fbb,
        &contracts::CommandMessageArgs {
            payload_type,
            payload: Some(payload),
        },
    );
    fbb.finish(message, None);
    fbb.finished_data().to_vec()
}

pub fn decode_command(bytes: &[u8]) -> Result<Command, WireError> {
    let message =
        contracts::root_as_command_message(bytes).map_err(|_| WireError::InvalidBuffer)?;
    match message.payload_type() {
        contracts::CommandPayload::Increment => {
            let t = message
                .payload_as_increment()
                .ok_or(WireError::MissingField("payload"))?;
            Ok(Command::Increment { amount: t.amount() })
        }
        contracts::CommandPayload::Decrement => {
            let t = message
                .payload_as_decrement()
                .ok_or(WireError::MissingField("payload"))?;
            Ok(Command::Decrement { amount: t.amount() })
        }
        contracts::CommandPayload::Reset => Ok(Command::Reset),
        contracts::CommandPayload::RollAndAdd => {
            let t = message
                .payload_as_roll_and_add()
                .ok_or(WireError::MissingField("payload"))?;
            Ok(Command::RollAndAdd {
                min: t.min(),
                max: t.max(),
            })
        }
        _ => Err(WireError::UnknownVariant),
    }
}

pub fn encode_domain_event(event: &DomainEvent) -> Vec<u8> {
    let mut fbb = FlatBufferBuilder::new();
    let (payload_type, payload) = match *event {
        DomainEvent::Incremented { amount, new_value } => (
            contracts::DomainEventPayload::Incremented,
            contracts::Incremented::create(
                &mut fbb,
                &contracts::IncrementedArgs { amount, new_value },
            )
            .as_union_value(),
        ),
        DomainEvent::Decremented { amount, new_value } => (
            contracts::DomainEventPayload::Decremented,
            contracts::Decremented::create(
                &mut fbb,
                &contracts::DecrementedArgs { amount, new_value },
            )
            .as_union_value(),
        ),
        DomainEvent::WasReset { previous_value } => (
            contracts::DomainEventPayload::WasReset,
            contracts::WasReset::create(&mut fbb, &contracts::WasResetArgs { previous_value })
                .as_union_value(),
        ),
        DomainEvent::RolledAndAdded { rolled, new_value } => (
            contracts::DomainEventPayload::RolledAndAdded,
            contracts::RolledAndAdded::create(
                &mut fbb,
                &contracts::RolledAndAddedArgs { rolled, new_value },
            )
            .as_union_value(),
        ),
    };
    let message = contracts::DomainEventMessage::create(
        &mut fbb,
        &contracts::DomainEventMessageArgs {
            payload_type,
            payload: Some(payload),
        },
    );
    fbb.finish(message, None);
    fbb.finished_data().to_vec()
}

pub fn decode_domain_event(bytes: &[u8]) -> Result<DomainEvent, WireError> {
    let message =
        contracts::root_as_domain_event_message(bytes).map_err(|_| WireError::InvalidBuffer)?;
    match message.payload_type() {
        contracts::DomainEventPayload::Incremented => {
            let t = message
                .payload_as_incremented()
                .ok_or(WireError::MissingField("payload"))?;
            Ok(DomainEvent::Incremented {
                amount: t.amount(),
                new_value: t.new_value(),
            })
        }
        contracts::DomainEventPayload::Decremented => {
            let t = message
                .payload_as_decremented()
                .ok_or(WireError::MissingField("payload"))?;
            Ok(DomainEvent::Decremented {
                amount: t.amount(),
                new_value: t.new_value(),
            })
        }
        contracts::DomainEventPayload::WasReset => {
            let t = message
                .payload_as_was_reset()
                .ok_or(WireError::MissingField("payload"))?;
            Ok(DomainEvent::WasReset {
                previous_value: t.previous_value(),
            })
        }
        contracts::DomainEventPayload::RolledAndAdded => {
            let t = message
                .payload_as_rolled_and_added()
                .ok_or(WireError::MissingField("payload"))?;
            Ok(DomainEvent::RolledAndAdded {
                rolled: t.rolled(),
                new_value: t.new_value(),
            })
        }
        _ => Err(WireError::UnknownVariant),
    }
}

pub fn encode_snapshot(snapshot: &Snapshot) -> Vec<u8> {
    let mut fbb = FlatBufferBuilder::new();
    let rng_seed = fbb.create_vector(&snapshot.rng_seed);
    let state_hash = fbb.create_vector(&snapshot.state_hash.0);
    let core_version = fbb.create_string(&snapshot.core_version);
    let state = contracts::StateTable::create(
        &mut fbb,
        &contracts::StateTableArgs {
            value: snapshot.state.value,
        },
    );
    let message = contracts::SnapshotMessage::create(
        &mut fbb,
        &contracts::SnapshotMessageArgs {
            state: Some(state),
            rng_seed: Some(rng_seed),
            rng_word_pos: snapshot.rng_word_pos,
            sequence: snapshot.sequence,
            state_hash: Some(state_hash),
            core_version: Some(core_version),
        },
    );
    fbb.finish(message, None);
    fbb.finished_data().to_vec()
}

pub fn decode_snapshot(bytes: &[u8]) -> Result<Snapshot, WireError> {
    let message =
        contracts::root_as_snapshot_message(bytes).map_err(|_| WireError::InvalidBuffer)?;

    let state_table = message
        .state()
        .ok_or(WireError::MissingField("state"))?;
    let rng_seed_vec = message
        .rng_seed()
        .ok_or(WireError::MissingField("rng_seed"))?;
    let state_hash_vec = message
        .state_hash()
        .ok_or(WireError::MissingField("state_hash"))?;
    let core_version = message
        .core_version()
        .ok_or(WireError::MissingField("core_version"))?;

    Ok(Snapshot {
        state: State {
            value: state_table.value(),
        },
        rng_seed: to_array32("rng_seed", rng_seed_vec.bytes())?,
        rng_word_pos: message.rng_word_pos(),
        sequence: message.sequence(),
        state_hash: StateHash(to_array32("state_hash", state_hash_vec.bytes())?),
        core_version: core_version.to_string(),
    })
}
