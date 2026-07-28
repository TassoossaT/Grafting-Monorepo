//! C-008: property tests over arbitrary command sequences, generalizing
//! the fixed-sequence examples in `src/hash.rs` and `src/snapshot.rs`.
//! This is the actual DEC-044 claim under many random inputs, not just
//! the handful of examples covered by unit tests.

use grafting_domain_core::apply::apply_command;
use grafting_domain_core::command::Command;
use grafting_domain_core::hash::{StateHash, state_hash};
use grafting_domain_core::rng::DeterministicRng;
use grafting_domain_core::snapshot::Snapshot;
use grafting_domain_core::state::State;

use proptest::prelude::*;

fn arb_command() -> impl Strategy<Value = Command> {
    prop_oneof![
        (1i64..1_000).prop_map(|amount| Command::Increment { amount }),
        (1i64..1_000).prop_map(|amount| Command::Decrement { amount }),
        Just(Command::Reset),
        (1i64..500, 501i64..1_000).prop_map(|(min, max)| Command::RollAndAdd { min, max }),
    ]
}

fn arb_seed() -> impl Strategy<Value = [u8; 32]> {
    prop::array::uniform32(any::<u8>())
}

/// Applies `commands` from a fresh `State`, skipping any that error
/// (structurally-valid-by-construction commands can still overflow --
/// that's a real, expected outcome, not a test bug) and returns the
/// resulting hash. `sequence` only advances on a successful application,
/// matching `apply_command`'s own contract.
fn run_sequence(seed: [u8; 32], commands: &[Command]) -> StateHash {
    let mut state = State::new();
    let mut rng = DeterministicRng::from_seed(seed);
    let mut sequence = 0u64;
    for &command in commands {
        if apply_command(&mut state, &mut rng, command).is_ok() {
            sequence += 1;
        }
    }
    state_hash(&state, sequence)
}

proptest! {
    /// The core DEC-044 claim: replaying the same command sequence from
    /// the same seed twice, independently, produces the same hash --
    /// checked over hundreds of random sequences, not just one example.
    #[test]
    fn replay_is_deterministic(
        seed in arb_seed(),
        commands in prop::collection::vec(arb_command(), 0..50),
    ) {
        prop_assert_eq!(run_sequence(seed, &commands), run_sequence(seed, &commands));
    }

    /// Invariant: no sequence of (structurally valid, possibly
    /// overflow-rejected) commands ever panics. Reaching the assertion at
    /// all is the property; a panic anywhere above would fail the test on
    /// its own.
    #[test]
    fn commands_never_panic(
        seed in arb_seed(),
        commands in prop::collection::vec(arb_command(), 0..50),
    ) {
        let mut state = State::new();
        let mut rng = DeterministicRng::from_seed(seed);
        for &command in &commands {
            let _ = apply_command(&mut state, &mut rng, command);
        }
        prop_assert!(true);
    }

    /// Generalizes `snapshot::tests::resuming_from_a_snapshot_reproduces_the_same_forward_hash`
    /// to arbitrary split points and sequences (master source S15.7's
    /// recovery flow): capturing a snapshot mid-sequence and resuming from
    /// it must reproduce the same hash as never having snapshotted.
    #[test]
    fn resuming_from_a_snapshot_matches_continuous_replay(
        seed in arb_seed(),
        first_half in prop::collection::vec(arb_command(), 0..20),
        second_half in prop::collection::vec(arb_command(), 0..20),
    ) {
        let mut all_commands = first_half.clone();
        all_commands.extend(second_half.clone());
        let baseline = run_sequence(seed, &all_commands);

        let mut state = State::new();
        let mut rng = DeterministicRng::from_seed(seed);
        let mut sequence = 0u64;
        for &command in &first_half {
            if apply_command(&mut state, &mut rng, command).is_ok() {
                sequence += 1;
            }
        }
        let snapshot = Snapshot::capture(state, seed, &rng, sequence);
        prop_assert!(snapshot.verify());

        let mut state = snapshot.state;
        let mut rng = snapshot.restore_rng();
        let mut sequence = snapshot.sequence;
        for &command in &second_half {
            if apply_command(&mut state, &mut rng, command).is_ok() {
                sequence += 1;
            }
        }
        let resumed = state_hash(&state, sequence);

        prop_assert_eq!(baseline, resumed);
    }
}
