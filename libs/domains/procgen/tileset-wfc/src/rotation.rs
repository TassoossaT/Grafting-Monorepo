//! Turning one authored module into the set of its distinct orientations.
//!
//! Without this a tileset has to spell out every orientation by hand: an
//! asymmetric piece becomes four near-identical entries whose sockets must stay
//! in step, and the authoring cost is what makes people reach for a smaller,
//! worse tileset. Generating the orientations removes that cost and removes the
//! class of bug where one hand-written variant has a socket wrong.
//!
//! # What a rotation is here
//!
//! Not a transform of geometry -- this crate never sees geometry. A rotation is
//! a permutation of *face indices*, given as a cycle. Rotating a module by one
//! turn moves the socket on `cycle[i]` to `cycle[i + 1]`; faces outside the
//! cycle keep their socket. That is what makes it usable on an irregular grid,
//! where a cell's lateral faces are local slots that rotate among themselves
//! while its up and down faces do not rotate at all.
//!
//! # Symmetry is detected, not declared
//!
//! A module whose sockets are unchanged by a turn produces the same variant
//! twice, and the duplicate is dropped. So flat ground yields one variant and a
//! corner piece yields four, without either being annotated. The caller's
//! `weight` is the weight of the *module*, and is divided across the variants
//! it produced, so making a piece asymmetric does not silently make it four
//! times as common.

use crate::tileset::{Module, ModuleId, SocketId};
use crate::graph::FaceId;

/// A cyclic permutation of face indices.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Rotation {
    cycle: Vec<FaceId>,
}

/// Which authored module a generated variant came from, and how far it turned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModuleOrigin {
    /// Index of the module as the caller supplied it.
    pub source: usize,
    /// How many turns were applied. `0` is the module as authored.
    pub turns: usize,
}

/// Why a rotation could not be built.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RotationError {
    /// The same face appeared twice in the cycle, which is not a permutation.
    RepeatedFace { face: FaceId },
}

impl core::fmt::Display for RotationError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::RepeatedFace { face } => {
                write!(f, "face {face} appears more than once in the rotation cycle")
            }
        }
    }
}

impl Rotation {
    /// The identity: every module keeps exactly the orientation it was given.
    pub fn none() -> Self {
        Self { cycle: Vec::new() }
    }

    /// A rotation that carries the socket on each listed face to the next
    /// listed face, wrapping at the end. Faces not listed are left alone.
    pub fn cycle(faces: impl IntoIterator<Item = FaceId>) -> Result<Self, RotationError> {
        let cycle: Vec<FaceId> = faces.into_iter().collect();
        for (index, face) in cycle.iter().enumerate() {
            if cycle[index + 1..].contains(face) {
                return Err(RotationError::RepeatedFace { face: *face });
            }
        }
        Ok(Self { cycle })
    }

    /// How many turns bring a module back to itself. `1` for the identity.
    pub fn order(&self) -> usize {
        self.cycle.len().max(1)
    }

    /// The faces taking part, in cycle order.
    pub fn faces(&self) -> &[FaceId] {
        &self.cycle
    }

    /// Applies `turns` turns to a socket list.
    ///
    /// Returns `None` if a face in the cycle is outside `sockets`, rather than
    /// silently producing a module with the wrong sockets.
    pub fn apply(&self, sockets: &[SocketId], turns: usize) -> Option<Vec<SocketId>> {
        let mut rotated = sockets.to_vec();
        let order = self.cycle.len();
        if order == 0 {
            return Some(rotated);
        }
        for (index, &from) in self.cycle.iter().enumerate() {
            let to = self.cycle[(index + turns) % order];
            if from >= sockets.len() || to >= sockets.len() {
                return None;
            }
            rotated[to] = sockets[from];
        }
        Some(rotated)
    }
}

/// Expands each module into its distinct orientations.
///
/// The returned modules are in a stable order -- source module by source
/// module, turns ascending -- so a given input always yields the same
/// [`ModuleId`]s, which is what lets a seed reproduce a map.
///
/// Names are suffixed with `@<turns>` only for variants past the first, so an
/// unrotated or symmetric module keeps the name the caller gave it.
pub fn expand(modules: &[Module], rotation: &Rotation) -> (Vec<Module>, Vec<ModuleOrigin>) {
    let mut expanded = Vec::new();
    let mut origins = Vec::new();

    for (source, module) in modules.iter().enumerate() {
        let first = expanded.len();
        for turns in 0..rotation.order() {
            let Some(sockets) = rotation.apply(&module.sockets, turns) else {
                continue;
            };
            if expanded[first..].iter().any(|other: &Module| other.sockets == sockets) {
                continue;
            }
            expanded.push(Module {
                name: if turns == 0 {
                    module.name.clone()
                } else {
                    format!("{}@{turns}", module.name)
                },
                sockets,
                weight: module.weight,
            });
            origins.push(ModuleOrigin { source, turns });
        }

        // The caller's weight is the weight of the module, so the variants it
        // produced share it. Otherwise an asymmetric piece would be four times
        // as likely as a symmetric one purely because it rotates.
        let produced = expanded.len() - first;
        if produced > 1 {
            for variant in &mut expanded[first..] {
                variant.weight /= produced as f32;
            }
        }
    }

    (expanded, origins)
}

/// Where a generated module came from, or `None` for a tileset built without
/// rotation.
pub fn origin_of(origins: &[ModuleOrigin], module: ModuleId) -> Option<ModuleOrigin> {
    origins.get(module).copied()
}
