//! The seeded 0..1 source the whole pipeline draws from.

/// Deterministic 0..1 generator (mulberry32).
///
/// Determinism is not a convenience here. The map is replicated authoritative
/// state, so two hosts generating "the same" grid must produce identical
/// vertices, and a grid that depends on ambient randomness cannot be
/// regenerated from a saved seed.
///
/// **Bit-for-bit identical to the TypeScript original it replaces**, and
/// deliberately so: a grid already committed to a saved table has to keep
/// generating the same way after the port, or every existing map shifts under
/// its own terrain. `Math.imul` is a wrapping 32-bit multiply, `>>> 0` is a
/// reinterpretation as `u32`, and the one float addition in the mix stays
/// exact because the sum of two 32-bit integers is representable in `f64` --
/// so `wrapping_add` agrees with it on every bit that survives.
pub struct Random {
    state: u32,
}

impl Random {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    /// The next value in `[0, 1)`.
    pub fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }

    /// Fisher-Yates, drawing in the same order as the original so a given
    /// seed shuffles a given list identically.
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        if items.is_empty() {
            return;
        }
        for i in (1..items.len()).rev() {
            let j = (self.next() * (i as f64 + 1.0)).floor() as usize;
            items.swap(i, j.min(i));
        }
    }

    /// `0..length` shuffled.
    pub fn shuffled_indices(&mut self, length: usize) -> Vec<usize> {
        let mut indices: Vec<usize> = (0..length).collect();
        self.shuffle(&mut indices);
        indices
    }
}
