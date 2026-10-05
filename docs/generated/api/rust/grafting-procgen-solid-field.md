# grafting-procgen-solid-field

### `pub const fn grafting_procgen_solid_field::vector::Vec3::new(x: f64, y: f64, z: f64) -> Self`

### `pub const fn grafting_procgen_solid_field::vector::Vec3::splat(value: f64) -> Self`

### `pub enum grafting_procgen_solid_field::Effect`

What a shape does to the solid it overlaps.

### `pub enum grafting_procgen_solid_field::Facing`

The axis a piece is a height along.

### `pub enum grafting_procgen_solid_field::field::Effect`

What a shape does to the solid it overlaps.

### `pub enum grafting_procgen_solid_field::pieces::Facing`

The axis a piece is a height along.

### `pub fn F::height(&self, x: f64, z: f64) -> f64`

### `pub fn grafting_procgen_solid_field::HeightSource::height(&self, x: f64, z: f64) -> f64`

### `pub fn grafting_procgen_solid_field::field::HeightGrid::height(&self, x: f64, z: f64) -> f64`

### `pub fn grafting_procgen_solid_field::field::HeightGrid::sample(source: &impl grafting_procgen_solid_field::field::HeightSource, origin_x: f64, origin_z: f64, spacing: f64, columns: usize, rows: usize) -> Self`

Samples `source` on the grid.

### `pub fn grafting_procgen_solid_field::field::HeightSource::height(&self, x: f64, z: f64) -> f64`

### `pub fn grafting_procgen_solid_field::field::Shape::bounds(&self, blend: f64) -> (grafting_procgen_solid_field::vector::Vec3, grafting_procgen_solid_field::vector::Vec3)`

The box the shape can change the field in, given how far the blend
between it and the ground reaches.

### `pub fn grafting_procgen_solid_field::field::Shape::distance(&self, point: grafting_procgen_solid_field::vector::Vec3) -> f64`

Signed distance to the capsule: negative inside it.

### `pub fn grafting_procgen_solid_field::field::SolidField<H>::crossing(&self, from: grafting_procgen_solid_field::vector::Vec3, direction: grafting_procgen_solid_field::vector::Vec3, length: f64, step: f64, nth: usize) -> core::option::Option<grafting_procgen_solid_field::vector::Vec3>`

The `nth` crossing (0-based) met walking from `from` along `direction`
for at most `length`, refined by bisection. Crossings alternate
air-to-solid and solid-to-air.

### `pub fn grafting_procgen_solid_field::field::SolidField<H>::crossings(&self, from: grafting_procgen_solid_field::vector::Vec3, direction: grafting_procgen_solid_field::vector::Vec3, length: f64, step: f64) -> usize`

How many times the surface is crossed walking from `from` along
`direction` for `length`.

### `pub fn grafting_procgen_solid_field::field::SolidField<H>::distance(&self, point: grafting_procgen_solid_field::vector::Vec3) -> f64`

Signed distance, negative inside solid. Shapes apply in order, so a
fill made after a carve fills it back in.

### `pub fn grafting_procgen_solid_field::field::SolidField<H>::gradient(&self, point: grafting_procgen_solid_field::vector::Vec3, step: f64) -> grafting_procgen_solid_field::vector::Vec3`

The direction out of the solid at `point`, unnormalised.

### `pub fn grafting_procgen_solid_field::field::SolidField<H>::ground_distance(&self, point: grafting_procgen_solid_field::vector::Vec3) -> f64`

The height part alone: ground as if no shape stood anywhere.

### `pub fn grafting_procgen_solid_field::field::SolidField<H>::new(ground: H) -> Self`

### `pub fn grafting_procgen_solid_field::field::SolidField<H>::project(&self, point: grafting_procgen_solid_field::vector::Vec3, step: f64) -> grafting_procgen_solid_field::vector::Vec3`

`point` moved onto the surface along the gradient, a few Newton steps.

### `pub fn grafting_procgen_solid_field::field::smooth_min(a: f64, b: f64, k: f64) -> f64`

Polynomial smooth minimum (Inigo Quilez): `min(a, b)` with the corner
rounded over a width of `k`. `k = 0` is the plain minimum.

### `pub fn grafting_procgen_solid_field::lay::lay_ground<H: grafting_procgen_solid_field::field::HeightSource>(field: &grafting_procgen_solid_field::field::SolidField<H>, region: &grafting_procgen_solid_field::pieces::Region, options: &grafting_procgen_solid_field::pieces::SplitOptions, face_side: f64, seed: u32) -> grafting_procgen_solid_field::lay::LaidGround`

The whole pipeline, end to end: split, borders at `face_side`, each piece
laid at `face_side`.

### `pub fn grafting_procgen_solid_field::lay::lay_piece<H: grafting_procgen_solid_field::field::HeightSource>(field: &grafting_procgen_solid_field::field::SolidField<H>, region: &grafting_procgen_solid_field::pieces::Region, split: &grafting_procgen_solid_field::pieces::Split, seams: &grafting_procgen_solid_field::seams::Seams, index: usize, face_side: f64, seed: u32) -> core::result::Result<grafting_procgen_solid_field::lay::LaidPiece, alloc::string::String>`

Lays piece `index` of `split` with faces `face_side` wide.

### `pub fn grafting_procgen_solid_field::lay_ground<H: grafting_procgen_solid_field::field::HeightSource>(field: &grafting_procgen_solid_field::field::SolidField<H>, region: &grafting_procgen_solid_field::pieces::Region, options: &grafting_procgen_solid_field::pieces::SplitOptions, face_side: f64, seed: u32) -> grafting_procgen_solid_field::lay::LaidGround`

The whole pipeline, end to end: split, borders at `face_side`, each piece
laid at `face_side`.

### `pub fn grafting_procgen_solid_field::lay_piece<H: grafting_procgen_solid_field::field::HeightSource>(field: &grafting_procgen_solid_field::field::SolidField<H>, region: &grafting_procgen_solid_field::pieces::Region, split: &grafting_procgen_solid_field::pieces::Split, seams: &grafting_procgen_solid_field::seams::Seams, index: usize, face_side: f64, seed: u32) -> core::result::Result<grafting_procgen_solid_field::lay::LaidPiece, alloc::string::String>`

Lays piece `index` of `split` with faces `face_side` wide.

### `pub fn grafting_procgen_solid_field::pieces::Facing::axis(self) -> grafting_procgen_solid_field::vector::Vec3`

The direction the piece looks: out of the solid.

### `pub fn grafting_procgen_solid_field::pieces::Facing::of(normal: grafting_procgen_solid_field::vector::Vec3, steepest_up: f64) -> Self`

The facing of a surface with outward `normal`. Anything whose normal
rises more than `steepest_up` (its y component, normalised) is Up.

### `pub fn grafting_procgen_solid_field::pieces::Facing::plane(self) -> (grafting_procgen_solid_field::vector::Vec3, grafting_procgen_solid_field::vector::Vec3)`

The plane the piece is laid in, as `(u, v)` with `u x v = axis`: a
ring counter-clockwise in `(u, v)` is counter-clockwise seen from
outside the solid, so faces laid there need no flipping when lifted.

### `pub fn grafting_procgen_solid_field::pieces::split<H: grafting_procgen_solid_field::field::HeightSource>(field: &grafting_procgen_solid_field::field::SolidField<H>, region: &grafting_procgen_solid_field::pieces::Region, options: &grafting_procgen_solid_field::pieces::SplitOptions) -> grafting_procgen_solid_field::pieces::Split`

Reads the surface in `region` and splits it into pieces.

### `pub fn grafting_procgen_solid_field::seams::seams<H: grafting_procgen_solid_field::field::HeightSource>(field: &grafting_procgen_solid_field::field::SolidField<H>, split: &grafting_procgen_solid_field::pieces::Split, spacing: f64, step: f64) -> grafting_procgen_solid_field::seams::Seams`

Lays every border in `split` at `spacing`.

### `pub fn grafting_procgen_solid_field::seams<H: grafting_procgen_solid_field::field::HeightSource>(field: &grafting_procgen_solid_field::field::SolidField<H>, split: &grafting_procgen_solid_field::pieces::Split, spacing: f64, step: f64) -> grafting_procgen_solid_field::seams::Seams`

Lays every border in `split` at `spacing`.

### `pub fn grafting_procgen_solid_field::smooth_min(a: f64, b: f64, k: f64) -> f64`

Polynomial smooth minimum (Inigo Quilez): `min(a, b)` with the corner
rounded over a width of `k`. `k = 0` is the plain minimum.

### `pub fn grafting_procgen_solid_field::split<H: grafting_procgen_solid_field::field::HeightSource>(field: &grafting_procgen_solid_field::field::SolidField<H>, region: &grafting_procgen_solid_field::pieces::Region, options: &grafting_procgen_solid_field::pieces::SplitOptions) -> grafting_procgen_solid_field::pieces::Split`

Reads the surface in `region` and splits it into pieces.

### `pub fn grafting_procgen_solid_field::vector::Vec3::add(self, other: Self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::cross(self, other: Self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::distance(self, other: Self) -> f64`

### `pub fn grafting_procgen_solid_field::vector::Vec3::distance_to_segment(self, a: Self, b: Self) -> f64`

### `pub fn grafting_procgen_solid_field::vector::Vec3::dot(self, other: Self) -> f64`

### `pub fn grafting_procgen_solid_field::vector::Vec3::length(self) -> f64`

### `pub fn grafting_procgen_solid_field::vector::Vec3::lerp(self, other: Self, t: f64) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::max(self, other: Self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::min(self, other: Self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::mul(self, scale: f64) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::neg(self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::normalized(self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::sub(self, other: Self) -> Self`

### `pub grafting_procgen_solid_field::Effect::Carve`

Takes solid away: a tunnel, a cave.

### `pub grafting_procgen_solid_field::Effect::Fill`

Adds solid: a bridge, a ledge.

### `pub grafting_procgen_solid_field::Facing::Down`

### `pub grafting_procgen_solid_field::Facing::East`

### `pub grafting_procgen_solid_field::Facing::North`

### `pub grafting_procgen_solid_field::Facing::South`

### `pub grafting_procgen_solid_field::Facing::Up`

### `pub grafting_procgen_solid_field::Facing::West`

### `pub grafting_procgen_solid_field::HeightGrid::columns: usize`

Samples along x.

### `pub grafting_procgen_solid_field::HeightGrid::heights: alloc::vec::Vec<f64>`

Row-major: `heights[row * columns + column]`.

### `pub grafting_procgen_solid_field::HeightGrid::origin_x: f64`

### `pub grafting_procgen_solid_field::HeightGrid::origin_z: f64`

### `pub grafting_procgen_solid_field::HeightGrid::rows: usize`

Samples along z.

### `pub grafting_procgen_solid_field::HeightGrid::spacing: f64`

### `pub grafting_procgen_solid_field::LaidGround::border_points: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

The border points every piece shares.

### `pub grafting_procgen_solid_field::LaidGround::pieces: alloc::vec::Vec<(grafting_procgen_solid_field::pieces::PieceKey, core::result::Result<grafting_procgen_solid_field::lay::LaidPiece, alloc::string::String>)>`

### `pub grafting_procgen_solid_field::LaidPiece::added_on_border: usize`

Corners the grid put on a border that the piece across it does not
have: each one a crack. Zero when the borders were laid fine enough.

### `pub grafting_procgen_solid_field::LaidPiece::border_point: alloc::vec::Vec<core::option::Option<usize>>`

Index-aligned with `vertices`: the border point a corner is, where it
is one.

### `pub grafting_procgen_solid_field::LaidPiece::faces: alloc::vec::Vec<alloc::vec::Vec<usize>>`

Counter-clockwise seen from outside the solid.

### `pub grafting_procgen_solid_field::LaidPiece::seams_kept: bool`

`false` where the grid could not keep the borders as handed over.

### `pub grafting_procgen_solid_field::LaidPiece::settled_by_projection: usize`

Corners the lift found no crossing for and settled by projection.

### `pub grafting_procgen_solid_field::LaidPiece::tangled: usize`

Crossings left in the rings after untangling.

### `pub grafting_procgen_solid_field::LaidPiece::vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::Piece::area: f64`

### `pub grafting_procgen_solid_field::Piece::key: grafting_procgen_solid_field::pieces::PieceKey`

### `pub grafting_procgen_solid_field::Piece::triangles: alloc::vec::Vec<usize>`

### `pub grafting_procgen_solid_field::PieceKey::behind: usize`

Crossings walking in against it.

### `pub grafting_procgen_solid_field::PieceKey::facing: grafting_procgen_solid_field::pieces::Facing`

### `pub grafting_procgen_solid_field::PieceKey::in_front: usize`

Crossings walking out along the facing.

### `pub grafting_procgen_solid_field::Region::cell: f64`

Spacing of the grid the split is read from. Coarser than a cave is
thin and the cave is not seen.

### `pub grafting_procgen_solid_field::Region::max: grafting_procgen_solid_field::vector::Vec3`

### `pub grafting_procgen_solid_field::Region::min: grafting_procgen_solid_field::vector::Vec3`

### `pub grafting_procgen_solid_field::Seams::points: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

Every border point, shared by every piece it borders.

### `pub grafting_procgen_solid_field::Seams::rings: alloc::vec::Vec<alloc::vec::Vec<alloc::vec::Vec<usize>>>`

Per piece, its closed rings as indices into [`Self::points`], each
walked with the piece on its left seen from outside the solid.

### `pub grafting_procgen_solid_field::Shape::effect: grafting_procgen_solid_field::field::Effect`

### `pub grafting_procgen_solid_field::Shape::path: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::Shape::radius: f64`

### `pub grafting_procgen_solid_field::SolidField::blend: f64`

Width over which a shape blends into the ground, in world units: what
rounds the lip of a tunnel mouth. `0` cuts it sharp.

### `pub grafting_procgen_solid_field::SolidField::ground: H`

### `pub grafting_procgen_solid_field::SolidField::shapes: alloc::vec::Vec<grafting_procgen_solid_field::field::Shape>`

### `pub grafting_procgen_solid_field::Split::piece_of: alloc::vec::Vec<usize>`

### `pub grafting_procgen_solid_field::Split::pieces: alloc::vec::Vec<grafting_procgen_solid_field::pieces::Piece>`

### `pub grafting_procgen_solid_field::Split::positions: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::Split::triangles: alloc::vec::Vec<[usize; 3]>`

Wound counter-clockwise seen from outside the solid.

### `pub grafting_procgen_solid_field::SplitOptions::smallest_piece: f64`

A piece smaller than this, in surface area, joins the neighbour it
shares the most border with: the split's grid makes slivers where a
facing changes, and no mesher lays a sliver well.

### `pub grafting_procgen_solid_field::SplitOptions::steepest_up: f64`

See [`Facing::of`]. `0.5` keeps slopes up to 60 degrees Up: steeper
and a border climbing it folds over in the piece's plane, and the
faces against it come out as slivers.

### `pub grafting_procgen_solid_field::Vec3::x: f64`

### `pub grafting_procgen_solid_field::Vec3::y: f64`

### `pub grafting_procgen_solid_field::Vec3::z: f64`

### `pub grafting_procgen_solid_field::field::Effect::Carve`

Takes solid away: a tunnel, a cave.

### `pub grafting_procgen_solid_field::field::Effect::Fill`

Adds solid: a bridge, a ledge.

### `pub grafting_procgen_solid_field::field::HeightGrid::columns: usize`

Samples along x.

### `pub grafting_procgen_solid_field::field::HeightGrid::heights: alloc::vec::Vec<f64>`

Row-major: `heights[row * columns + column]`.

### `pub grafting_procgen_solid_field::field::HeightGrid::origin_x: f64`

### `pub grafting_procgen_solid_field::field::HeightGrid::origin_z: f64`

### `pub grafting_procgen_solid_field::field::HeightGrid::rows: usize`

Samples along z.

### `pub grafting_procgen_solid_field::field::HeightGrid::spacing: f64`

### `pub grafting_procgen_solid_field::field::Shape::effect: grafting_procgen_solid_field::field::Effect`

### `pub grafting_procgen_solid_field::field::Shape::path: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::field::Shape::radius: f64`

### `pub grafting_procgen_solid_field::field::SolidField::blend: f64`

Width over which a shape blends into the ground, in world units: what
rounds the lip of a tunnel mouth. `0` cuts it sharp.

### `pub grafting_procgen_solid_field::field::SolidField::ground: H`

### `pub grafting_procgen_solid_field::field::SolidField::shapes: alloc::vec::Vec<grafting_procgen_solid_field::field::Shape>`

### `pub grafting_procgen_solid_field::lay::LaidGround::border_points: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

The border points every piece shares.

### `pub grafting_procgen_solid_field::lay::LaidGround::pieces: alloc::vec::Vec<(grafting_procgen_solid_field::pieces::PieceKey, core::result::Result<grafting_procgen_solid_field::lay::LaidPiece, alloc::string::String>)>`

### `pub grafting_procgen_solid_field::lay::LaidPiece::added_on_border: usize`

Corners the grid put on a border that the piece across it does not
have: each one a crack. Zero when the borders were laid fine enough.

### `pub grafting_procgen_solid_field::lay::LaidPiece::border_point: alloc::vec::Vec<core::option::Option<usize>>`

Index-aligned with `vertices`: the border point a corner is, where it
is one.

### `pub grafting_procgen_solid_field::lay::LaidPiece::faces: alloc::vec::Vec<alloc::vec::Vec<usize>>`

Counter-clockwise seen from outside the solid.

### `pub grafting_procgen_solid_field::lay::LaidPiece::seams_kept: bool`

`false` where the grid could not keep the borders as handed over.

### `pub grafting_procgen_solid_field::lay::LaidPiece::settled_by_projection: usize`

Corners the lift found no crossing for and settled by projection.

### `pub grafting_procgen_solid_field::lay::LaidPiece::tangled: usize`

Crossings left in the rings after untangling.

### `pub grafting_procgen_solid_field::lay::LaidPiece::vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::pieces::Facing::Down`

### `pub grafting_procgen_solid_field::pieces::Facing::East`

### `pub grafting_procgen_solid_field::pieces::Facing::North`

### `pub grafting_procgen_solid_field::pieces::Facing::South`

### `pub grafting_procgen_solid_field::pieces::Facing::Up`

### `pub grafting_procgen_solid_field::pieces::Facing::West`

### `pub grafting_procgen_solid_field::pieces::Piece::area: f64`

### `pub grafting_procgen_solid_field::pieces::Piece::key: grafting_procgen_solid_field::pieces::PieceKey`

### `pub grafting_procgen_solid_field::pieces::Piece::triangles: alloc::vec::Vec<usize>`

### `pub grafting_procgen_solid_field::pieces::PieceKey::behind: usize`

Crossings walking in against it.

### `pub grafting_procgen_solid_field::pieces::PieceKey::facing: grafting_procgen_solid_field::pieces::Facing`

### `pub grafting_procgen_solid_field::pieces::PieceKey::in_front: usize`

Crossings walking out along the facing.

### `pub grafting_procgen_solid_field::pieces::Region::cell: f64`

Spacing of the grid the split is read from. Coarser than a cave is
thin and the cave is not seen.

### `pub grafting_procgen_solid_field::pieces::Region::max: grafting_procgen_solid_field::vector::Vec3`

### `pub grafting_procgen_solid_field::pieces::Region::min: grafting_procgen_solid_field::vector::Vec3`

### `pub grafting_procgen_solid_field::pieces::Split::piece_of: alloc::vec::Vec<usize>`

### `pub grafting_procgen_solid_field::pieces::Split::pieces: alloc::vec::Vec<grafting_procgen_solid_field::pieces::Piece>`

### `pub grafting_procgen_solid_field::pieces::Split::positions: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::pieces::Split::triangles: alloc::vec::Vec<[usize; 3]>`

Wound counter-clockwise seen from outside the solid.

### `pub grafting_procgen_solid_field::pieces::SplitOptions::smallest_piece: f64`

A piece smaller than this, in surface area, joins the neighbour it
shares the most border with: the split's grid makes slivers where a
facing changes, and no mesher lays a sliver well.

### `pub grafting_procgen_solid_field::pieces::SplitOptions::steepest_up: f64`

See [`Facing::of`]. `0.5` keeps slopes up to 60 degrees Up: steeper
and a border climbing it folds over in the piece's plane, and the
faces against it come out as slivers.

### `pub grafting_procgen_solid_field::seams::Seams::points: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

Every border point, shared by every piece it borders.

### `pub grafting_procgen_solid_field::seams::Seams::rings: alloc::vec::Vec<alloc::vec::Vec<alloc::vec::Vec<usize>>>`

Per piece, its closed rings as indices into [`Self::points`], each
walked with the piece on its left seen from outside the solid.

### `pub grafting_procgen_solid_field::vector::Vec3::x: f64`

### `pub grafting_procgen_solid_field::vector::Vec3::y: f64`

### `pub grafting_procgen_solid_field::vector::Vec3::z: f64`

### `pub mod grafting_procgen_solid_field`

Solid ground that can hold caves, tunnels and bridges, laid by a planar
mesher.

```text
field (height + shapes) -> split into pieces -> shared borders -> lay each piece
```

- [`field`]: where there is solid. A height over the plane plus shapes that
  carve or fill it, combined on demand -- no voxel grid is the truth.
- [`pieces`]: the surface cut into stretches that are each a height over a
  plane of their own.
- [`seams`]: the borders between them, laid once and shared.
- [`lay`]: each piece laid by the irregular quad grid in its own plane and
  lifted back onto the surface.

With no shape anywhere the surface is one piece facing up -- the ground as
it was always laid.

### `pub mod grafting_procgen_solid_field::field`

The field: where there is solid, as a signed distance.

Two kinds of truth, combined on every query rather than baked into a grid:

- **A height over the plane** ([`HeightSource`]): ground as it has always
  been, one height per point. Everything a 2.5D brush does lands here.
- **Shapes** ([`Shape`]): capsules along a path that carve solid away or
  fill it in. A tunnel is one shape; deleting it gives the hill back, with
  nothing remembered.

Negative is solid, positive is air, zero is the surface. The height part is
`y - height(x, z)`, which is not a true distance on a slope; nothing here
needs it to be, only to change sign at the surface and point out of it.

Following Paris et al., *Terrain Amplification with Implicit 3D Features*
(2019): a height field amplified by implicit primitives, evaluated where it
is asked for, never voxelised as the truth.

### `pub mod grafting_procgen_solid_field::lay`

Laying one piece with the irregular quad grid, and lifting it back onto
the surface.

The grid never learns it is not on the ground plane. It is handed the
piece's rings in the piece's own plane, lays its quads exactly as it lays
any ground, and each corner it made is lifted along the piece's axis to the
crossing the piece is: the one with as many crossings in front of it as the
piece was split with. Corners it was handed come back as the border points
they were, so two pieces meet on the very same points.

### `pub mod grafting_procgen_solid_field::pieces`

Splitting the surface into pieces a planar mesher can lay.

A planar mesher -- the irregular quad grid -- lays ground over a plane and
lifts it. That works for any stretch of surface that is a height over
*some* plane: the hill is a height over the ground plane, a tunnel ceiling
a height seen from below, its walls a height seen from the side. So the
surface is split into pieces that each are one.

Two keys make a piece, after Koca and Gudukbay (2014), who build terrain
with caves from axis-aligned surface patches displaced by height:

- **Facing**: which of six axes the surface looks along. Up takes every
  slope short of a cliff, so ordinary hills stay one piece, the way ground
  was laid before there was anything else.
- **Layers in front and behind**: how many times the surface is crossed
  walking out along that axis, and back in against it. Two stretches with
  the same facing and the same counts can never sit over the same point of
  their plane -- the cave floor under a hill and the hilltop above it are
  told apart by the crossings between them -- so every piece is a height.

The coarse surface the split is read from comes from Surface Nets over a
grid sampled only for this. It decides *which* piece a stretch belongs to
and nothing else: the faces that end up on the table are laid by the
mesher, at its own size, never at this grid's.

### `pub mod grafting_procgen_solid_field::seams`

The borders between pieces, laid once and shared by both sides.

Two pieces meeting along a border have to meet on the same points, or the
surface cracks there. So a border is not each piece's own outline: it is
one chain of points, smoothed off the split's staircase, resampled at the
face size and settled onto the surface, which both pieces then take as a
contour -- the same contract a road's outline already has with the ground
laid against it.

A border runs between junctions, where three pieces meet or a piece meets
the edge of the region. Junctions stay where the split put them, so every
border that ends there ends on the same point.

### `pub mod grafting_procgen_solid_field::vector`

The one 3D vector this crate needs, kept local so no vector library's type
crosses its public API.

### `pub struct grafting_procgen_solid_field::HeightGrid`

Heights sampled on a regular grid of the plane, read back bilinearly and
clamped at the edges.

### `pub struct grafting_procgen_solid_field::LaidGround`

Every piece of the surface in `region`, split, bordered and laid.

### `pub struct grafting_procgen_solid_field::LaidPiece`

One piece, laid.

### `pub struct grafting_procgen_solid_field::Piece`

### `pub struct grafting_procgen_solid_field::PieceKey`

What a piece is.

### `pub struct grafting_procgen_solid_field::Region`

The box the surface is read in, and how finely.

### `pub struct grafting_procgen_solid_field::Seams`

### `pub struct grafting_procgen_solid_field::Shape`

A capsule swept along a path: every point within `radius` of it.

One brush stroke is one shape, however many samples the pointer produced,
so the list grows with what was made, not with how long the drag took.

### `pub struct grafting_procgen_solid_field::SolidField<H: grafting_procgen_solid_field::field::HeightSource>`

Where there is solid.

### `pub struct grafting_procgen_solid_field::Split`

The coarse surface, and which piece each of its triangles went to.

### `pub struct grafting_procgen_solid_field::SplitOptions`

### `pub struct grafting_procgen_solid_field::Vec3`

### `pub struct grafting_procgen_solid_field::field::HeightGrid`

Heights sampled on a regular grid of the plane, read back bilinearly and
clamped at the edges.

### `pub struct grafting_procgen_solid_field::field::Shape`

A capsule swept along a path: every point within `radius` of it.

One brush stroke is one shape, however many samples the pointer produced,
so the list grows with what was made, not with how long the drag took.

### `pub struct grafting_procgen_solid_field::field::SolidField<H: grafting_procgen_solid_field::field::HeightSource>`

Where there is solid.

### `pub struct grafting_procgen_solid_field::lay::LaidGround`

Every piece of the surface in `region`, split, bordered and laid.

### `pub struct grafting_procgen_solid_field::lay::LaidPiece`

One piece, laid.

### `pub struct grafting_procgen_solid_field::pieces::Piece`

### `pub struct grafting_procgen_solid_field::pieces::PieceKey`

What a piece is.

### `pub struct grafting_procgen_solid_field::pieces::Region`

The box the surface is read in, and how finely.

### `pub struct grafting_procgen_solid_field::pieces::Split`

The coarse surface, and which piece each of its triangles went to.

### `pub struct grafting_procgen_solid_field::pieces::SplitOptions`

### `pub struct grafting_procgen_solid_field::seams::Seams`

### `pub struct grafting_procgen_solid_field::vector::Vec3`

### `pub trait grafting_procgen_solid_field::HeightSource`

Ground as one height per point of the plane.

### `pub trait grafting_procgen_solid_field::field::HeightSource`

Ground as one height per point of the plane.

### `pub type grafting_procgen_solid_field::vector::Vec3::Output = grafting_procgen_solid_field::vector::Vec3`
