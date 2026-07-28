//! A leased view over a job's result bytes (master source S12.4:
//! `OwnedByRust → ViewLeased → OwnedByRust → Released`). `engine_buffer_view`
//! is idempotent (repeatable, always returns the same pointer/length)
//! rather than gating on a strict "already leased" state -- S11.6's
//! conceptual API has no separate "end view" function, so there is
//! nothing for a stricter state machine to transition back through
//! before `engine_buffer_release`.

pub struct BufferRecord {
    pub data: Vec<u8>,
}

impl BufferRecord {
    pub fn new(data: Vec<u8>) -> Self {
        BufferRecord { data }
    }
}
