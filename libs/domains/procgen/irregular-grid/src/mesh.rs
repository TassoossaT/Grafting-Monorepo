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

/// A face as indices into a vertex list, in cyclic order.
pub type Face = Vec<usize>;

/// A face known to have exactly four vertices.
pub type Quad = [usize; 4];

/// A mesh of arbitrary faces -- the intermediate form before quadrangulation.
#[derive(Debug, Clone)]
pub struct FaceMesh {
    pub vertices: Vec<Vec2>,
    pub faces: Vec<Face>,
}

/// The finished all-quad grid.
#[derive(Debug, Clone)]
pub struct QuadMesh {
    pub vertices: Vec<Vec2>,
    pub quads: Vec<Quad>,
}

pub fn centroid_of(points: &[Vec2]) -> Vec2 {
    let mut x = 0.0;
    let mut y = 0.0;
    for point in points {
        x += point.x;
        y += point.y;
    }
    let count = points.len() as f64;
    Vec2::new(x / count, y / count)
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
