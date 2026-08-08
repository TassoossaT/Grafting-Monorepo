//! Modules and the sockets that decide what may sit next to what.
//!
//! The socket idea is what keeps the tileset from becoming a rule per pair of
//! meshes: a module declares which connector it exposes on each face, once,
//! and compatibility is a relation between connectors. Adding a mesh means
//! declaring its sockets, not relating it to every existing mesh.

use crate::rotation::{ModuleOrigin, Rotation};

/// Index of a module within a [`Tileset`].
pub type ModuleId = usize;

/// Index of a socket -- a connector shape two faces must share to meet.
pub type SocketId = usize;

/// One placeable thing: a mesh, a tile, a marker. This crate never looks
/// inside it; `name` exists so callers can map a result back to their asset.
#[derive(Debug, Clone, PartialEq)]
pub struct Module {
    /// Caller-facing identity. Not interpreted here.
    pub name: String,
    /// The socket exposed on each face, indexed the same way the graph's
    /// faces are.
    pub sockets: Vec<SocketId>,
    /// Relative likelihood. Must be positive; higher is more frequent.
    pub weight: f32,
}

/// The modules available, plus which sockets may meet.
#[derive(Debug, Clone, Default)]
pub struct Tileset {
    modules: Vec<Module>,
    faces_per_cell: usize,
    compatible: Vec<(SocketId, SocketId)>,
    origins: Vec<ModuleOrigin>,
}

/// Why a tileset could not be built.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TilesetError {
    /// No modules were supplied.
    Empty,
    /// A module declared a different number of faces than the rest.
    FaceCountMismatch { module: ModuleId, declared: usize, expected: usize },
    /// A module's weight was zero, negative, or not a number.
    InvalidWeight { module: ModuleId },
}

impl core::fmt::Display for TilesetError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Empty => write!(f, "a tileset needs at least one module"),
            Self::FaceCountMismatch { module, declared, expected } => write!(
                f,
                "module {module} declares {declared} faces; every module must declare {expected}",
            ),
            Self::InvalidWeight { module } => {
                write!(f, "module {module} has a weight that is not positive and finite")
            }
        }
    }
}

impl Tileset {
    /// Builds a tileset. Socket compatibility is symmetric: listing `(a, b)`
    /// also permits `(b, a)`, since a shared face is one face.
    pub fn new(
        modules: Vec<Module>,
        compatible: impl IntoIterator<Item = (SocketId, SocketId)>,
    ) -> Result<Self, TilesetError> {
        let expected = modules.first().ok_or(TilesetError::Empty)?.sockets.len();
        for (index, module) in modules.iter().enumerate() {
            if module.sockets.len() != expected {
                return Err(TilesetError::FaceCountMismatch {
                    module: index,
                    declared: module.sockets.len(),
                    expected,
                });
            }
            if !module.weight.is_finite() || module.weight <= 0.0 {
                return Err(TilesetError::InvalidWeight { module: index });
            }
        }
        let origins =
            (0..modules.len()).map(|source| ModuleOrigin { source, turns: 0 }).collect();
        Ok(Self {
            modules,
            faces_per_cell: expected,
            compatible: compatible.into_iter().collect(),
            origins,
        })
    }

    /// Builds a tileset from modules authored in one orientation, generating
    /// the others.
    ///
    /// See [`crate::rotation`] for what a rotation means here and why symmetric
    /// modules do not produce duplicates. Validation happens after expansion,
    /// so a face count is checked against the modules that will actually be
    /// solved with.
    pub fn rotated(
        modules: Vec<Module>,
        compatible: impl IntoIterator<Item = (SocketId, SocketId)>,
        rotation: &Rotation,
    ) -> Result<Self, TilesetError> {
        let (expanded, origins) = crate::rotation::expand(&modules, rotation);
        let mut tileset = Self::new(expanded, compatible)?;
        tileset.origins = origins;
        Ok(tileset)
    }

    /// The modules, in the order given.
    pub fn modules(&self) -> &[Module] {
        &self.modules
    }

    /// Which authored module a [`ModuleId`] came from, and how far it turned.
    ///
    /// A caller that generated orientations needs this to map a result back to
    /// its asset: the mesh comes from `source`, spun by `turns`.
    pub fn origin(&self, module: ModuleId) -> Option<ModuleOrigin> {
        self.origins.get(module).copied()
    }

    /// How many faces each module declares.
    pub fn faces_per_cell(&self) -> usize {
        self.faces_per_cell
    }

    /// Whether two sockets may meet, in either order.
    pub fn sockets_meet(&self, left: SocketId, right: SocketId) -> bool {
        self.compatible
            .iter()
            .any(|&(a, b)| (a == left && b == right) || (a == right && b == left))
    }

    /// Whether `left` on `left_face` may sit against `right` on `right_face`.
    pub fn modules_meet(
        &self,
        left: ModuleId,
        left_face: usize,
        right: ModuleId,
        right_face: usize,
    ) -> bool {
        let (Some(left), Some(right)) = (self.modules.get(left), self.modules.get(right)) else {
            return false;
        };
        let (Some(&a), Some(&b)) = (left.sockets.get(left_face), right.sockets.get(right_face))
        else {
            return false;
        };
        self.sockets_meet(a, b)
    }
}
