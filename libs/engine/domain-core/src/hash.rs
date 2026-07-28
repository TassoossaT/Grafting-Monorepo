//! State hash (master source S4.2, S15.5, S15.6; DEC-044's replay
//! determinism claim is that this hash matches across independent
//! replays of the same command sequence on the same platform/build).

use sha2::{Digest, Sha256};

use crate::state::State;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StateHash(pub [u8; 32]);

impl StateHash {
    pub fn to_hex(&self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// Canonical, explicitly-ordered byte encoding of `(state, sequence)` --
/// deliberately hand-written rather than derived from struct field order,
/// so the encoding is a documented contract, not an accident of
/// `#[derive]`. The domain-separator prefix guards against accidental
/// collisions with encodings of unrelated data hashed elsewhere later.
fn canonical_bytes(state: &State, sequence: u64) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"grafting.domain-core.state.v1");
    bytes.extend_from_slice(&sequence.to_be_bytes());
    bytes.extend_from_slice(&state.value.to_be_bytes());
    bytes
}

pub fn state_hash(state: &State, sequence: u64) -> StateHash {
    let digest = Sha256::digest(canonical_bytes(state, sequence));
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    StateHash(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apply::apply_command;
    use crate::command::Command;
    use crate::rng::DeterministicRng;

    #[test]
    fn identical_state_and_sequence_hash_identically() {
        let state = State { value: 42 };
        assert_eq!(state_hash(&state, 7), state_hash(&state, 7));
    }

    #[test]
    fn different_state_changes_the_hash() {
        let a = State { value: 1 };
        let b = State { value: 2 };
        assert_ne!(state_hash(&a, 0), state_hash(&b, 0));
    }

    #[test]
    fn different_sequence_changes_the_hash_even_for_identical_state() {
        let state = State { value: 1 };
        assert_ne!(state_hash(&state, 0), state_hash(&state, 1));
    }

    /// The actual DEC-044 claim, in miniature: replaying the same command
    /// sequence from the same initial state and RNG seed twice,
    /// independently, produces the same final state hash. (The
    /// property-based version covering arbitrary sequences lives in
    /// `tests/replay_determinism.rs`, C-008.)
    #[test]
    fn replaying_the_same_command_sequence_reproduces_the_same_hash() {
        let commands = [
            Command::Increment { amount: 10 },
            Command::RollAndAdd { min: 1, max: 100 },
            Command::Decrement { amount: 3 },
        ];
        let seed = [42; 32];

        let run = || {
            let mut state = State::new();
            let mut rng = DeterministicRng::from_seed(seed);
            let mut sequence = 0u64;
            for command in commands {
                apply_command(&mut state, &mut rng, command).unwrap();
                sequence += 1;
            }
            state_hash(&state, sequence)
        };

        assert_eq!(run(), run());
    }
}
