//! Generational handles for `Job`/`Buffer` (master source S11.3: `0` is
//! invalid; index+generation prevent trivial use-after-free; duplicate
//! release returns an error).
//!
//! `Engine` itself is **not** tracked here -- it's a `wasm-bindgen` class
//! instance (`engine.rs`), which is the idiomatic Wasm-side handle and
//! where per-object panic poisoning naturally applies (see `engine.rs`'s
//! module docs for the empirical finding this is based on). This table
//! only needs one kind (`Job` and `Buffer` each get their own table
//! instance), so unlike `isekai-capi-bridge`'s `handle::HandleTable`
//! there is no kind tag to pack -- callers never mix a `Job` handle from
//! one engine with a `Buffer` handle from another table by construction
//! (each `WasmEngine` owns its own two tables).
//!
//! This is intentionally near-identical to
//! `libs/isekai/capi-bridge/src/handle.rs`'s generic logic, duplicated
//! rather than shared -- ~150 lines, mechanical, low-risk to duplicate
//! once. A good candidate for extraction into a shared crate once a third
//! consumer needs the same table, not done preemptively.

struct Slot<T> {
    generation: u32,
    value: Option<T>,
}

pub struct HandleTable<T> {
    slots: Vec<Slot<T>>,
}

impl<T> HandleTable<T> {
    pub fn new() -> Self {
        HandleTable { slots: Vec::new() }
    }

    /// Generation starts at 1 so the packed handle is never 0.
    pub fn insert(&mut self, value: T) -> u64 {
        for (index, slot) in self.slots.iter_mut().enumerate() {
            if slot.value.is_none() {
                slot.value = Some(value);
                return pack(index as u32, slot.generation);
            }
        }
        self.slots.push(Slot {
            generation: 1,
            value: Some(value),
        });
        pack((self.slots.len() - 1) as u32, 1)
    }

    pub fn get(&self, raw: u64) -> Option<&T> {
        let (index, generation) = unpack(raw)?;
        self.slots.get(index as usize).and_then(|slot| {
            if slot.generation == generation {
                slot.value.as_ref()
            } else {
                None
            }
        })
    }

    pub fn get_mut(&mut self, raw: u64) -> Option<&mut T> {
        let (index, generation) = unpack(raw)?;
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
        let (index, generation) = unpack(raw)?;
        let slot = self.slots.get_mut(index as usize)?;
        if slot.generation != generation {
            return None;
        }
        let value = slot.value.take()?;
        slot.generation = slot.generation.wrapping_add(1).max(1);
        Some(value)
    }

    /// Occupied slots right now -- see
    /// `capi-bridge/src/handle.rs::HandleTable::len`'s doc comment for
    /// why this alone isn't sufficient "no leak" evidence (D-009); pair
    /// with [`Self::slot_count`].
    pub fn len(&self) -> usize {
        self.slots.iter().filter(|slot| slot.value.is_some()).count()
    }

    /// Total slots ever allocated (this table's own high-water mark) --
    /// catches "arena growth" (D-009, S19.5) that a flat [`Self::len`]
    /// alone would miss.
    pub fn slot_count(&self) -> usize {
        self.slots.len()
    }
}

impl<T> Default for HandleTable<T> {
    fn default() -> Self {
        Self::new()
    }
}

fn pack(index: u32, generation: u32) -> u64 {
    ((generation as u64) << 32) | index as u64
}

fn unpack(raw: u64) -> Option<(u32, u32)> {
    if raw == 0 {
        return None;
    }
    Some((raw as u32, (raw >> 32) as u32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_is_always_invalid() {
        let table: HandleTable<u32> = HandleTable::new();
        assert_eq!(table.get(0), None);
    }

    #[test]
    fn insert_then_get_succeeds() {
        let mut table = HandleTable::new();
        let handle = table.insert("hello");
        assert_eq!(table.get(handle), Some(&"hello"));
    }

    #[test]
    fn remove_then_get_fails() {
        let mut table = HandleTable::new();
        let handle = table.insert(42u32);
        assert_eq!(table.remove(handle), Some(42));
        assert_eq!(table.get(handle), None);
    }

    #[test]
    fn double_remove_fails() {
        let mut table = HandleTable::new();
        let handle = table.insert(42u32);
        assert_eq!(table.remove(handle), Some(42));
        assert_eq!(table.remove(handle), None);
    }

    #[test]
    fn stale_handle_rejected_after_slot_reuse() {
        let mut table = HandleTable::new();
        let first = table.insert("first");
        table.remove(first).unwrap();
        let second = table.insert("second");

        assert_ne!(first, second, "reused slot must get a new generation");
        assert_eq!(table.get(first), None);
        assert_eq!(table.get(second), Some(&"second"));
    }
}
