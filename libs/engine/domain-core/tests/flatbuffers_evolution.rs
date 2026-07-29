//! C-006: a real schema-evolution/compatibility test (master source
//! §10.4), not just the evolution rules stated in prose.
//!
//! `contracts/fixtures/command_v1.fbs` is a frozen, committed copy of
//! `contracts/command.fbs` as it stood before `Increment` gained
//! `sequence_hint` (its generated Rust module,
//! `generated_v1/command_v1_generated.rs`, is committed too -- the
//! §10.3 documented exception, see
//! `docs/adr/ADR-0009-committed-flatbuffers-fixture.md`). This proves
//! both directions of §10.4's compatibility guarantee for real, against
//! two actually-different generated schemas, not the same schema
//! compared with itself.

use flatbuffers::FlatBufferBuilder;

#[path = "generated_v1/command_v1_generated.rs"]
mod command_v1_generated;
use command_v1_generated::grafting::contracts as v1;

use grafting_domain_core::contracts as current;

#[test]
fn old_writer_bytes_decode_under_the_current_schema_with_the_new_field_defaulted() {
    let mut fbb = FlatBufferBuilder::new();
    let increment = v1::Increment::create(&mut fbb, &v1::IncrementArgs { amount: 42 });
    let message = v1::CommandMessage::create(
        &mut fbb,
        &v1::CommandMessageArgs {
            payload_type: v1::CommandPayload::Increment,
            payload: Some(increment.as_union_value()),
        },
    );
    fbb.finish(message, None);
    let bytes = fbb.finished_data().to_vec();

    let decoded = current::root_as_command_message(&bytes)
        .expect("v1-written bytes must still be valid under the current schema");
    assert_eq!(decoded.payload_type(), current::CommandPayload::Increment);
    let increment = decoded
        .payload_as_increment()
        .expect("Increment payload must still decode");
    assert_eq!(increment.amount(), 42, "shared field must survive");
    assert_eq!(
        increment.sequence_hint(),
        0,
        "a field absent from the old writer's bytes must read back as its declared default"
    );
}

#[test]
fn current_writer_bytes_decode_under_the_old_schema_ignoring_the_new_field() {
    let mut fbb = FlatBufferBuilder::new();
    let increment = current::Increment::create(
        &mut fbb,
        &current::IncrementArgs {
            amount: 7,
            sequence_hint: 99,
        },
    );
    let message = current::CommandMessage::create(
        &mut fbb,
        &current::CommandMessageArgs {
            payload_type: current::CommandPayload::Increment,
            payload: Some(increment.as_union_value()),
        },
    );
    fbb.finish(message, None);
    let bytes = fbb.finished_data().to_vec();

    let decoded = v1::root_as_command_message(&bytes)
        .expect("current-writer bytes must still be valid under the old schema");
    assert_eq!(decoded.payload_type(), v1::CommandPayload::Increment);
    let increment = decoded
        .payload_as_increment()
        .expect("Increment payload must still decode");
    assert_eq!(
        increment.amount(),
        7,
        "shared field must survive even though the old reader has no idea sequence_hint exists"
    );
}
