//! Hand-written glue over `flatc`'s generated output in `src/generated/`
//! (itself gitignored, not the source of truth -- master source S10.3).
//! `flatc --rust` emits one file per schema, each independently wrapped
//! in `pub mod grafting { pub mod contracts { ... } }` (from the shared
//! `namespace Grafting.Contracts;` declaration in `contracts/*.fbs`) --
//! this file wires all three into one accessible module. Safe to flatten
//! with `pub use ...::*` since the three schemas declare no overlapping
//! type names.

#![allow(unused_imports, dead_code)]

#[path = "generated/command_generated.rs"]
mod command_generated;
#[path = "generated/domain_event_generated.rs"]
mod domain_event_generated;
#[path = "generated/snapshot_generated.rs"]
mod snapshot_generated;

pub use command_generated::grafting::contracts::*;
pub use domain_event_generated::grafting::contracts::*;
pub use snapshot_generated::grafting::contracts::*;
