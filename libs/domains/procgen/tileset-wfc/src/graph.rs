//! The cell graph: what is adjacent to what, and across which face.
//!
//! Deliberately not a grid. Cells are opaque indices and adjacency is an
//! explicit list of links, because the grids this must serve are irregular --
//! a quad grid relaxed off the lattice has interior vertices of valence other
//! than four, which no fixed set of compass directions can label consistently.
//! Encoding adjacency per link rather than per direction sidesteps that
//! entirely.

/// Index of a cell. Meaningful only to the caller that built the graph.
pub type CellId = usize;

/// Which face of a cell a link leaves by.
///
/// A face index is local to its cell: face 2 of one cell has no relation to
/// face 2 of another. This is what lets an irregular grid be described at all.
pub type FaceId = usize;

/// One undirected adjacency, recorded once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Link {
    /// The lower-indexed cell.
    pub from: CellId,
    /// The face of `from` this link leaves by.
    pub from_face: FaceId,
    /// The higher-indexed cell.
    pub to: CellId,
    /// The face of `to` this link arrives at.
    pub to_face: FaceId,
}

/// Cells and the links between them.
#[derive(Debug, Clone, Default)]
pub struct CellGraph {
    cell_count: usize,
    faces_per_cell: usize,
    links: Vec<Link>,
}

/// Why a graph could not be built.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphError {
    /// A link referred to a cell outside the graph.
    UnknownCell { cell: CellId, cell_count: usize },
    /// A link referred to a face the cells do not have.
    UnknownFace { face: FaceId, faces_per_cell: usize },
    /// A cell was linked to itself.
    SelfLink { cell: CellId },
    /// The same face of the same cell was linked twice.
    DuplicateFace { cell: CellId, face: FaceId },
}

impl core::fmt::Display for GraphError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::UnknownCell { cell, cell_count } => {
                write!(f, "link refers to cell {cell}, but the graph has {cell_count} cells")
            }
            Self::UnknownFace { face, faces_per_cell } => {
                write!(f, "link refers to face {face}, but cells have {faces_per_cell} faces")
            }
            Self::SelfLink { cell } => write!(f, "cell {cell} is linked to itself"),
            Self::DuplicateFace { cell, face } => {
                write!(f, "face {face} of cell {cell} is linked more than once")
            }
        }
    }
}

impl CellGraph {
    /// Builds a graph, rejecting malformed adjacency rather than carrying it
    /// into the solver, where it would surface as an unexplained contradiction.
    pub fn new(
        cell_count: usize,
        faces_per_cell: usize,
        links: impl IntoIterator<Item = Link>,
    ) -> Result<Self, GraphError> {
        let mut taken = vec![false; cell_count * faces_per_cell];
        let mut collected = Vec::new();

        for link in links {
            for cell in [link.from, link.to] {
                if cell >= cell_count {
                    return Err(GraphError::UnknownCell { cell, cell_count });
                }
            }
            for face in [link.from_face, link.to_face] {
                if face >= faces_per_cell {
                    return Err(GraphError::UnknownFace { face, faces_per_cell });
                }
            }
            if link.from == link.to {
                return Err(GraphError::SelfLink { cell: link.from });
            }
            for (cell, face) in [(link.from, link.from_face), (link.to, link.to_face)] {
                let slot = cell * faces_per_cell + face;
                if taken[slot] {
                    return Err(GraphError::DuplicateFace { cell, face });
                }
                taken[slot] = true;
            }
            collected.push(link);
        }

        Ok(Self { cell_count, faces_per_cell, links: collected })
    }

    /// How many cells the graph holds.
    pub fn cell_count(&self) -> usize {
        self.cell_count
    }

    /// How many faces every cell has.
    pub fn faces_per_cell(&self) -> usize {
        self.faces_per_cell
    }

    /// Every adjacency, in insertion order, so downstream output is stable.
    pub fn links(&self) -> &[Link] {
        &self.links
    }
}
