//! The state transition function: validates a [`Command`], applies it to
//! [`State`] using [`DeterministicRng`] when needed, and produces the
//! resulting [`DomainEvent`]s (master source S4.2: "applying changes" +
//! "generating DomainEvents"). Never panics -- every failure mode is a
//! typed [`CommandError`].

use crate::command::{Command, CommandError};
use crate::event::DomainEvent;
use crate::rng::DeterministicRng;
use crate::state::State;

pub fn apply_command(
    state: &mut State,
    rng: &mut DeterministicRng,
    command: Command,
) -> Result<Vec<DomainEvent>, CommandError> {
    command.validate_structure()?;

    match command {
        Command::Increment { amount } => {
            let new_value = state
                .value
                .checked_add(amount)
                .ok_or(CommandError::Overflow)?;
            state.value = new_value;
            Ok(vec![DomainEvent::Incremented { amount, new_value }])
        }
        Command::Decrement { amount } => {
            let new_value = state
                .value
                .checked_sub(amount)
                .ok_or(CommandError::Overflow)?;
            state.value = new_value;
            Ok(vec![DomainEvent::Decremented { amount, new_value }])
        }
        Command::Reset => {
            let previous_value = state.value;
            state.value = 0;
            Ok(vec![DomainEvent::WasReset { previous_value }])
        }
        Command::RollAndAdd { min, max } => {
            let rolled = rng.gen_range_i64(min, max);
            let new_value = state
                .value
                .checked_add(rolled)
                .ok_or(CommandError::Overflow)?;
            state.value = new_value;
            Ok(vec![DomainEvent::RolledAndAdded { rolled, new_value }])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rng() -> DeterministicRng {
        DeterministicRng::from_seed([1; 32])
    }

    #[test]
    fn increment_adds_and_emits_event() {
        let mut state = State::new();
        let events =
            apply_command(&mut state, &mut rng(), Command::Increment { amount: 5 }).unwrap();
        assert_eq!(state.value, 5);
        assert_eq!(
            events,
            vec![DomainEvent::Incremented {
                amount: 5,
                new_value: 5
            }]
        );
    }

    #[test]
    fn decrement_subtracts_and_emits_event() {
        let mut state = State { value: 10 };
        let events =
            apply_command(&mut state, &mut rng(), Command::Decrement { amount: 3 }).unwrap();
        assert_eq!(state.value, 7);
        assert_eq!(
            events,
            vec![DomainEvent::Decremented {
                amount: 3,
                new_value: 7
            }]
        );
    }

    #[test]
    fn reset_zeroes_state_and_emits_previous_value() {
        let mut state = State { value: 42 };
        let events = apply_command(&mut state, &mut rng(), Command::Reset).unwrap();
        assert_eq!(state.value, 0);
        assert_eq!(events, vec![DomainEvent::WasReset { previous_value: 42 }]);
    }

    #[test]
    fn roll_and_add_uses_rng_within_range_and_emits_event() {
        let mut state = State::new();
        let mut r = rng();
        let events =
            apply_command(&mut state, &mut r, Command::RollAndAdd { min: 1, max: 7 }).unwrap();
        match events.as_slice() {
            [DomainEvent::RolledAndAdded { rolled, new_value }] => {
                assert!((1..7).contains(rolled));
                assert_eq!(*new_value, state.value);
                assert_eq!(*new_value, *rolled);
            }
            other => panic!("unexpected events: {other:?}"),
        }
    }

    #[test]
    fn invalid_command_is_rejected_without_mutating_state() {
        let mut state = State { value: 10 };
        let result = apply_command(&mut state, &mut rng(), Command::Increment { amount: -1 });
        assert_eq!(result, Err(CommandError::NonPositiveAmount));
        assert_eq!(state.value, 10);
    }

    #[test]
    fn increment_overflow_is_rejected_not_panicking() {
        let mut state = State { value: i64::MAX };
        let result = apply_command(&mut state, &mut rng(), Command::Increment { amount: 1 });
        assert_eq!(result, Err(CommandError::Overflow));
        assert_eq!(state.value, i64::MAX);
    }

    #[test]
    fn decrement_overflow_is_rejected_not_panicking() {
        let mut state = State { value: i64::MIN };
        let result = apply_command(&mut state, &mut rng(), Command::Decrement { amount: 1 });
        assert_eq!(result, Err(CommandError::Overflow));
        assert_eq!(state.value, i64::MIN);
    }
}
