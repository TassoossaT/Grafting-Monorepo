//! Carving into the ground and filling it in, in three dimensions, as an
//! edit of the ground's own mesh.
//!
//! The ground is its mesh. An edit hands in the faces it reaches and the
//! ground round them; [`edit_surface`] asks that mesh where solid is, carves
//! or fills the edit's shapes, reads the new surface, stitches it to the ring
//! of ground left standing and lays it with the irregular quad grid's own
//! steps -- pairing, ortho, relaxation -- over the surface instead of the
//! plane. What comes back is ground like any other: the ring's very nodes,
//! new nodes inside it, irregular cells.
//!
//! - [`field`]: the shapes, and how they combine with solid.
//! - [`mesh_distance`]: signed distance to the ground's faces.
//! - [`volume`]: solid after the edit; reading its surface off a grid.
//! - [`trimesh`]: borders, the stitch to the ring, the isotropic remesh.
//! - [`edit`]: the edit end to end.
//! - [`regenerate`]: a patch laid again on its own surface, round structures.

pub mod edit;
pub mod field;
pub mod mesh_distance;
pub mod regenerate;
pub mod trimesh;
pub mod vector;
pub mod volume;

pub use edit::{EditedSurface, Faces, SurfaceEdit, edit_surface};
pub use field::{Effect, Shape, smooth_min};
pub use regenerate::{GivenPoint, Landing, Origin, RegeneratedSurface, Regeneration, regenerate_surface};
pub use vector::Vec3;
