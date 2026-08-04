# grafting-domain-core

### `#[repr(transparent)] pub struct grafting_domain_core::contracts::CommandPayload(pub u8)`

### `#[repr(transparent)] pub struct grafting_domain_core::contracts::DomainEventPayload(pub u8)`

### `pub const fn grafting_domain_core::state::State::new() -> Self`

### `pub const grafting_domain_core::contracts::CommandMessage<'a>::VT_PAYLOAD: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::CommandMessage<'a>::VT_PAYLOAD_TYPE: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::CommandPayload::Decrement: Self`

### `pub const grafting_domain_core::contracts::CommandPayload::ENUM_MAX: u8`

### `pub const grafting_domain_core::contracts::CommandPayload::ENUM_MIN: u8`

### `pub const grafting_domain_core::contracts::CommandPayload::ENUM_VALUES: &'static [Self]`

### `pub const grafting_domain_core::contracts::CommandPayload::Increment: Self`

### `pub const grafting_domain_core::contracts::CommandPayload::NONE: Self`

### `pub const grafting_domain_core::contracts::CommandPayload::Reset: Self`

### `pub const grafting_domain_core::contracts::CommandPayload::RollAndAdd: Self`

### `pub const grafting_domain_core::contracts::Decrement<'a>::VT_AMOUNT: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::Decremented<'a>::VT_AMOUNT: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::Decremented<'a>::VT_NEW_VALUE: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::DomainEventMessage<'a>::VT_PAYLOAD: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::DomainEventMessage<'a>::VT_PAYLOAD_TYPE: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::DomainEventPayload::Decremented: Self`

### `pub const grafting_domain_core::contracts::DomainEventPayload::ENUM_MAX: u8`

### `pub const grafting_domain_core::contracts::DomainEventPayload::ENUM_MIN: u8`

### `pub const grafting_domain_core::contracts::DomainEventPayload::ENUM_VALUES: &'static [Self]`

### `pub const grafting_domain_core::contracts::DomainEventPayload::Incremented: Self`

### `pub const grafting_domain_core::contracts::DomainEventPayload::NONE: Self`

### `pub const grafting_domain_core::contracts::DomainEventPayload::RolledAndAdded: Self`

### `pub const grafting_domain_core::contracts::DomainEventPayload::WasReset: Self`

### `pub const grafting_domain_core::contracts::ENUM_MAX_COMMAND_PAYLOAD: u8`

### `pub const grafting_domain_core::contracts::ENUM_MAX_DOMAIN_EVENT_PAYLOAD: u8`

### `pub const grafting_domain_core::contracts::ENUM_MIN_COMMAND_PAYLOAD: u8`

### `pub const grafting_domain_core::contracts::ENUM_MIN_DOMAIN_EVENT_PAYLOAD: u8`

### `pub const grafting_domain_core::contracts::ENUM_VALUES_COMMAND_PAYLOAD: [grafting_domain_core::contracts::CommandPayload; 5]`

### `pub const grafting_domain_core::contracts::ENUM_VALUES_DOMAIN_EVENT_PAYLOAD: [grafting_domain_core::contracts::DomainEventPayload; 5]`

### `pub const grafting_domain_core::contracts::Increment<'a>::VT_AMOUNT: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::Increment<'a>::VT_SEQUENCE_HINT: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::Incremented<'a>::VT_AMOUNT: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::Incremented<'a>::VT_NEW_VALUE: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::RollAndAdd<'a>::VT_MAX: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::RollAndAdd<'a>::VT_MIN: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::RolledAndAdded<'a>::VT_NEW_VALUE: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::RolledAndAdded<'a>::VT_ROLLED: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::SnapshotMessage<'a>::VT_CORE_VERSION: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::SnapshotMessage<'a>::VT_RNG_SEED: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::SnapshotMessage<'a>::VT_RNG_WORD_POS: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::SnapshotMessage<'a>::VT_SEQUENCE: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::SnapshotMessage<'a>::VT_STATE: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::SnapshotMessage<'a>::VT_STATE_HASH: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::StateTable<'a>::VT_VALUE: flatbuffers::primitives::VOffsetT`

### `pub const grafting_domain_core::contracts::WasReset<'a>::VT_PREVIOUS_VALUE: flatbuffers::primitives::VOffsetT`

### `pub enum grafting_domain_core::command::Command`

### `pub enum grafting_domain_core::command::CommandError`

### `pub enum grafting_domain_core::contracts::CommandMessageOffset`

### `pub enum grafting_domain_core::contracts::DecrementOffset`

### `pub enum grafting_domain_core::contracts::DecrementedOffset`

### `pub enum grafting_domain_core::contracts::DomainEventMessageOffset`

### `pub enum grafting_domain_core::contracts::IncrementOffset`

### `pub enum grafting_domain_core::contracts::IncrementedOffset`

### `pub enum grafting_domain_core::contracts::ResetOffset`

### `pub enum grafting_domain_core::contracts::RollAndAddOffset`

### `pub enum grafting_domain_core::contracts::RolledAndAddedOffset`

### `pub enum grafting_domain_core::contracts::SnapshotMessageOffset`

### `pub enum grafting_domain_core::contracts::StateTableOffset`

### `pub enum grafting_domain_core::contracts::WasResetOffset`

### `pub enum grafting_domain_core::event::DomainEvent`

### `pub enum grafting_domain_core::wire::WireError`

### `pub fn grafting_domain_core::apply::apply_command(state: &mut grafting_domain_core::state::State, rng: &mut grafting_domain_core::rng::DeterministicRng, command: grafting_domain_core::command::Command) -> core::result::Result<alloc::vec::Vec<grafting_domain_core::event::DomainEvent>, grafting_domain_core::command::CommandError>`

### `pub fn grafting_domain_core::command::Command::validate_structure(&self) -> core::result::Result<(), grafting_domain_core::command::CommandError>`

Structural validation only: whether the command's own fields are
well-formed, independent of current state or the RNG stream.

### `pub fn grafting_domain_core::contracts::CommandMessage<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::CommandMessage<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::CommandMessage<'a>::clone(&self) -> grafting_domain_core::contracts::CommandMessage<'a>`

### `pub fn grafting_domain_core::contracts::CommandMessage<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, args: &'args grafting_domain_core::contracts::CommandMessageArgs) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::CommandMessage<'bldr>>`

### `pub fn grafting_domain_core::contracts::CommandMessage<'a>::eq(&self, other: &grafting_domain_core::contracts::CommandMessage<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::CommandMessage<'a>::payload(&self) -> core::option::Option<flatbuffers::table::Table<'a>>`

### `pub fn grafting_domain_core::contracts::CommandMessage<'a>::payload_as_decrement(&self) -> core::option::Option<grafting_domain_core::contracts::Decrement<'a>>`

### `pub fn grafting_domain_core::contracts::CommandMessage<'a>::payload_as_increment(&self) -> core::option::Option<grafting_domain_core::contracts::Increment<'a>>`

### `pub fn grafting_domain_core::contracts::CommandMessage<'a>::payload_as_reset(&self) -> core::option::Option<grafting_domain_core::contracts::Reset<'a>>`

### `pub fn grafting_domain_core::contracts::CommandMessage<'a>::payload_as_roll_and_add(&self) -> core::option::Option<grafting_domain_core::contracts::RollAndAdd<'a>>`

### `pub fn grafting_domain_core::contracts::CommandMessage<'a>::payload_type(&self) -> grafting_domain_core::contracts::CommandPayload`

### `pub fn grafting_domain_core::contracts::CommandMessageBuilder<'a, 'b, A>::add_payload(&mut self, payload: flatbuffers::primitives::WIPOffset<flatbuffers::primitives::UnionWIPOffset>)`

### `pub fn grafting_domain_core::contracts::CommandMessageBuilder<'a, 'b, A>::add_payload_type(&mut self, payload_type: grafting_domain_core::contracts::CommandPayload)`

### `pub fn grafting_domain_core::contracts::CommandMessageBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::CommandMessage<'a>>`

### `pub fn grafting_domain_core::contracts::CommandMessageBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::CommandMessageBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::CommandPayload::from_little_endian(v: u8) -> Self`

### `pub fn grafting_domain_core::contracts::CommandPayload::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::CommandPayload::to_little_endian(self) -> u8`

### `pub fn grafting_domain_core::contracts::CommandPayload::variant_name(self) -> core::option::Option<&'static str>`

Returns the variant's name or "" if unknown.

### `pub fn grafting_domain_core::contracts::Decrement<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::Decrement<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::Decrement<'a>::amount(&self) -> i64`

### `pub fn grafting_domain_core::contracts::Decrement<'a>::clone(&self) -> grafting_domain_core::contracts::Decrement<'a>`

### `pub fn grafting_domain_core::contracts::Decrement<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, args: &'args grafting_domain_core::contracts::DecrementArgs) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::Decrement<'bldr>>`

### `pub fn grafting_domain_core::contracts::Decrement<'a>::eq(&self, other: &grafting_domain_core::contracts::Decrement<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::DecrementBuilder<'a, 'b, A>::add_amount(&mut self, amount: i64)`

### `pub fn grafting_domain_core::contracts::DecrementBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::Decrement<'a>>`

### `pub fn grafting_domain_core::contracts::DecrementBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::DecrementBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::Decremented<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::Decremented<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::Decremented<'a>::amount(&self) -> i64`

### `pub fn grafting_domain_core::contracts::Decremented<'a>::clone(&self) -> grafting_domain_core::contracts::Decremented<'a>`

### `pub fn grafting_domain_core::contracts::Decremented<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, args: &'args grafting_domain_core::contracts::DecrementedArgs) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::Decremented<'bldr>>`

### `pub fn grafting_domain_core::contracts::Decremented<'a>::eq(&self, other: &grafting_domain_core::contracts::Decremented<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::Decremented<'a>::new_value(&self) -> i64`

### `pub fn grafting_domain_core::contracts::DecrementedBuilder<'a, 'b, A>::add_amount(&mut self, amount: i64)`

### `pub fn grafting_domain_core::contracts::DecrementedBuilder<'a, 'b, A>::add_new_value(&mut self, new_value: i64)`

### `pub fn grafting_domain_core::contracts::DecrementedBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::Decremented<'a>>`

### `pub fn grafting_domain_core::contracts::DecrementedBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::DecrementedBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::DomainEventMessage<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::DomainEventMessage<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::DomainEventMessage<'a>::clone(&self) -> grafting_domain_core::contracts::DomainEventMessage<'a>`

### `pub fn grafting_domain_core::contracts::DomainEventMessage<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, args: &'args grafting_domain_core::contracts::DomainEventMessageArgs) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::DomainEventMessage<'bldr>>`

### `pub fn grafting_domain_core::contracts::DomainEventMessage<'a>::eq(&self, other: &grafting_domain_core::contracts::DomainEventMessage<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::DomainEventMessage<'a>::payload(&self) -> core::option::Option<flatbuffers::table::Table<'a>>`

### `pub fn grafting_domain_core::contracts::DomainEventMessage<'a>::payload_as_decremented(&self) -> core::option::Option<grafting_domain_core::contracts::Decremented<'a>>`

### `pub fn grafting_domain_core::contracts::DomainEventMessage<'a>::payload_as_incremented(&self) -> core::option::Option<grafting_domain_core::contracts::Incremented<'a>>`

### `pub fn grafting_domain_core::contracts::DomainEventMessage<'a>::payload_as_rolled_and_added(&self) -> core::option::Option<grafting_domain_core::contracts::RolledAndAdded<'a>>`

### `pub fn grafting_domain_core::contracts::DomainEventMessage<'a>::payload_as_was_reset(&self) -> core::option::Option<grafting_domain_core::contracts::WasReset<'a>>`

### `pub fn grafting_domain_core::contracts::DomainEventMessage<'a>::payload_type(&self) -> grafting_domain_core::contracts::DomainEventPayload`

### `pub fn grafting_domain_core::contracts::DomainEventMessageBuilder<'a, 'b, A>::add_payload(&mut self, payload: flatbuffers::primitives::WIPOffset<flatbuffers::primitives::UnionWIPOffset>)`

### `pub fn grafting_domain_core::contracts::DomainEventMessageBuilder<'a, 'b, A>::add_payload_type(&mut self, payload_type: grafting_domain_core::contracts::DomainEventPayload)`

### `pub fn grafting_domain_core::contracts::DomainEventMessageBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::DomainEventMessage<'a>>`

### `pub fn grafting_domain_core::contracts::DomainEventMessageBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::DomainEventMessageBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::DomainEventPayload::from_little_endian(v: u8) -> Self`

### `pub fn grafting_domain_core::contracts::DomainEventPayload::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::DomainEventPayload::to_little_endian(self) -> u8`

### `pub fn grafting_domain_core::contracts::DomainEventPayload::variant_name(self) -> core::option::Option<&'static str>`

Returns the variant's name or "" if unknown.

### `pub fn grafting_domain_core::contracts::Increment<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::Increment<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::Increment<'a>::amount(&self) -> i64`

### `pub fn grafting_domain_core::contracts::Increment<'a>::clone(&self) -> grafting_domain_core::contracts::Increment<'a>`

### `pub fn grafting_domain_core::contracts::Increment<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, args: &'args grafting_domain_core::contracts::IncrementArgs) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::Increment<'bldr>>`

### `pub fn grafting_domain_core::contracts::Increment<'a>::eq(&self, other: &grafting_domain_core::contracts::Increment<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::Increment<'a>::sequence_hint(&self) -> u64`

### `pub fn grafting_domain_core::contracts::IncrementBuilder<'a, 'b, A>::add_amount(&mut self, amount: i64)`

### `pub fn grafting_domain_core::contracts::IncrementBuilder<'a, 'b, A>::add_sequence_hint(&mut self, sequence_hint: u64)`

### `pub fn grafting_domain_core::contracts::IncrementBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::Increment<'a>>`

### `pub fn grafting_domain_core::contracts::IncrementBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::IncrementBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::Incremented<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::Incremented<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::Incremented<'a>::amount(&self) -> i64`

### `pub fn grafting_domain_core::contracts::Incremented<'a>::clone(&self) -> grafting_domain_core::contracts::Incremented<'a>`

### `pub fn grafting_domain_core::contracts::Incremented<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, args: &'args grafting_domain_core::contracts::IncrementedArgs) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::Incremented<'bldr>>`

### `pub fn grafting_domain_core::contracts::Incremented<'a>::eq(&self, other: &grafting_domain_core::contracts::Incremented<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::Incremented<'a>::new_value(&self) -> i64`

### `pub fn grafting_domain_core::contracts::IncrementedBuilder<'a, 'b, A>::add_amount(&mut self, amount: i64)`

### `pub fn grafting_domain_core::contracts::IncrementedBuilder<'a, 'b, A>::add_new_value(&mut self, new_value: i64)`

### `pub fn grafting_domain_core::contracts::IncrementedBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::Incremented<'a>>`

### `pub fn grafting_domain_core::contracts::IncrementedBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::IncrementedBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::Reset<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::Reset<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::Reset<'a>::clone(&self) -> grafting_domain_core::contracts::Reset<'a>`

### `pub fn grafting_domain_core::contracts::Reset<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, _args: &'args grafting_domain_core::contracts::ResetArgs) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::Reset<'bldr>>`

### `pub fn grafting_domain_core::contracts::Reset<'a>::eq(&self, other: &grafting_domain_core::contracts::Reset<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::ResetBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::Reset<'a>>`

### `pub fn grafting_domain_core::contracts::ResetBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::ResetBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::RollAndAdd<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::RollAndAdd<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::RollAndAdd<'a>::clone(&self) -> grafting_domain_core::contracts::RollAndAdd<'a>`

### `pub fn grafting_domain_core::contracts::RollAndAdd<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, args: &'args grafting_domain_core::contracts::RollAndAddArgs) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::RollAndAdd<'bldr>>`

### `pub fn grafting_domain_core::contracts::RollAndAdd<'a>::eq(&self, other: &grafting_domain_core::contracts::RollAndAdd<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::RollAndAdd<'a>::max(&self) -> i64`

### `pub fn grafting_domain_core::contracts::RollAndAdd<'a>::min(&self) -> i64`

### `pub fn grafting_domain_core::contracts::RollAndAddBuilder<'a, 'b, A>::add_max(&mut self, max: i64)`

### `pub fn grafting_domain_core::contracts::RollAndAddBuilder<'a, 'b, A>::add_min(&mut self, min: i64)`

### `pub fn grafting_domain_core::contracts::RollAndAddBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::RollAndAdd<'a>>`

### `pub fn grafting_domain_core::contracts::RollAndAddBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::RollAndAddBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::RolledAndAdded<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::RolledAndAdded<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::RolledAndAdded<'a>::clone(&self) -> grafting_domain_core::contracts::RolledAndAdded<'a>`

### `pub fn grafting_domain_core::contracts::RolledAndAdded<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, args: &'args grafting_domain_core::contracts::RolledAndAddedArgs) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::RolledAndAdded<'bldr>>`

### `pub fn grafting_domain_core::contracts::RolledAndAdded<'a>::eq(&self, other: &grafting_domain_core::contracts::RolledAndAdded<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::RolledAndAdded<'a>::new_value(&self) -> i64`

### `pub fn grafting_domain_core::contracts::RolledAndAdded<'a>::rolled(&self) -> i64`

### `pub fn grafting_domain_core::contracts::RolledAndAddedBuilder<'a, 'b, A>::add_new_value(&mut self, new_value: i64)`

### `pub fn grafting_domain_core::contracts::RolledAndAddedBuilder<'a, 'b, A>::add_rolled(&mut self, rolled: i64)`

### `pub fn grafting_domain_core::contracts::RolledAndAddedBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::RolledAndAdded<'a>>`

### `pub fn grafting_domain_core::contracts::RolledAndAddedBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::RolledAndAddedBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::SnapshotMessage<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::SnapshotMessage<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::SnapshotMessage<'a>::clone(&self) -> grafting_domain_core::contracts::SnapshotMessage<'a>`

### `pub fn grafting_domain_core::contracts::SnapshotMessage<'a>::core_version(&self) -> core::option::Option<&'a str>`

### `pub fn grafting_domain_core::contracts::SnapshotMessage<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, args: &'args grafting_domain_core::contracts::SnapshotMessageArgs<'args>) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::SnapshotMessage<'bldr>>`

### `pub fn grafting_domain_core::contracts::SnapshotMessage<'a>::eq(&self, other: &grafting_domain_core::contracts::SnapshotMessage<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::SnapshotMessage<'a>::rng_seed(&self) -> core::option::Option<flatbuffers::vector::Vector<'a, u8>>`

### `pub fn grafting_domain_core::contracts::SnapshotMessage<'a>::rng_word_pos(&self) -> u64`

### `pub fn grafting_domain_core::contracts::SnapshotMessage<'a>::sequence(&self) -> u64`

### `pub fn grafting_domain_core::contracts::SnapshotMessage<'a>::state(&self) -> core::option::Option<grafting_domain_core::contracts::StateTable<'a>>`

### `pub fn grafting_domain_core::contracts::SnapshotMessage<'a>::state_hash(&self) -> core::option::Option<flatbuffers::vector::Vector<'a, u8>>`

### `pub fn grafting_domain_core::contracts::SnapshotMessageArgs<'a>::default() -> Self`

### `pub fn grafting_domain_core::contracts::SnapshotMessageBuilder<'a, 'b, A>::add_core_version(&mut self, core_version: flatbuffers::primitives::WIPOffset<&'b str>)`

### `pub fn grafting_domain_core::contracts::SnapshotMessageBuilder<'a, 'b, A>::add_rng_seed(&mut self, rng_seed: flatbuffers::primitives::WIPOffset<flatbuffers::vector::Vector<'b, u8>>)`

### `pub fn grafting_domain_core::contracts::SnapshotMessageBuilder<'a, 'b, A>::add_rng_word_pos(&mut self, rng_word_pos: u64)`

### `pub fn grafting_domain_core::contracts::SnapshotMessageBuilder<'a, 'b, A>::add_sequence(&mut self, sequence: u64)`

### `pub fn grafting_domain_core::contracts::SnapshotMessageBuilder<'a, 'b, A>::add_state(&mut self, state: flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::StateTable<'b>>)`

### `pub fn grafting_domain_core::contracts::SnapshotMessageBuilder<'a, 'b, A>::add_state_hash(&mut self, state_hash: flatbuffers::primitives::WIPOffset<flatbuffers::vector::Vector<'b, u8>>)`

### `pub fn grafting_domain_core::contracts::SnapshotMessageBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::SnapshotMessage<'a>>`

### `pub fn grafting_domain_core::contracts::SnapshotMessageBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::SnapshotMessageBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::StateTable<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::StateTable<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::StateTable<'a>::clone(&self) -> grafting_domain_core::contracts::StateTable<'a>`

### `pub fn grafting_domain_core::contracts::StateTable<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, args: &'args grafting_domain_core::contracts::StateTableArgs) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::StateTable<'bldr>>`

### `pub fn grafting_domain_core::contracts::StateTable<'a>::eq(&self, other: &grafting_domain_core::contracts::StateTable<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::StateTable<'a>::value(&self) -> i64`

### `pub fn grafting_domain_core::contracts::StateTableBuilder<'a, 'b, A>::add_value(&mut self, value: i64)`

### `pub fn grafting_domain_core::contracts::StateTableBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::StateTable<'a>>`

### `pub fn grafting_domain_core::contracts::StateTableBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::StateTableBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::WasReset<'_>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_domain_core::contracts::WasReset<'_>::run_verifier(v: &mut flatbuffers::verifier::Verifier<'_, '_>, pos: usize) -> core::result::Result<(), flatbuffers::verifier::InvalidFlatbuffer>`

### `pub fn grafting_domain_core::contracts::WasReset<'a>::clone(&self) -> grafting_domain_core::contracts::WasReset<'a>`

### `pub fn grafting_domain_core::contracts::WasReset<'a>::create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr, A: flatbuffers::builder::Allocator + 'bldr>(_fbb: &'mut_bldr mut flatbuffers::builder::FlatBufferBuilder<'bldr, A>, args: &'args grafting_domain_core::contracts::WasResetArgs) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::WasReset<'bldr>>`

### `pub fn grafting_domain_core::contracts::WasReset<'a>::eq(&self, other: &grafting_domain_core::contracts::WasReset<'a>) -> bool`

### `pub fn grafting_domain_core::contracts::WasReset<'a>::previous_value(&self) -> i64`

### `pub fn grafting_domain_core::contracts::WasResetBuilder<'a, 'b, A>::add_previous_value(&mut self, previous_value: i64)`

### `pub fn grafting_domain_core::contracts::WasResetBuilder<'a, 'b, A>::finish(self) -> flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::WasReset<'a>>`

### `pub fn grafting_domain_core::contracts::WasResetBuilder<'a, 'b, A>::new(_fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>) -> grafting_domain_core::contracts::WasResetBuilder<'a, 'b, A>`

### `pub fn grafting_domain_core::contracts::finish_command_message_buffer<'a, 'b, A: flatbuffers::builder::Allocator + 'a>(fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>, root: flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::CommandMessage<'a>>)`

### `pub fn grafting_domain_core::contracts::finish_domain_event_message_buffer<'a, 'b, A: flatbuffers::builder::Allocator + 'a>(fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>, root: flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::DomainEventMessage<'a>>)`

### `pub fn grafting_domain_core::contracts::finish_size_prefixed_command_message_buffer<'a, 'b, A: flatbuffers::builder::Allocator + 'a>(fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>, root: flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::CommandMessage<'a>>)`

### `pub fn grafting_domain_core::contracts::finish_size_prefixed_domain_event_message_buffer<'a, 'b, A: flatbuffers::builder::Allocator + 'a>(fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>, root: flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::DomainEventMessage<'a>>)`

### `pub fn grafting_domain_core::contracts::finish_size_prefixed_snapshot_message_buffer<'a, 'b, A: flatbuffers::builder::Allocator + 'a>(fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>, root: flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::SnapshotMessage<'a>>)`

### `pub fn grafting_domain_core::contracts::finish_snapshot_message_buffer<'a, 'b, A: flatbuffers::builder::Allocator + 'a>(fbb: &'b mut flatbuffers::builder::FlatBufferBuilder<'a, A>, root: flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::SnapshotMessage<'a>>)`

### `pub fn grafting_domain_core::contracts::root_as_command_message(buf: &[u8]) -> core::result::Result<grafting_domain_core::contracts::CommandMessage<'_>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies that a buffer of bytes contains a `CommandMessage`
and returns it.
Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`root_as_command_message_unchecked`.

### `pub fn grafting_domain_core::contracts::root_as_command_message_with_opts<'b, 'o>(opts: &'o flatbuffers::verifier::VerifierOptions, buf: &'b [u8]) -> core::result::Result<grafting_domain_core::contracts::CommandMessage<'b>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies, with the given options, that a buffer of bytes
contains a `CommandMessage` and returns it.
Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`root_as_command_message_unchecked`.

### `pub fn grafting_domain_core::contracts::root_as_domain_event_message(buf: &[u8]) -> core::result::Result<grafting_domain_core::contracts::DomainEventMessage<'_>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies that a buffer of bytes contains a `DomainEventMessage`
and returns it.
Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`root_as_domain_event_message_unchecked`.

### `pub fn grafting_domain_core::contracts::root_as_domain_event_message_with_opts<'b, 'o>(opts: &'o flatbuffers::verifier::VerifierOptions, buf: &'b [u8]) -> core::result::Result<grafting_domain_core::contracts::DomainEventMessage<'b>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies, with the given options, that a buffer of bytes
contains a `DomainEventMessage` and returns it.
Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`root_as_domain_event_message_unchecked`.

### `pub fn grafting_domain_core::contracts::root_as_snapshot_message(buf: &[u8]) -> core::result::Result<grafting_domain_core::contracts::SnapshotMessage<'_>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies that a buffer of bytes contains a `SnapshotMessage`
and returns it.
Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`root_as_snapshot_message_unchecked`.

### `pub fn grafting_domain_core::contracts::root_as_snapshot_message_with_opts<'b, 'o>(opts: &'o flatbuffers::verifier::VerifierOptions, buf: &'b [u8]) -> core::result::Result<grafting_domain_core::contracts::SnapshotMessage<'b>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies, with the given options, that a buffer of bytes
contains a `SnapshotMessage` and returns it.
Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`root_as_snapshot_message_unchecked`.

### `pub fn grafting_domain_core::contracts::size_prefixed_root_as_command_message(buf: &[u8]) -> core::result::Result<grafting_domain_core::contracts::CommandMessage<'_>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies that a buffer of bytes contains a size prefixed
`CommandMessage` and returns it.
Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`size_prefixed_root_as_command_message_unchecked`.

### `pub fn grafting_domain_core::contracts::size_prefixed_root_as_command_message_with_opts<'b, 'o>(opts: &'o flatbuffers::verifier::VerifierOptions, buf: &'b [u8]) -> core::result::Result<grafting_domain_core::contracts::CommandMessage<'b>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies, with the given verifier options, that a buffer of
bytes contains a size prefixed `CommandMessage` and returns
it. Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`root_as_command_message_unchecked`.

### `pub fn grafting_domain_core::contracts::size_prefixed_root_as_domain_event_message(buf: &[u8]) -> core::result::Result<grafting_domain_core::contracts::DomainEventMessage<'_>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies that a buffer of bytes contains a size prefixed
`DomainEventMessage` and returns it.
Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`size_prefixed_root_as_domain_event_message_unchecked`.

### `pub fn grafting_domain_core::contracts::size_prefixed_root_as_domain_event_message_with_opts<'b, 'o>(opts: &'o flatbuffers::verifier::VerifierOptions, buf: &'b [u8]) -> core::result::Result<grafting_domain_core::contracts::DomainEventMessage<'b>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies, with the given verifier options, that a buffer of
bytes contains a size prefixed `DomainEventMessage` and returns
it. Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`root_as_domain_event_message_unchecked`.

### `pub fn grafting_domain_core::contracts::size_prefixed_root_as_snapshot_message(buf: &[u8]) -> core::result::Result<grafting_domain_core::contracts::SnapshotMessage<'_>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies that a buffer of bytes contains a size prefixed
`SnapshotMessage` and returns it.
Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`size_prefixed_root_as_snapshot_message_unchecked`.

### `pub fn grafting_domain_core::contracts::size_prefixed_root_as_snapshot_message_with_opts<'b, 'o>(opts: &'o flatbuffers::verifier::VerifierOptions, buf: &'b [u8]) -> core::result::Result<grafting_domain_core::contracts::SnapshotMessage<'b>, flatbuffers::verifier::InvalidFlatbuffer>`

Verifies, with the given verifier options, that a buffer of
bytes contains a size prefixed `SnapshotMessage` and returns
it. Note that verification is still experimental and may not
catch every error, or be maximally performant. For the
previous, unchecked, behavior use
`root_as_snapshot_message_unchecked`.

### `pub fn grafting_domain_core::hash::StateHash::to_hex(&self) -> alloc::string::String`

### `pub fn grafting_domain_core::hash::state_hash(state: &grafting_domain_core::state::State, sequence: u64) -> grafting_domain_core::hash::StateHash`

### `pub fn grafting_domain_core::rng::DeterministicRng::from_seed(seed: [u8; 32]) -> Self`

### `pub fn grafting_domain_core::rng::DeterministicRng::from_seed_and_position(seed: [u8; 32], word_pos: u64) -> Self`

Restores an RNG that has already consumed `word_pos` words from the
stream started at `seed` -- used when resuming from a
[`crate::snapshot::Snapshot`] taken mid-sequence.

### `pub fn grafting_domain_core::rng::DeterministicRng::gen_range_i64(&mut self, low: i64, high: i64) -> i64`

Inclusive-exclusive range `[low, high)`, panics if `low >= high`.
Callers (see `command.rs`) validate the range before calling this.

### `pub fn grafting_domain_core::rng::DeterministicRng::word_pos(&self) -> u64`

Words consumed from the stream so far -- recorded in
[`crate::snapshot::Snapshot`] to allow exact resumption.

### `pub fn grafting_domain_core::snapshot::Snapshot::capture(state: grafting_domain_core::state::State, rng_seed: [u8; 32], rng: &grafting_domain_core::rng::DeterministicRng, sequence: u64) -> Self`

### `pub fn grafting_domain_core::snapshot::Snapshot::restore_rng(&self) -> grafting_domain_core::rng::DeterministicRng`

Rebuilds a [`DeterministicRng`] at the exact stream position
recorded at capture time, so replay from this snapshot continues
the same RNG stream instead of restarting it.

### `pub fn grafting_domain_core::snapshot::Snapshot::verify(&self) -> bool`

Recomputes the hash over the snapshot's own `(state, sequence)` and
checks it matches the hash recorded at capture time -- the
consistency check master source S15.7 describes for recovery.

### `pub fn grafting_domain_core::wire::decode_command(bytes: &[u8]) -> core::result::Result<grafting_domain_core::command::Command, grafting_domain_core::wire::WireError>`

### `pub fn grafting_domain_core::wire::decode_domain_event(bytes: &[u8]) -> core::result::Result<grafting_domain_core::event::DomainEvent, grafting_domain_core::wire::WireError>`

### `pub fn grafting_domain_core::wire::decode_snapshot(bytes: &[u8]) -> core::result::Result<grafting_domain_core::snapshot::Snapshot, grafting_domain_core::wire::WireError>`

### `pub fn grafting_domain_core::wire::encode_command(command: &grafting_domain_core::command::Command) -> alloc::vec::Vec<u8>`

### `pub fn grafting_domain_core::wire::encode_domain_event(event: &grafting_domain_core::event::DomainEvent) -> alloc::vec::Vec<u8>`

### `pub fn grafting_domain_core::wire::encode_snapshot(snapshot: &grafting_domain_core::snapshot::Snapshot) -> alloc::vec::Vec<u8>`

### `pub grafting_domain_core::command::Command::Decrement`

### `pub grafting_domain_core::command::Command::Decrement::amount: i64`

### `pub grafting_domain_core::command::Command::Increment`

### `pub grafting_domain_core::command::Command::Increment::amount: i64`

### `pub grafting_domain_core::command::Command::Reset`

### `pub grafting_domain_core::command::Command::RollAndAdd`

### `pub grafting_domain_core::command::Command::RollAndAdd::max: i64`

### `pub grafting_domain_core::command::Command::RollAndAdd::min: i64`

### `pub grafting_domain_core::command::CommandError::InvalidRange`

`RollAndAdd` had `min >= max`.

### `pub grafting_domain_core::command::CommandError::NonPositiveAmount`

`Increment`/`Decrement` amount was zero or negative.

### `pub grafting_domain_core::command::CommandError::Overflow`

Applying the command would overflow `i64`. Only ever produced by
`apply_command` (`apply.rs`), not by [`Command::validate_structure`]:
for `RollAndAdd` the exact delta isn't known until the RNG has
actually rolled it, so overflow can't be checked structurally.

### `pub grafting_domain_core::contracts::CommandMessage::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::CommandMessageArgs::payload: core::option::Option<flatbuffers::primitives::WIPOffset<flatbuffers::primitives::UnionWIPOffset>>`

### `pub grafting_domain_core::contracts::CommandMessageArgs::payload_type: grafting_domain_core::contracts::CommandPayload`

### `pub grafting_domain_core::contracts::Decrement::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::DecrementArgs::amount: i64`

### `pub grafting_domain_core::contracts::Decremented::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::DecrementedArgs::amount: i64`

### `pub grafting_domain_core::contracts::DecrementedArgs::new_value: i64`

### `pub grafting_domain_core::contracts::DomainEventMessage::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::DomainEventMessageArgs::payload: core::option::Option<flatbuffers::primitives::WIPOffset<flatbuffers::primitives::UnionWIPOffset>>`

### `pub grafting_domain_core::contracts::DomainEventMessageArgs::payload_type: grafting_domain_core::contracts::DomainEventPayload`

### `pub grafting_domain_core::contracts::Increment::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::IncrementArgs::amount: i64`

### `pub grafting_domain_core::contracts::IncrementArgs::sequence_hint: u64`

### `pub grafting_domain_core::contracts::Incremented::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::IncrementedArgs::amount: i64`

### `pub grafting_domain_core::contracts::IncrementedArgs::new_value: i64`

### `pub grafting_domain_core::contracts::Reset::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::RollAndAdd::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::RollAndAddArgs::max: i64`

### `pub grafting_domain_core::contracts::RollAndAddArgs::min: i64`

### `pub grafting_domain_core::contracts::RolledAndAdded::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::RolledAndAddedArgs::new_value: i64`

### `pub grafting_domain_core::contracts::RolledAndAddedArgs::rolled: i64`

### `pub grafting_domain_core::contracts::SnapshotMessage::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::SnapshotMessageArgs::core_version: core::option::Option<flatbuffers::primitives::WIPOffset<&'a str>>`

### `pub grafting_domain_core::contracts::SnapshotMessageArgs::rng_seed: core::option::Option<flatbuffers::primitives::WIPOffset<flatbuffers::vector::Vector<'a, u8>>>`

### `pub grafting_domain_core::contracts::SnapshotMessageArgs::rng_word_pos: u64`

### `pub grafting_domain_core::contracts::SnapshotMessageArgs::sequence: u64`

### `pub grafting_domain_core::contracts::SnapshotMessageArgs::state: core::option::Option<flatbuffers::primitives::WIPOffset<grafting_domain_core::contracts::StateTable<'a>>>`

### `pub grafting_domain_core::contracts::SnapshotMessageArgs::state_hash: core::option::Option<flatbuffers::primitives::WIPOffset<flatbuffers::vector::Vector<'a, u8>>>`

### `pub grafting_domain_core::contracts::StateTable::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::StateTableArgs::value: i64`

### `pub grafting_domain_core::contracts::WasReset::_tab: flatbuffers::table::Table<'a>`

### `pub grafting_domain_core::contracts::WasResetArgs::previous_value: i64`

### `pub grafting_domain_core::event::DomainEvent::Decremented`

### `pub grafting_domain_core::event::DomainEvent::Decremented::amount: i64`

### `pub grafting_domain_core::event::DomainEvent::Decremented::new_value: i64`

### `pub grafting_domain_core::event::DomainEvent::Incremented`

### `pub grafting_domain_core::event::DomainEvent::Incremented::amount: i64`

### `pub grafting_domain_core::event::DomainEvent::Incremented::new_value: i64`

### `pub grafting_domain_core::event::DomainEvent::RolledAndAdded`

### `pub grafting_domain_core::event::DomainEvent::RolledAndAdded::new_value: i64`

### `pub grafting_domain_core::event::DomainEvent::RolledAndAdded::rolled: i64`

### `pub grafting_domain_core::event::DomainEvent::WasReset`

### `pub grafting_domain_core::event::DomainEvent::WasReset::previous_value: i64`

### `pub grafting_domain_core::snapshot::Snapshot::core_version: alloc::string::String`

Owned, not `&'static str` -- a FlatBuffers-decoded snapshot's
`core_version` is real data read from bytes (possibly a much
older build's version, per S15.6's whole reason for this field
existing), never a `'static` string. A literal `&'static str`
could only be produced from decoded bytes by leaking memory on
every decode or silently substituting the *current* build's
version -- defeating the field's purpose (C-005/C-006).

### `pub grafting_domain_core::snapshot::Snapshot::rng_seed: [u8; 32]`

### `pub grafting_domain_core::snapshot::Snapshot::rng_word_pos: u64`

### `pub grafting_domain_core::snapshot::Snapshot::sequence: u64`

### `pub grafting_domain_core::snapshot::Snapshot::state: grafting_domain_core::state::State`

### `pub grafting_domain_core::snapshot::Snapshot::state_hash: grafting_domain_core::hash::StateHash`

### `pub grafting_domain_core::state::State::value: i64`

### `pub grafting_domain_core::wire::WireError::InvalidBuffer`

`flatc`'s own structural verifier rejected the buffer (S10.4:
"untrusted messages are verified before use") -- corrupt bytes,
truncated buffer, or a union discriminant/payload mismatch.

### `pub grafting_domain_core::wire::WireError::InvalidLength`

A `[ubyte]` field that must be exactly 32 bytes (`rng_seed`/
`state_hash`) was not.

### `pub grafting_domain_core::wire::WireError::InvalidLength::actual: usize`

### `pub grafting_domain_core::wire::WireError::InvalidLength::expected: usize`

### `pub grafting_domain_core::wire::WireError::InvalidLength::field: &'static str`

### `pub grafting_domain_core::wire::WireError::MissingField(&'static str)`

A required field was absent from an otherwise-valid buffer.

### `pub grafting_domain_core::wire::WireError::UnknownVariant`

A `CommandPayload`/`DomainEventPayload` union carried
`NONE` or a variant the writer of this code didn't know about.

### `pub mod grafting_domain_core`

Pure domain core: business rules, authoritative state, the state
machine, Command validation, DomainEvent generation, controlled RNG,
and the state hash (master source S4.2). Cannot depend on Three.js,
C#, Web APIs, sockets, a database, `wgpu`, the host filesystem, or a
non-injected global clock.

The domain modeled here is deliberately generic (a "tally counter"),
not a real game/VTT domain -- nothing in the project docs specifies
actual game content yet, and inventing it here would mean inventing
product requirements. This crate instead proves every real
architectural requirement Epic C calls for (validated commands,
semantic events, controlled RNG, a state hash, snapshots, and
same-seed replay determinism per DEC-044) against that generic domain.

### `pub mod grafting_domain_core::apply`

The state transition function: validates a [`Command`], applies it to
[`State`] using [`DeterministicRng`] when needed, and produces the
resulting [`DomainEvent`]s (master source S4.2: "applying changes" +
"generating DomainEvents"). Never panics -- every failure mode is a
typed [`CommandError`].

### `pub mod grafting_domain_core::command`

Client-facing intent, validated before it can affect state (master
source S15.2: this `Command` is the core-internal validated type, kept
distinct from the network-facing `ClientCommand`/`AcceptedCommand`
pair -- those belong to the multiplayer host, Phase 6/Epic H, not
modeled here).

### `pub mod grafting_domain_core::contracts`

Hand-written glue over `flatc`'s generated output in `src/generated/`
(itself gitignored, not the source of truth -- master source S10.3).
`flatc --rust` emits one file per schema, each independently wrapped
in `pub mod grafting { pub mod contracts { ... } }` (from the shared
`namespace Grafting.Contracts;` declaration in `contracts/*.fbs`) --
this file wires all three into one accessible module. Safe to flatten
with `pub use ...::*` since the three schemas declare no overlapping
type names.

### `pub mod grafting_domain_core::event`

Semantic facts produced by the domain (master source S15.2:
`DomainEvent` is distinct from `ReplicationDelta` -- that projection
layer is Phase 6/Epic H, not modeled here).

### `pub mod grafting_domain_core::hash`

State hash (master source S4.2, S15.5, S15.6; DEC-044's replay
determinism claim is that this hash matches across independent
replays of the same command sequence on the same platform/build).

### `pub mod grafting_domain_core::rng`

Controlled RNG (master source S4.2's "controlled RNG" domain-core
responsibility).

Wraps `ChaCha8Rng` rather than `rand::rngs::StdRng` deliberately:
`StdRng`'s algorithm is *not* guaranteed stable across `rand`
releases, while ChaCha8's is fixed by construction and by the
`rand_chacha` crate's own stability guarantees. DEC-044 requires the
RNG algorithm to be fixed per build for same-platform replay
determinism -- an unstable-algorithm RNG would silently violate that.

### `pub mod grafting_domain_core::snapshot`

Persistable authoritative state (master source S15.6: minimum content
is authoritative state, RNG state, last sequence, state hash, core
version, protocol/save version).

`core_version` alone does **not** cover DEC-044's full "same platform"
definition -- build ID, target, protocol/schema versions, features,
numeric configuration, and RNG algorithm are all supposed to be fixed
per build. A real determinism manifest covering all six axes doesn't
exist anywhere in this repo yet. This is a known, recorded gap (see
`docs/history/PLANNING_LOG.md`'s Epic C entry), not something this
snapshot format claims to solve.

Round-trip is proven with `#[derive(Clone, PartialEq)]`, not a
serialization crate: master source S10.1 explicitly names Snapshot for
FlatBuffers (DEC-013, `LOCKED`) -- introducing `serde`/anything else
here, even "temporarily," would be a second real format for a decision
that's already made. The real wire/save format is `contracts/snapshot.fbs`
(C-005/C-006) -- this type stays the hand-written, canonical
in-process representation; the generated FlatBuffers type
(`contracts::SnapshotMessage`) is the wire form, converted to/from via
`tests/flatbuffers_round_trip.rs`, not a replacement for this struct.

### `pub mod grafting_domain_core::state`

Authoritative state (master source S4.2).

Deliberately generic: a "tally counter," not a real game domain, per
this task's scope (no product requirements exist in the docs to build
against yet). See `apply.rs` for how [`crate::command::Command`]s
mutate this state and produce [`crate::event::DomainEvent`]s.

### `pub mod grafting_domain_core::wire`

Hand-written conversions between `domain-core`'s canonical
`Command`/`DomainEvent`/`Snapshot` and their FlatBuffers wire form
(`contracts::CommandMessage`/`DomainEventMessage`/`SnapshotMessage`,
generated from `contracts/*.fbs` -- master source S10.1, DEC-013,
`LOCKED`). The generated types are the wire format; the hand-written
enums/struct in `command.rs`/`event.rs`/`snapshot.rs` stay the
canonical in-process representation -- this module is the boundary
between them, not a replacement for either side.

No consumer crosses a real process/language boundary with these yet
(`engine_submit_increment` still takes a plain `i64`, not encoded
bytes -- see `libs/isekai/capi-bridge`'s crate docs for why) -- these
functions exist so the schema is proven correct by a real round trip
(`tests/flatbuffers_round_trip.rs`), not left as "it compiles."

### `pub struct grafting_domain_core::contracts::CommandMessage<'a>`

### `pub struct grafting_domain_core::contracts::CommandMessageArgs`

### `pub struct grafting_domain_core::contracts::CommandMessageBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::contracts::CommandPayloadUnionTableOffset`

### `pub struct grafting_domain_core::contracts::Decrement<'a>`

### `pub struct grafting_domain_core::contracts::DecrementArgs`

### `pub struct grafting_domain_core::contracts::DecrementBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::contracts::Decremented<'a>`

### `pub struct grafting_domain_core::contracts::DecrementedArgs`

### `pub struct grafting_domain_core::contracts::DecrementedBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::contracts::DomainEventMessage<'a>`

### `pub struct grafting_domain_core::contracts::DomainEventMessageArgs`

### `pub struct grafting_domain_core::contracts::DomainEventMessageBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::contracts::DomainEventPayloadUnionTableOffset`

### `pub struct grafting_domain_core::contracts::Increment<'a>`

### `pub struct grafting_domain_core::contracts::IncrementArgs`

### `pub struct grafting_domain_core::contracts::IncrementBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::contracts::Incremented<'a>`

### `pub struct grafting_domain_core::contracts::IncrementedArgs`

### `pub struct grafting_domain_core::contracts::IncrementedBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::contracts::Reset<'a>`

### `pub struct grafting_domain_core::contracts::ResetArgs`

### `pub struct grafting_domain_core::contracts::ResetBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::contracts::RollAndAdd<'a>`

### `pub struct grafting_domain_core::contracts::RollAndAddArgs`

### `pub struct grafting_domain_core::contracts::RollAndAddBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::contracts::RolledAndAdded<'a>`

### `pub struct grafting_domain_core::contracts::RolledAndAddedArgs`

### `pub struct grafting_domain_core::contracts::RolledAndAddedBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::contracts::SnapshotMessage<'a>`

### `pub struct grafting_domain_core::contracts::SnapshotMessageArgs<'a>`

### `pub struct grafting_domain_core::contracts::SnapshotMessageBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::contracts::StateTable<'a>`

### `pub struct grafting_domain_core::contracts::StateTableArgs`

### `pub struct grafting_domain_core::contracts::StateTableBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::contracts::WasReset<'a>`

### `pub struct grafting_domain_core::contracts::WasResetArgs`

### `pub struct grafting_domain_core::contracts::WasResetBuilder<'a: 'b, 'b, A: flatbuffers::builder::Allocator + 'a>`

### `pub struct grafting_domain_core::hash::StateHash(pub [u8; 32])`

### `pub struct grafting_domain_core::rng::DeterministicRng`

### `pub struct grafting_domain_core::snapshot::Snapshot`

### `pub struct grafting_domain_core::state::State`

### `pub type grafting_domain_core::contracts::CommandMessage<'a>::Inner = grafting_domain_core::contracts::CommandMessage<'a>`

### `pub type grafting_domain_core::contracts::CommandPayload::Inner = grafting_domain_core::contracts::CommandPayload`

### `pub type grafting_domain_core::contracts::CommandPayload::Output = grafting_domain_core::contracts::CommandPayload`

### `pub type grafting_domain_core::contracts::CommandPayload::Scalar = u8`

### `pub type grafting_domain_core::contracts::Decrement<'a>::Inner = grafting_domain_core::contracts::Decrement<'a>`

### `pub type grafting_domain_core::contracts::Decremented<'a>::Inner = grafting_domain_core::contracts::Decremented<'a>`

### `pub type grafting_domain_core::contracts::DomainEventMessage<'a>::Inner = grafting_domain_core::contracts::DomainEventMessage<'a>`

### `pub type grafting_domain_core::contracts::DomainEventPayload::Inner = grafting_domain_core::contracts::DomainEventPayload`

### `pub type grafting_domain_core::contracts::DomainEventPayload::Output = grafting_domain_core::contracts::DomainEventPayload`

### `pub type grafting_domain_core::contracts::DomainEventPayload::Scalar = u8`

### `pub type grafting_domain_core::contracts::Increment<'a>::Inner = grafting_domain_core::contracts::Increment<'a>`

### `pub type grafting_domain_core::contracts::Incremented<'a>::Inner = grafting_domain_core::contracts::Incremented<'a>`

### `pub type grafting_domain_core::contracts::Reset<'a>::Inner = grafting_domain_core::contracts::Reset<'a>`

### `pub type grafting_domain_core::contracts::RollAndAdd<'a>::Inner = grafting_domain_core::contracts::RollAndAdd<'a>`

### `pub type grafting_domain_core::contracts::RolledAndAdded<'a>::Inner = grafting_domain_core::contracts::RolledAndAdded<'a>`

### `pub type grafting_domain_core::contracts::SnapshotMessage<'a>::Inner = grafting_domain_core::contracts::SnapshotMessage<'a>`

### `pub type grafting_domain_core::contracts::StateTable<'a>::Inner = grafting_domain_core::contracts::StateTable<'a>`

### `pub type grafting_domain_core::contracts::WasReset<'a>::Inner = grafting_domain_core::contracts::WasReset<'a>`

### `pub unsafe fn grafting_domain_core::contracts::CommandMessage<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::CommandMessage<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::CommandPayload::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::CommandPayload::push(&self, dst: &mut [u8], _written_len: usize)`

### `pub unsafe fn grafting_domain_core::contracts::Decrement<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::Decrement<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::Decremented<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::Decremented<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::DomainEventMessage<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::DomainEventMessage<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::DomainEventPayload::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::DomainEventPayload::push(&self, dst: &mut [u8], _written_len: usize)`

### `pub unsafe fn grafting_domain_core::contracts::Increment<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::Increment<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::Incremented<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::Incremented<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::Reset<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::Reset<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::RollAndAdd<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::RollAndAdd<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::RolledAndAdded<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::RolledAndAdded<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::SnapshotMessage<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::SnapshotMessage<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::StateTable<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::StateTable<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::WasReset<'a>::follow(buf: &'a [u8], loc: usize) -> Self::Inner`

### `pub unsafe fn grafting_domain_core::contracts::WasReset<'a>::init_from_table(table: flatbuffers::table::Table<'a>) -> Self`

### `pub unsafe fn grafting_domain_core::contracts::root_as_command_message_unchecked(buf: &[u8]) -> grafting_domain_core::contracts::CommandMessage<'_>`

Assumes, without verification, that a buffer of bytes contains a CommandMessage and returns it.
# Safety
Callers must trust the given bytes do indeed contain a valid `CommandMessage`.

### `pub unsafe fn grafting_domain_core::contracts::root_as_domain_event_message_unchecked(buf: &[u8]) -> grafting_domain_core::contracts::DomainEventMessage<'_>`

Assumes, without verification, that a buffer of bytes contains a DomainEventMessage and returns it.
# Safety
Callers must trust the given bytes do indeed contain a valid `DomainEventMessage`.

### `pub unsafe fn grafting_domain_core::contracts::root_as_snapshot_message_unchecked(buf: &[u8]) -> grafting_domain_core::contracts::SnapshotMessage<'_>`

Assumes, without verification, that a buffer of bytes contains a SnapshotMessage and returns it.
# Safety
Callers must trust the given bytes do indeed contain a valid `SnapshotMessage`.

### `pub unsafe fn grafting_domain_core::contracts::size_prefixed_root_as_command_message_unchecked(buf: &[u8]) -> grafting_domain_core::contracts::CommandMessage<'_>`

Assumes, without verification, that a buffer of bytes contains a size prefixed CommandMessage and returns it.
# Safety
Callers must trust the given bytes do indeed contain a valid size prefixed `CommandMessage`.

### `pub unsafe fn grafting_domain_core::contracts::size_prefixed_root_as_domain_event_message_unchecked(buf: &[u8]) -> grafting_domain_core::contracts::DomainEventMessage<'_>`

Assumes, without verification, that a buffer of bytes contains a size prefixed DomainEventMessage and returns it.
# Safety
Callers must trust the given bytes do indeed contain a valid size prefixed `DomainEventMessage`.

### `pub unsafe fn grafting_domain_core::contracts::size_prefixed_root_as_snapshot_message_unchecked(buf: &[u8]) -> grafting_domain_core::contracts::SnapshotMessage<'_>`

Assumes, without verification, that a buffer of bytes contains a size prefixed SnapshotMessage and returns it.
# Safety
Callers must trust the given bytes do indeed contain a valid size prefixed `SnapshotMessage`.
