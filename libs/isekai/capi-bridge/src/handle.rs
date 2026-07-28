//! Generational, kind-tagged opaque handles (master source S11.3: `0` is
//! invalid; index+generation prevent trivial use-after-free; "the
//! logical type is validated"; duplicate release returns an error).
//!
//! Packed into one `u64`: `[8 bits kind][24 bits generation][32 bits index]`.
//! The kind tag isn't decorative: two independently-generationed tables
//! (one per handle kind) could otherwise produce the *same* raw `u64` for
//! an `Engine` and a `Job` handle, so passing one where the other is
//! expected would silently misvalidate instead of failing cleanly. The
//! tag prevents that structurally.
//!
//! `ProblemHandle` (S11.3's fourth kind) is intentionally not modeled --
//! same call as Epic E's `ProblemHandle` deferral: no resident GPU/solver
//! state exists yet to hand a handle to.

const INDEX_BITS: u32 = 32;
const GENERATION_BITS: u32 = 24;
const INDEX_MASK: u64 = (1 << INDEX_BITS) - 1;
const GENERATION_MASK: u64 = (1 << GENERATION_BITS) - 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum HandleKind {
    Engine = 1,
    Job = 2,
    Buffer = 3,
}

impl HandleKind {
    fn from_tag(tag: u8) -> Option<Self> {
        match tag {
            1 => Some(HandleKind::Engine),
            2 => Some(HandleKind::Job),
            3 => Some(HandleKind::Buffer),
            _ => None,
        }
    }
}

fn pack(kind: HandleKind, index: u32, generation: u32) -> u64 {
    debug_assert!(generation & !(GENERATION_MASK as u32) == 0);
    ((kind as u64) << (INDEX_BITS + GENERATION_BITS))
        | (((generation as u64) & GENERATION_MASK) << INDEX_BITS)
        | (index as u64 & INDEX_MASK)
}

fn unpack(raw: u64) -> Option<(HandleKind, u32, u32)> {
    if raw == 0 {
        return None;
    }
    let kind = HandleKind::from_tag((raw >> (INDEX_BITS + GENERATION_BITS)) as u8)?;
    let generation = ((raw >> INDEX_BITS) & GENERATION_MASK) as u32;
    let index = (raw & INDEX_MASK) as u32;
    Some((kind, index, generation))
}

struct Slot<T> {
    generation: u32,
    value: Option<T>,
}

/// A generational registry for exactly one [`HandleKind`]. `Engine`/
/// `Job`/`Buffer` registries are each a separate `HandleTable`.
pub struct HandleTable<T> {
    kind: HandleKind,
    slots: Vec<Slot<T>>,
}

impl<T> HandleTable<T> {
    pub fn new(kind: HandleKind) -> Self {
        HandleTable {
            kind,
            slots: Vec::new(),
        }
    }

    /// Generation starts at 1 so the packed handle is never 0.
    pub fn insert(&mut self, value: T) -> u64 {
        for (index, slot) in self.slots.iter_mut().enumerate() {
            if slot.value.is_none() {
                slot.value = Some(value);
                return pack(self.kind, index as u32, slot.generation);
            }
        }
        self.slots.push(Slot {
            generation: 1,
            value: Some(value),
        });
        pack(self.kind, (self.slots.len() - 1) as u32, 1)
    }

    pub fn get(&self, raw: u64) -> Option<&T> {
        let (kind, index, generation) = unpack(raw)?;
        if kind != self.kind {
            return None;
        }
        self.slots.get(index as usize).and_then(|slot| {
            if slot.generation == generation {
                slot.value.as_ref()
            } else {
                None
            }
        })
    }

    pub fn get_mut(&mut self, raw: u64) -> Option<&mut T> {
        let (kind, index, generation) = unpack(raw)?;
        if kind != self.kind {
            return None;
        }
        self.slots.get_mut(index as usize).and_then(|slot| {
            if slot.generation == generation {
                slot.value.as_mut()
            } else {
                None
            }
        })
    }

    /// Bumping the generation on removal means a stale (already-released)
    /// handle is rejected even after the slot is reused (S11.3).
    pub fn remove(&mut self, raw: u64) -> Option<T> {
        let (kind, index, generation) = unpack(raw)?;
        if kind != self.kind {
            return None;
        }
        let slot = self.slots.get_mut(index as usize)?;
        if slot.generation != generation {
            return None;
        }
        let value = slot.value.take()?;
        slot.generation = slot.generation.wrapping_add(1).max(1);
        Some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_is_always_invalid() {
        assert_eq!(unpack(0), None);
    }

    #[test]
    fn pack_unpack_round_trips() {
        let raw = pack(HandleKind::Job, 7, 3);
        assert_eq!(unpack(raw), Some((HandleKind::Job, 7, 3)));
    }

    #[test]
    fn insert_then_get_succeeds() {
        let mut table = HandleTable::new(HandleKind::Engine);
        let handle = table.insert("hello");
        assert_eq!(table.get(handle), Some(&"hello"));
    }

    #[test]
    fn wrong_kind_is_rejected_not_misvalidated() {
        let mut engines = HandleTable::new(HandleKind::Engine);
        let engine_handle = engines.insert(1u32);

        let jobs: HandleTable<u32> = HandleTable::new(HandleKind::Job);
        // Same raw index/generation, different kind -- must not validate.
        assert_eq!(jobs.get(engine_handle), None);
    }

    #[test]
    fn remove_then_get_fails() {
        let mut table = HandleTable::new(HandleKind::Buffer);
        let handle = table.insert(42u32);
        assert_eq!(table.remove(handle), Some(42));
        assert_eq!(table.get(handle), None);
    }

    #[test]
    fn double_remove_fails() {
        let mut table = HandleTable::new(HandleKind::Buffer);
        let handle = table.insert(42u32);
        assert_eq!(table.remove(handle), Some(42));
        assert_eq!(table.remove(handle), None);
    }

    #[test]
    fn stale_handle_rejected_after_slot_reuse() {
        let mut table = HandleTable::new(HandleKind::Job);
        let first = table.insert("first");
        table.remove(first).unwrap();
        let second = table.insert("second");

        assert_ne!(first, second, "reused slot must get a new generation");
        assert_eq!(table.get(first), None);
        assert_eq!(table.get(second), Some(&"second"));
    }

    #[test]
    fn unknown_raw_handle_is_rejected() {
        let table: HandleTable<u32> = HandleTable::new(HandleKind::Engine);
        assert_eq!(table.get(pack(HandleKind::Engine, 999, 1)), None);
    }
}
