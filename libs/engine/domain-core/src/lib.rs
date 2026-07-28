//! Pure domain core: business rules, authoritative state, the state
//! machine, Command validation, DomainEvent generation, and the state
//! hash (master source S4.2). Cannot depend on Three.js, C#, Web APIs,
//! sockets, a database, `wgpu`, the host filesystem, or a non-injected
//! global clock.
//!
//! This crate is currently empty of real domain logic on purpose: Epic C
//! (C-001..C-008) is where Command/DomainEvent/Snapshot/state-hash content
//! gets added. What exists here for now only proves the Cargo + Nx
//! pipeline (workspace member, `cargo check`/`test`, Nx caching) works
//! end to end before any real logic is written.

/// Placeholder proving the crate compiles and is exercised by `cargo test`
/// / the Nx `test` target. Remove once Epic C adds real domain APIs.
pub fn placeholder_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_version_is_not_empty() {
        assert!(!placeholder_version().is_empty());
    }
}
