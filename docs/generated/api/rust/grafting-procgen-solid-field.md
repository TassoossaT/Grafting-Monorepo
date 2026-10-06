# grafting-procgen-solid-field

### `pub const fn grafting_procgen_solid_field::vector::Vec3::new(x: f64, y: f64, z: f64) -> Self`

### `pub const fn grafting_procgen_solid_field::vector::Vec3::splat(value: f64) -> Self`

### `pub enum grafting_procgen_solid_field::Effect`

What a shape does to the solid it overlaps.

### `pub enum grafting_procgen_solid_field::field::Effect`

What a shape does to the solid it overlaps.

### `pub fn grafting_procgen_solid_field::edit::edit_surface(patch: &grafting_procgen_solid_field::edit::Faces, context: &grafting_procgen_solid_field::edit::Faces, edit: &grafting_procgen_solid_field::edit::SurfaceEdit) -> core::result::Result<grafting_procgen_solid_field::edit::EditedSurface, alloc::string::String>`

Lays `patch` again with `edit` carved into or filled onto it. `context`
is the ground round it -- never laid again, only asked where solid is.

### `pub fn grafting_procgen_solid_field::edit_surface(patch: &grafting_procgen_solid_field::edit::Faces, context: &grafting_procgen_solid_field::edit::Faces, edit: &grafting_procgen_solid_field::edit::SurfaceEdit) -> core::result::Result<grafting_procgen_solid_field::edit::EditedSurface, alloc::string::String>`

Lays `patch` again with `edit` carved into or filled onto it. `context`
is the ground round it -- never laid again, only asked where solid is.

### `pub fn grafting_procgen_solid_field::field::Shape::bounds(&self, blend: f64) -> (grafting_procgen_solid_field::vector::Vec3, grafting_procgen_solid_field::vector::Vec3)`

The box the shape can change the field in, given how far the blend
between it and the ground reaches.

### `pub fn grafting_procgen_solid_field::field::Shape::distance(&self, point: grafting_procgen_solid_field::vector::Vec3) -> f64`

Signed distance to the capsule: negative inside it.

### `pub fn grafting_procgen_solid_field::field::smooth_min(a: f64, b: f64, k: f64) -> f64`

Polynomial smooth minimum (Inigo Quilez): `min(a, b)` with the corner
rounded over a width of `k`. `k = 0` is the plain minimum.

### `pub fn grafting_procgen_solid_field::field::with_shapes(base: f64, point: grafting_procgen_solid_field::vector::Vec3, shapes: &[grafting_procgen_solid_field::field::Shape], blend: f64) -> f64`

`base` -- the signed distance to whatever already says where solid is --
with every shape applied in order, so a fill made after a carve fills it
back in.

### `pub fn grafting_procgen_solid_field::mesh_distance::MeshDistance::distance(&self, point: grafting_procgen_solid_field::vector::Vec3) -> f64`

Unsigned distance from `point` to the surface.

### `pub fn grafting_procgen_solid_field::mesh_distance::MeshDistance::new(vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>, faces: &[alloc::vec::Vec<usize>], cell: f64) -> Self`

`faces` wound so their normal by the right-hand rule points out of the
solid, fanned into triangles. `cell` sizes the search buckets: about
the length of a face.

### `pub fn grafting_procgen_solid_field::mesh_distance::MeshDistance::signed_distance(&self, point: grafting_procgen_solid_field::vector::Vec3) -> f64`

Signed distance from `point` to the surface: negative inside solid.

### `pub fn grafting_procgen_solid_field::smooth_min(a: f64, b: f64, k: f64) -> f64`

Polynomial smooth minimum (Inigo Quilez): `min(a, b)` with the corner
rounded over a width of `k`. `k = 0` is the plain minimum.

### `pub fn grafting_procgen_solid_field::trimesh::Remesh<'_>::run(&mut self, length: &dyn core::ops::function::Fn(grafting_procgen_solid_field::vector::Vec3) -> f64, rounds: usize)`

Evens the mesh out toward edges `length(at)` long round each point:
finer where the surface turns tight, the ground's own size where it
lies as it always did.

### `pub fn grafting_procgen_solid_field::trimesh::border_loops(triangles: &[[usize; 3]]) -> alloc::vec::Vec<alloc::vec::Vec<usize>>`

Every open border of `triangles` -- an edge no other triangle walks the
other way -- chained into closed loops, each walked the way its triangles
walk it.

### `pub fn grafting_procgen_solid_field::trimesh::zipper(outer: &[usize], inner: &[usize], vertices: &[grafting_procgen_solid_field::vector::Vec3]) -> alloc::vec::Vec<[usize; 3]>`

Triangles stitching the ring `outer` -- walked the way the faces inside
it walked it -- to the border `inner` of a surface inside it, walked the
way that surface's triangles walk it. Both run round the same way; the
strip advances along whichever side keeps its new diagonal shorter.

### `pub fn grafting_procgen_solid_field::vector::Vec3::add(self, other: Self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::cross(self, other: Self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::distance(self, other: Self) -> f64`

### `pub fn grafting_procgen_solid_field::vector::Vec3::distance_to_segment(self, a: Self, b: Self) -> f64`

### `pub fn grafting_procgen_solid_field::vector::Vec3::dot(self, other: Self) -> f64`

### `pub fn grafting_procgen_solid_field::vector::Vec3::length(self) -> f64`

### `pub fn grafting_procgen_solid_field::vector::Vec3::lerp(self, other: Self, t: f64) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::max(self, other: Self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::mean(points: &[Self]) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::min(self, other: Self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::mul(self, scale: f64) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::neg(self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::normalized(self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::sub(self, other: Self) -> Self`

### `pub fn grafting_procgen_solid_field::vector::Vec3::weld_key(&self, epsilon: f64) -> [i64; 3]`

### `pub fn grafting_procgen_solid_field::volume::EditField<'_>::distance(&self, point: grafting_procgen_solid_field::vector::Vec3) -> f64`

Signed distance, negative inside solid.

### `pub fn grafting_procgen_solid_field::volume::EditField<'_>::extract(&self, min: grafting_procgen_solid_field::vector::Vec3, max: grafting_procgen_solid_field::vector::Vec3, cell: f64) -> (alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>, alloc::vec::Vec<[usize; 3]>)`

The surface inside the box `min..max`, read on a grid `cell` apart:
vertices and triangles wound so their normal points out of the solid.

### `pub fn grafting_procgen_solid_field::volume::EditField<'_>::gradient(&self, point: grafting_procgen_solid_field::vector::Vec3, step: f64) -> grafting_procgen_solid_field::vector::Vec3`

The direction out of the solid at `point`, unnormalised.

### `pub fn grafting_procgen_solid_field::volume::EditField<'_>::project(&self, point: grafting_procgen_solid_field::vector::Vec3, step: f64, limit: f64) -> grafting_procgen_solid_field::vector::Vec3`

`point` moved onto the surface along the gradient, a few Newton steps,
never further than `limit` from where it started.

### `pub grafting_procgen_solid_field::EditedSurface::faces: alloc::vec::Vec<alloc::vec::Vec<usize>>`

In the winding the faces handed in had.

### `pub grafting_procgen_solid_field::EditedSurface::source: alloc::vec::Vec<core::option::Option<usize>>`

Index-aligned with `vertices`: the vertex of the faces handed in a
corner is, for every corner of the ring left standing.

### `pub grafting_procgen_solid_field::EditedSurface::vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::Effect::Carve`

Takes solid away: a tunnel, a cave.

### `pub grafting_procgen_solid_field::Effect::Fill`

Adds solid: a bridge, a ledge.

### `pub grafting_procgen_solid_field::Faces::faces: alloc::vec::Vec<alloc::vec::Vec<usize>>`

### `pub grafting_procgen_solid_field::Faces::vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::Shape::effect: grafting_procgen_solid_field::field::Effect`

### `pub grafting_procgen_solid_field::Shape::path: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::Shape::radius: f64`

### `pub grafting_procgen_solid_field::SurfaceEdit::blend: f64`

Width over which a shape blends into the ground.

### `pub grafting_procgen_solid_field::SurfaceEdit::face_side: f64`

How wide one finished face should be -- the ground's own size; laid
finer where a shape is narrower than ten faces round.

### `pub grafting_procgen_solid_field::SurfaceEdit::seed: u32`

### `pub grafting_procgen_solid_field::SurfaceEdit::shapes: alloc::vec::Vec<grafting_procgen_solid_field::field::Shape>`

### `pub grafting_procgen_solid_field::Vec3::x: f64`

### `pub grafting_procgen_solid_field::Vec3::y: f64`

### `pub grafting_procgen_solid_field::Vec3::z: f64`

### `pub grafting_procgen_solid_field::edit::EditedSurface::faces: alloc::vec::Vec<alloc::vec::Vec<usize>>`

In the winding the faces handed in had.

### `pub grafting_procgen_solid_field::edit::EditedSurface::source: alloc::vec::Vec<core::option::Option<usize>>`

Index-aligned with `vertices`: the vertex of the faces handed in a
corner is, for every corner of the ring left standing.

### `pub grafting_procgen_solid_field::edit::EditedSurface::vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::edit::Faces::faces: alloc::vec::Vec<alloc::vec::Vec<usize>>`

### `pub grafting_procgen_solid_field::edit::Faces::vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::edit::SurfaceEdit::blend: f64`

Width over which a shape blends into the ground.

### `pub grafting_procgen_solid_field::edit::SurfaceEdit::face_side: f64`

How wide one finished face should be -- the ground's own size; laid
finer where a shape is narrower than ten faces round.

### `pub grafting_procgen_solid_field::edit::SurfaceEdit::seed: u32`

### `pub grafting_procgen_solid_field::edit::SurfaceEdit::shapes: alloc::vec::Vec<grafting_procgen_solid_field::field::Shape>`

### `pub grafting_procgen_solid_field::field::Effect::Carve`

Takes solid away: a tunnel, a cave.

### `pub grafting_procgen_solid_field::field::Effect::Fill`

Adds solid: a bridge, a ledge.

### `pub grafting_procgen_solid_field::field::Shape::effect: grafting_procgen_solid_field::field::Effect`

### `pub grafting_procgen_solid_field::field::Shape::path: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::field::Shape::radius: f64`

### `pub grafting_procgen_solid_field::trimesh::Remesh::locked: alloc::vec::Vec<bool>`

### `pub grafting_procgen_solid_field::trimesh::Remesh::locked_edges: std::collections::hash::set::HashSet<(usize, usize)>`

### `pub grafting_procgen_solid_field::trimesh::Remesh::settle: &'a dyn core::ops::function::Fn(grafting_procgen_solid_field::vector::Vec3) -> grafting_procgen_solid_field::vector::Vec3`

Puts a point back on the surface.

### `pub grafting_procgen_solid_field::trimesh::Remesh::triangles: alloc::vec::Vec<[usize; 3]>`

### `pub grafting_procgen_solid_field::trimesh::Remesh::vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::vector::Vec3::x: f64`

### `pub grafting_procgen_solid_field::vector::Vec3::y: f64`

### `pub grafting_procgen_solid_field::vector::Vec3::z: f64`

### `pub grafting_procgen_solid_field::volume::EditField::blend: f64`

### `pub grafting_procgen_solid_field::volume::EditField::ground: &'a grafting_procgen_solid_field::mesh_distance::MeshDistance`

### `pub grafting_procgen_solid_field::volume::EditField::shapes: &'a [grafting_procgen_solid_field::field::Shape]`

### `pub mod grafting_procgen_solid_field`

Carving into the ground and filling it in, in three dimensions, as an
edit of the ground's own mesh.

The ground is its mesh. An edit hands in the faces it reaches and the
ground round them; [`edit_surface`] asks that mesh where solid is, carves
or fills the edit's shapes, reads the new surface, stitches it to the ring
of ground left standing and lays it with the irregular quad grid's own
steps -- pairing, ortho, relaxation -- over the surface instead of the
plane. What comes back is ground like any other: the ring's very nodes,
new nodes inside it, irregular cells.

- [`field`]: the shapes, and how they combine with solid.
- [`mesh_distance`]: signed distance to the ground's faces.
- [`volume`]: solid after the edit; reading its surface off a grid.
- [`trimesh`]: borders, the stitch to the ring, the isotropic remesh.
- [`edit`]: the edit end to end.

### `pub mod grafting_procgen_solid_field::edit`

Carving into the ground, or filling it in, as an edit of the ground's own
mesh.

```text
faces to lay again + ground round them
  -> where solid is after the edit      (their mesh, shapes carved or filled)
  -> the new surface, read on a grid    (Surface Nets, kept off the ring)
  -> stitched to the ring left standing (a strip, ring nodes untouched)
  -> even triangles                     (isotropic remesh, ring locked)
  -> the irregular grid's own cells     (pair, ortho, relax -- in 3D)
```

Nothing is kept beside the ground. The faces handed in are laid again; the
ring of nodes round them -- what the ground beyond still holds -- comes
back as the very same nodes, every edge of it unsplit, so the result goes
back into the graph as ground like any other, one mesh with the rest.

### `pub mod grafting_procgen_solid_field::field`

Shapes that carve solid away or fill it in, and how they combine with
whatever already says where solid is.

Negative is solid, positive is air, zero is the surface. A shape is a
capsule swept along a path; carving takes the capsule out of the solid,
filling adds it, both blended over a width so the lip of a tunnel or the
foot of a bridge rounds off instead of creasing.

### `pub mod grafting_procgen_solid_field::mesh_distance`

Signed distance to a surface given as faces -- the ground itself.

The distance is to the nearest point of any triangle of the faces; its
sign comes from the angle-weighted pseudo-normal of the feature that point
lies on (Baerentzen and Aanaes), outward meaning air. That is what makes
"inside the hill" a question the ground's own mesh answers, with no height
map beside it: a tunnel under faces nobody is laying again still knows it
is in solid.

A uniform grid of triangle buckets keeps a query to the triangles near it.

### `pub mod grafting_procgen_solid_field::trimesh`

A triangle mesh being shaped into the ground: its open borders, the strip
that stitches a new surface onto a ring of ground left standing, and the
isotropic remesh that evens its triangles out before the irregular grid's
own steps lay cells over it.

The remesh follows Botsch and Kobbelt's *A Remeshing Approach to
Multiresolution Modeling* (2004): split long edges, collapse short ones,
flip toward even valence, smooth tangentially and settle back onto the
surface. Locked vertices and edges -- the ring of ground the new surface
meets -- are never moved, split, collapsed or flipped, so what stands
round the edit keeps its every node.

### `pub mod grafting_procgen_solid_field::vector`

The one 3D vector this crate needs, kept local so no vector library's type
crosses its public API.

### `pub mod grafting_procgen_solid_field::volume`

Where there is solid after an edit: the ground's own mesh, with the edit's
shapes carved out of it or filled into it.

Built for one edit and dropped after it. Nothing here is kept: the ground
is its mesh, and the next edit asks the mesh again.

### `pub struct grafting_procgen_solid_field::EditedSurface`

The faces laid in place of the ones handed in.

### `pub struct grafting_procgen_solid_field::Faces`

Faces, as indices into their own vertices, in whatever winding the
caller's ground uses -- the same for every face.

### `pub struct grafting_procgen_solid_field::Shape`

A capsule swept along a path: every point within `radius` of it.

### `pub struct grafting_procgen_solid_field::SurfaceEdit`

One edit: what to carve or fill, and the cells to lay the result in.

### `pub struct grafting_procgen_solid_field::Vec3`

### `pub struct grafting_procgen_solid_field::edit::EditedSurface`

The faces laid in place of the ones handed in.

### `pub struct grafting_procgen_solid_field::edit::Faces`

Faces, as indices into their own vertices, in whatever winding the
caller's ground uses -- the same for every face.

### `pub struct grafting_procgen_solid_field::edit::SurfaceEdit`

One edit: what to carve or fill, and the cells to lay the result in.

### `pub struct grafting_procgen_solid_field::field::Shape`

A capsule swept along a path: every point within `radius` of it.

### `pub struct grafting_procgen_solid_field::mesh_distance::MeshDistance`

The ground as triangles, ready to be asked how far a point is from it.

### `pub struct grafting_procgen_solid_field::trimesh::Remesh<'a>`

A triangle mesh with locked vertices and edges, being remeshed.

### `pub struct grafting_procgen_solid_field::vector::Vec3`

### `pub struct grafting_procgen_solid_field::volume::EditField<'a>`

The ground after the edit, as a signed distance.

### `pub type grafting_procgen_solid_field::vector::Vec3::Output = grafting_procgen_solid_field::vector::Vec3`
