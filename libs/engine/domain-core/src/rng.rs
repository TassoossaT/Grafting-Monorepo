//! Controlled RNG (master source S4.2's "controlled RNG" domain-core
//! responsibility).
//!
//! Wraps `ChaCha8Rng` rather than `rand::rngs::StdRng` deliberately:
//! `StdRng`'s algorithm is *not* guaranteed stable across `rand`
//! releases, while ChaCha8's is fixed by construction and by the
//! `rand_chacha` crate's own stability guarantees. DEC-044 requires the
//! RNG algorithm to be fixed per build for same-platform replay
//! determinism -- an unstable-algorithm RNG would silently violate that.

use rand_chacha::ChaCha8Rng;
use rand_chacha::rand_core::{Rng, SeedableRng};

pub struct DeterministicRng {
    inner: ChaCha8Rng,
}

impl DeterministicRng {
    pub fn from_seed(seed: [u8; 32]) -> Self {
        DeterministicRng {
            inner: ChaCha8Rng::from_seed(seed),
        }
    }

    /// Restores an RNG that has already consumed `word_pos` words from the
    /// stream started at `seed` -- used when resuming from a
    /// [`crate::snapshot::Snapshot`] taken mid-sequence.
    pub fn from_seed_and_position(seed: [u8; 32], word_pos: u64) -> Self {
        let mut rng = ChaCha8Rng::from_seed(seed);
        rng.set_word_pos(word_pos as u128);
        DeterministicRng { inner: rng }
    }

    /// Words consumed from the stream so far -- recorded in
    /// [`crate::snapshot::Snapshot`] to allow exact resumption.
    pub fn word_pos(&self) -> u64 {
        self.inner.get_word_pos() as u64
    }

    /// Inclusive-exclusive range `[low, high)`, panics if `low >= high`.
    /// Callers (see `command.rs`) validate the range before calling this.
    pub fn gen_range_i64(&mut self, low: i64, high: i64) -> i64 {
        debug_assert!(low < high);
        let span = (high - low) as u64;
        low + (self.inner.next_u64() % span) as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_produces_same_sequence() {
        let mut a = DeterministicRng::from_seed([7; 32]);
        let mut b = DeterministicRng::from_seed([7; 32]);
        for _ in 0..10 {
            assert_eq!(a.gen_range_i64(0, 1000), b.gen_range_i64(0, 1000));
        }
    }

    #[test]
    fn resuming_from_a_word_position_continues_the_same_stream() {
        let seed = [3; 32];
        let mut reference = DeterministicRng::from_seed(seed);
        let first = reference.gen_range_i64(0, 1_000_000);
        let pos_after_first = reference.word_pos();
        let expected_second = reference.gen_range_i64(0, 1_000_000);

        let mut resumed = DeterministicRng::from_seed_and_position(seed, pos_after_first);
        let actual_second = resumed.gen_range_i64(0, 1_000_000);

        assert_ne!(first, 0); // sanity: rng actually produced something
        assert_eq!(actual_second, expected_second);
    }
}
