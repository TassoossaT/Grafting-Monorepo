//! Client-facing intent, validated before it can affect state (master
//! source S15.2: this `Command` is the core-internal validated type, kept
//! distinct from the network-facing `ClientCommand`/`AcceptedCommand`
//! pair -- those belong to the multiplayer host, Phase 6/Epic H, not
//! modeled here).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Increment { amount: i64 },
    Decrement { amount: i64 },
    Reset,
    RollAndAdd { min: i64, max: i64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandError {
    /// `Increment`/`Decrement` amount was zero or negative.
    NonPositiveAmount,
    /// `RollAndAdd` had `min >= max`.
    InvalidRange,
    /// Applying the command would overflow `i64`. Only ever produced by
    /// `apply_command` (`apply.rs`), not by [`Command::validate_structure`]:
    /// for `RollAndAdd` the exact delta isn't known until the RNG has
    /// actually rolled it, so overflow can't be checked structurally.
    Overflow,
}

impl Command {
    /// Structural validation only: whether the command's own fields are
    /// well-formed, independent of current state or the RNG stream.
    pub fn validate_structure(&self) -> Result<(), CommandError> {
        match *self {
            Command::Increment { amount } | Command::Decrement { amount } => {
                if amount <= 0 {
                    return Err(CommandError::NonPositiveAmount);
                }
            }
            Command::Reset => {}
            Command::RollAndAdd { min, max } => {
                if min >= max {
                    return Err(CommandError::InvalidRange);
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_commands_pass_structural_validation() {
        assert_eq!(Command::Increment { amount: 1 }.validate_structure(), Ok(()));
        assert_eq!(Command::Decrement { amount: 1 }.validate_structure(), Ok(()));
        assert_eq!(Command::Reset.validate_structure(), Ok(()));
        assert_eq!(
            Command::RollAndAdd { min: 1, max: 6 }.validate_structure(),
            Ok(())
        );
    }

    #[test]
    fn non_positive_amounts_are_rejected() {
        assert_eq!(
            Command::Increment { amount: 0 }.validate_structure(),
            Err(CommandError::NonPositiveAmount)
        );
        assert_eq!(
            Command::Increment { amount: -5 }.validate_structure(),
            Err(CommandError::NonPositiveAmount)
        );
        assert_eq!(
            Command::Decrement { amount: -1 }.validate_structure(),
            Err(CommandError::NonPositiveAmount)
        );
    }

    #[test]
    fn degenerate_roll_ranges_are_rejected() {
        assert_eq!(
            Command::RollAndAdd { min: 5, max: 5 }.validate_structure(),
            Err(CommandError::InvalidRange)
        );
        assert_eq!(
            Command::RollAndAdd { min: 10, max: 1 }.validate_structure(),
            Err(CommandError::InvalidRange)
        );
    }
}
