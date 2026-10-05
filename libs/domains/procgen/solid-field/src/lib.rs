//! Solid ground that can hold caves, tunnels and bridges, laid by a planar
//! mesher.
//!
//! ```text
//! field (height + shapes) -> split into pieces -> shared borders -> lay each piece
//! ```
//!
//! - [`field`]: where there is solid. A height over the plane plus shapes that
//!   carve or fill it, combined on demand -- no voxel grid is the truth.
//! - [`pieces`]: the surface cut into stretches that are each a height over a
//!   plane of their own.
//! - [`seams`]: the borders between them, laid once and shared.
//! - [`lay`]: each piece laid by the irregular quad grid in its own plane and
//!   lifted back onto the surface.
//!
//! With no shape anywhere the surface is one piece facing up -- the ground as
//! it was always laid.

pub mod field;
pub mod lay;
pub mod pieces;
pub mod seams;
pub mod surface;
pub mod vector;

pub use field::{Effect, HeightGrid, HeightSource, Shape, SolidField, smooth_min};
pub use lay::{BorderSplit, LaidGround, LaidPiece, lay_ground, lay_piece};
pub use pieces::{Facing, Piece, PieceKey, Region, Split, SplitOptions, split};
pub use seams::{Seams, seams};
pub use surface::{ShapedSurface, shaped_surface};
pub use vector::Vec3;
