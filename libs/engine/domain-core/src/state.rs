//! Authoritative state (master source S4.2).
//!
//! Deliberately generic: a "tally counter," not a real game domain, per
//! this task's scope (no product requirements exist in the docs to build
//! against yet). See `apply.rs` for how [`crate::command::Command`]s
//! mutate this state and produce [`crate::event::DomainEvent`]s.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct State {
    pub value: i64,
}

impl State {
    pub const fn new() -> Self {
        State { value: 0 }
    }
}

impl Default for State {
    fn default() -> Self {
        Self::new()
    }
}
