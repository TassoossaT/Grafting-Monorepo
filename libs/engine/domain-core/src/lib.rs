//! Pure domain core: business rules, authoritative state, the state
//! machine, Command validation, DomainEvent generation, controlled RNG,
//! and the state hash (master source S4.2). Cannot depend on Three.js,
//! C#, Web APIs, sockets, a database, `wgpu`, the host filesystem, or a
//! non-injected global clock.
//!
//! The domain modeled here is deliberately generic (a "tally counter"),
//! not a real game/VTT domain -- nothing in the project docs specifies
//! actual game content yet, and inventing it here would mean inventing
//! product requirements. This crate instead proves every real
//! architectural requirement Epic C calls for (validated commands,
//! semantic events, controlled RNG, a state hash, snapshots, and
//! same-seed replay determinism per DEC-044) against that generic domain.

pub mod apply;
pub mod command;
pub mod event;
pub mod hash;
pub mod rng;
pub mod snapshot;
pub mod state;
