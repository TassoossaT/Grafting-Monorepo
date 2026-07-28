//! A job's result bytes, held behind a handle (master source S12.4:
//! `OwnedByRust → ViewLeased → OwnedByRust → Released`). `view()` is
//! idempotent (repeatable) rather than gated on a strict "already leased"
//! state -- same reasoning as `libs/isekai/capi-bridge/src/buffer.rs`.

pub struct BufferRecord {
    pub data: Vec<u8>,
}

impl BufferRecord {
    pub fn new(data: Vec<u8>) -> Self {
        BufferRecord { data }
    }
}
