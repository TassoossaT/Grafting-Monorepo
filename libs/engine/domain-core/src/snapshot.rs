//! Persistable authoritative state (master source S15.6: minimum content
//! is authoritative state, RNG state, last sequence, state hash, core
//! version, protocol/save version).
//!
//! `core_version` alone does **not** cover DEC-044's full "same platform"
//! definition -- build ID, target, protocol/schema versions, features,
//! numeric configuration, and RNG algorithm are all supposed to be fixed
//! per build. A real determinism manifest covering all six axes doesn't
//! exist anywhere in this repo yet. This is a known, recorded gap (see
//! `docs/history/PLANNING_LOG.md`'s Epic C entry), not something this
//! snapshot format claims to solve.
//!
//! Round-trip is proven with `#[derive(Clone, PartialEq)]`, not a
//! serialization crate: master source S10.1 explicitly names Snapshot for
//! FlatBuffers (DEC-013, `LOCKED`) -- introducing `serde`/anything else
//! here, even "temporarily," would be a second real format for a decision
//! that's already made. The real wire/save format is `contracts/snapshot.fbs`
//! (C-005/C-006) -- this type stays the hand-written, canonical
//! in-process representation; the generated FlatBuffers type
//! (`contracts::SnapshotMessage`) is the wire form, converted to/from via
//! `tests/flatbuffers_round_trip.rs`, not a replacement for this struct.

use crate::hash::{StateHash, state_hash};
use crate::rng::DeterministicRng;
use crate::state::State;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub state: State,
    pub rng_seed: [u8; 32],
    pub rng_word_pos: u64,
    pub sequence: u64,
    pub state_hash: StateHash,
    /// Owned, not `&'static str` -- a FlatBuffers-decoded snapshot's
    /// `core_version` is real data read from bytes (possibly a much
    /// older build's version, per S15.6's whole reason for this field
    /// existing), never a `'static` string. A literal `&'static str`
    /// could only be produced from decoded bytes by leaking memory on
    /// every decode or silently substituting the *current* build's
    /// version -- defeating the field's purpose (C-005/C-006).
    pub core_version: String,
}

impl Snapshot {
    pub fn capture(
        state: State,
        rng_seed: [u8; 32],
        rng: &DeterministicRng,
        sequence: u64,
    ) -> Self {
        Snapshot {
            state,
            rng_seed,
            rng_word_pos: rng.word_pos(),
            sequence,
            state_hash: state_hash(&state, sequence),
            core_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }

    /// Rebuilds a [`DeterministicRng`] at the exact stream position
    /// recorded at capture time, so replay from this snapshot continues
    /// the same RNG stream instead of restarting it.
    pub fn restore_rng(&self) -> DeterministicRng {
        DeterministicRng::from_seed_and_position(self.rng_seed, self.rng_word_pos)
    }

    /// Recomputes the hash over the snapshot's own `(state, sequence)` and
    /// checks it matches the hash recorded at capture time -- the
    /// consistency check master source S15.7 describes for recovery.
    pub fn verify(&self) -> bool {
        state_hash(&self.state, self.sequence) == self.state_hash
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apply::apply_command;
    use crate::command::Command;

    #[test]
    fn round_trip_via_clone_preserves_every_field() {
        let mut state = State::new();
        let seed = [9; 32];
        let mut rng = DeterministicRng::from_seed(seed);
        apply_command(&mut state, &mut rng, Command::Increment { amount: 5 }).unwrap();

        let snapshot = Snapshot::capture(state, seed, &rng, 1);
        let round_tripped = snapshot.clone();

        assert_eq!(snapshot, round_tripped);
    }

    #[test]
    fn a_freshly_captured_snapshot_verifies() {
        let state = State { value: 7 };
        let rng = DeterministicRng::from_seed([1; 32]);
        let snapshot = Snapshot::capture(state, [1; 32], &rng, 3);
        assert!(snapshot.verify());
    }

    #[test]
    fn tampering_with_the_state_after_capture_fails_verification() {
        let state = State { value: 7 };
        let rng = DeterministicRng::from_seed([1; 32]);
        let mut snapshot = Snapshot::capture(state, [1; 32], &rng, 3);
        snapshot.state.value = 999; // simulate corruption/tampering
        assert!(!snapshot.verify());
    }

    /// Restoring from a mid-sequence snapshot and continuing replay
    /// reproduces the same forward hash as never snapshotting at all --
    /// the scenario master source S15.7 describes for recovery. The
    /// property-based version over arbitrary command sequences lives in
    /// `tests/replay_determinism.rs` (C-008).
    #[test]
    fn resuming_from_a_snapshot_reproduces_the_same_forward_hash() {
        let seed = [5; 32];
        let commands = [
            Command::Increment { amount: 10 },
            Command::RollAndAdd { min: 1, max: 50 },
            Command::Decrement { amount: 2 },
            Command::RollAndAdd { min: 1, max: 50 },
        ];

        // Baseline: apply all four commands in one continuous run.
        let baseline_hash = {
            let mut state = State::new();
            let mut rng = DeterministicRng::from_seed(seed);
            for command in commands {
                apply_command(&mut state, &mut rng, command).unwrap();
            }
            state_hash(&state, commands.len() as u64)
        };

        // Snapshot after the first two commands, restore, then apply the
        // remaining two from the snapshot.
        let resumed_hash = {
            let mut state = State::new();
            let mut rng = DeterministicRng::from_seed(seed);
            apply_command(&mut state, &mut rng, commands[0]).unwrap();
            apply_command(&mut state, &mut rng, commands[1]).unwrap();
            let snapshot = Snapshot::capture(state, seed, &rng, 2);

            let mut state = snapshot.state;
            let mut rng = snapshot.restore_rng();
            apply_command(&mut state, &mut rng, commands[2]).unwrap();
            apply_command(&mut state, &mut rng, commands[3]).unwrap();
            state_hash(&state, commands.len() as u64)
        };

        assert_eq!(baseline_hash, resumed_hash);
    }
}
