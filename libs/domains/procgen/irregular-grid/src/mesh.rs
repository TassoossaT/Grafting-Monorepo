//! The two mesh forms the pipeline moves between, and the handful of
//! index-level helpers every stage shares.

/// A point on the grid plane.
///
/// Plane coordinates, not world ones: the caller decides that `y` here is
/// world Z, and supplies height separately. Nothing in this crate knows about
/// elevation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

/// What the pipeline needs of a point to quadrangulate and weld a mesh of
/// them: nothing about which space it lives in. The plane's [`Vec2`] is one;
/// a surface's own 3D point is another, so the same pairing and ortho steps
/// lay irregular cells over ground that is no height over any plane.
pub trait GridPoint: Copy {
    /// The average of `points`, summed in order -- for the plane, exactly the
    /// arithmetic the pipeline always did, so ground already laid comes out
    /// bit for bit the same.
    fn mean(points: &[Self]) -> Self;
    /// The cell `epsilon` wide this point falls in, for welding coincident
    /// points into one.
    fn weld_key(&self, epsilon: f64) -> [i64; 3];
}

impl GridPoint for Vec2 {
    fn mean(points: &[Self]) -> Self {
        crate::geometry::centroid_of(points)
    }

    fn weld_key(&self, epsilon: f64) -> [i64; 3] {
        [(self.x / epsilon).round() as i64, (self.y / epsilon).round() as i64, 0]
    }
}

/// A face as indices into a vertex list, in cyclic order.
pub type Face = Vec<usize>;

/// A face known to have exactly four vertices.
pub type Quad = [usize; 4];

/// A mesh of arbitrary faces -- the intermediate form before quadrangulation.
#[derive(Debug, Clone)]
pub struct FaceMesh<P = Vec2> {
    pub vertices: Vec<P>,
    pub faces: Vec<Face>,
}

/// The finished all-quad grid.
#[derive(Debug, Clone)]
pub struct QuadMesh {
    pub vertices: Vec<Vec2>,
    pub quads: Vec<Quad>,
}

/// A face's edges as ordered index pairs, wrapping at the end.
pub fn edges_of(face: &[usize]) -> Vec<(usize, usize)> {
    face.iter()
        .enumerate()
        .map(|(position, &vertex)| {
            let next = face[(position + 1) % face.len()];
            (vertex, next)
        })
        .collect()
}

/// Undirected, so the two faces sharing an edge agree on its name.
pub fn edge_key(a: usize, b: usize) -> (usize, usize) {
    if a < b { (a, b) } else { (b, a) }
}
