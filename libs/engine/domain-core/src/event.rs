//! Semantic facts produced by the domain (master source S15.2:
//! `DomainEvent` is distinct from `ReplicationDelta` -- that projection
//! layer is Phase 6/Epic H, not modeled here).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DomainEvent {
    Incremented { amount: i64, new_value: i64 },
    Decremented { amount: i64, new_value: i64 },
    WasReset { previous_value: i64 },
    RolledAndAdded { rolled: i64, new_value: i64 },
}
