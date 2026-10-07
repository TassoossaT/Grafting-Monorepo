# grafting-procgen-solid-field

### `pub const fn grafting_procgen_solid_field::vector::Vec3::new(x: f64, y: f64, z: f64) -> Self`

### `pub const fn grafting_procgen_solid_field::vector::Vec3::splat(value: f64) -> Self`

### `pub enum grafting_procgen_solid_field::Effect`

What a shape does to the solid it overlaps.

### `pub enum grafting_procgen_solid_field::Form`

The solid a shape stands for, round its path.

### `pub enum grafting_procgen_solid_field::Origin`

What a corner of the result already is.

### `pub enum grafting_procgen_solid_field::field::Effect`

What a shape does to the solid it overlaps.

### `pub enum grafting_procgen_solid_field::field::Form`

The solid a shape stands for, round its path.

### `pub enum grafting_procgen_solid_field::regenerate::Origin`

What a corner of the result already is.

### `pub fn grafting_procgen_solid_field::edit::edit_surface(patch: &grafting_procgen_solid_field::edit::Faces, context: &grafting_procgen_solid_field::edit::Faces, edit: &grafting_procgen_solid_field::edit::SurfaceEdit) -> core::result::Result<grafting_procgen_solid_field::edit::EditedSurface, alloc::string::String>`

Lays `patch` again with `edit` carved into or filled onto it. `context`
is the ground round it -- never laid again, only asked where solid is.

### `pub fn grafting_procgen_solid_field::edit_surface(patch: &grafting_procgen_solid_field::edit::Faces, context: &grafting_procgen_solid_field::edit::Faces, edit: &grafting_procgen_solid_field::edit::SurfaceEdit) -> core::result::Result<grafting_procgen_solid_field::edit::EditedSurface, alloc::string::String>`

Lays `patch` again with `edit` carved into or filled onto it. `context`
is the ground round it -- never laid again, only asked where solid is.

### `pub fn grafting_procgen_solid_field::field::Shape::bounds(&self, blend: f64) -> (grafting_procgen_solid_field::vector::Vec3, grafting_procgen_solid_field::vector::Vec3)`

The box the shape can change the field in, given how far the blend
between it and the ground reaches.

### `pub fn grafting_procgen_solid_field::field::Shape::capsule(effect: grafting_procgen_solid_field::field::Effect, path: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>, radius: f64) -> Self`

A round capsule along `path`.

### `pub fn grafting_procgen_solid_field::field::Shape::depth(&self, point: grafting_procgen_solid_field::vector::Vec3) -> f64`

How deep the layer is at `point`: the profile's height on the path,
a cosine down to nothing at the radius -- the distance read across the
ground at the nearest point of the path (`up`), so it never jumps where
the ground below folds. Zero for any other form.

### `pub fn grafting_procgen_solid_field::field::Shape::distance(&self, point: grafting_procgen_solid_field::vector::Vec3) -> f64`

Signed distance to the shape: negative inside it. Bounded by the true
distance, so a step of that length never passes through the surface.

### `pub fn grafting_procgen_solid_field::field::Shape::thickness(&self) -> f64`

How thin the shape is at its thinnest: what the faces laid on it must
be finer than to describe it.

### `pub fn grafting_procgen_solid_field::field::smooth_min(a: f64, b: f64, k: f64) -> f64`

Polynomial smooth minimum (Inigo Quilez): `min(a, b)` with the corner
rounded over a width of `k`. `k = 0` is the plain minimum.

### `pub fn grafting_procgen_solid_field::field::with_shapes(base: f64, point: grafting_procgen_solid_field::vector::Vec3, shapes: &[grafting_procgen_solid_field::field::Shape], blend: f64) -> f64`

`base` -- the signed distance to whatever already says where solid is --
with every shape applied in order, so a fill made after a carve fills it
back in.

### `pub fn grafting_procgen_solid_field::layer::layer_surface(patch: &grafting_procgen_solid_field::edit::Faces, context: &grafting_procgen_solid_field::edit::Faces, neighbours: &grafting_procgen_solid_field::edit::Faces, edit: &grafting_procgen_solid_field::layer::LayerEdit) -> core::result::Result<grafting_procgen_solid_field::regenerate::RegeneratedSurface, alloc::string::String>`

Lays `patch` again with `edit` applied to it. `context` is the ground
round it and `neighbours` the structures standing in it: a layer laid
out over the bare table never covers either.

### `pub fn grafting_procgen_solid_field::layer_surface(patch: &grafting_procgen_solid_field::edit::Faces, context: &grafting_procgen_solid_field::edit::Faces, neighbours: &grafting_procgen_solid_field::edit::Faces, edit: &grafting_procgen_solid_field::layer::LayerEdit) -> core::result::Result<grafting_procgen_solid_field::regenerate::RegeneratedSurface, alloc::string::String>`

Lays `patch` again with `edit` applied to it. `context` is the ground
round it and `neighbours` the structures standing in it: a layer laid
out over the bare table never covers either.

### `pub fn grafting_procgen_solid_field::mesh_distance::MeshDistance::closest(&self, point: grafting_procgen_solid_field::vector::Vec3) -> core::option::Option<(grafting_procgen_solid_field::vector::Vec3, [usize; 3])>`

The nearest point of the surface to `point`, and the corners of the
triangle it lies on, as indices into the vertices handed in.

### `pub fn grafting_procgen_solid_field::mesh_distance::MeshDistance::distance(&self, point: grafting_procgen_solid_field::vector::Vec3) -> f64`

Unsigned distance from `point` to the surface.

### `pub fn grafting_procgen_solid_field::mesh_distance::MeshDistance::new(vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>, faces: &[alloc::vec::Vec<usize>], cell: f64) -> Self`

`faces` wound so their normal by the right-hand rule points out of the
solid, fanned into triangles. `cell` sizes the search buckets: about
the length of a face.

### `pub fn grafting_procgen_solid_field::mesh_distance::MeshDistance::signed_distance(&self, point: grafting_procgen_solid_field::vector::Vec3) -> f64`

Signed distance from `point` to the surface: negative inside solid.

### `pub fn grafting_procgen_solid_field::mesh_distance::MeshDistance::signed_distance_at_border(&self, point: grafting_procgen_solid_field::vector::Vec3) -> (f64, bool)`

Signed distance, and whether the nearest point of the surface lies on
its open border -- where the sign says nothing: past the edge of an
open sheet of ground, inside and outside are undefined.

### `pub fn grafting_procgen_solid_field::mesh_distance::MeshDistance::signed_distance_at_border_within(&self, point: grafting_procgen_solid_field::vector::Vec3, reach: f64) -> (f64, bool)`

[`Self::signed_distance_at_border`], exact only within `reach`: past it
the size is a stand-in and only the sign is to be read.

### `pub fn grafting_procgen_solid_field::regenerate::regenerate_surface(patch: &grafting_procgen_solid_field::edit::Faces, regeneration: &grafting_procgen_solid_field::regenerate::Regeneration) -> core::result::Result<grafting_procgen_solid_field::regenerate::RegeneratedSurface, alloc::string::String>`

Lays `patch` again on its own surface, going round `regeneration.holes`.

A rim touching itself at a corner -- ground gone round a road's end and
meeting itself again at its corner -- is cut open there: the corner taken
once for each fan of faces round it, so the patch is a disk the chart can
lay out, and every copy comes back as the corner it is.

### `pub fn grafting_procgen_solid_field::regenerate_surface(patch: &grafting_procgen_solid_field::edit::Faces, regeneration: &grafting_procgen_solid_field::regenerate::Regeneration) -> core::result::Result<grafting_procgen_solid_field::regenerate::RegeneratedSurface, alloc::string::String>`

Lays `patch` again on its own surface, going round `regeneration.holes`.

A rim touching itself at a corner -- ground gone round a road's end and
meeting itself again at its corner -- is cut open there: the corner taken
once for each fan of faces round it, so the patch is a disk the chart can
lay out, and every copy comes back as the corner it is.

### `pub fn grafting_procgen_solid_field::smooth_min(a: f64, b: f64, k: f64) -> f64`

Polynomial smooth minimum (Inigo Quilez): `min(a, b)` with the corner
rounded over a width of `k`. `k = 0` is the plain minimum.

### `pub fn grafting_procgen_solid_field::table::TableFloor::covered(&self, point: grafting_procgen_solid_field::vector::Vec3) -> bool`

Whether ground stands over or under `point` in plan.

### `pub fn grafting_procgen_solid_field::table::TableFloor::distance(&self, point: grafting_procgen_solid_field::vector::Vec3) -> core::option::Option<f64>`

The table's own signed distance at `point`, where it is the floor.

### `pub fn grafting_procgen_solid_field::table::TableFloor::holds(&self, point: grafting_procgen_solid_field::vector::Vec3, tolerance: f64) -> bool`

Whether `point` lies on the table where it is the floor, within `tolerance`.

### `pub fn grafting_procgen_solid_field::table::TableFloor::new(height: f64, vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>, triangles: alloc::vec::Vec<[usize; 3]>, cell: f64) -> Self`

The table at `height`, with `triangles` the ground over it, by their plan.

### `pub fn grafting_procgen_solid_field::trimesh::Remesh<'_>::run(&mut self, length: &dyn core::ops::function::Fn(grafting_procgen_solid_field::vector::Vec3) -> f64, rounds: usize)`

Evens the mesh out toward edges `length(at)` long round each point:
finer where the surface turns tight, the ground's own size where it
lies as it always did.

### `pub fn grafting_procgen_solid_field::trimesh::border_loops(triangles: &[[usize; 3]]) -> alloc::vec::Vec<alloc::vec::Vec<usize>>`

Every open border of `triangles` -- an edge no other triangle walks the
other way -- chained into closed loops, each walked the way its triangles
walk it.

### `pub fn grafting_procgen_solid_field::trimesh::unfold(vertices: &mut [grafting_procgen_solid_field::vector::Vec3], triangles: &mut [[usize; 3]], locked: &[bool], locked_edges: &std::collections::hash::set::HashSet<(usize, usize)>, facing: &dyn core::ops::function::Fn(grafting_procgen_solid_field::vector::Vec3) -> grafting_procgen_solid_field::vector::Vec3, settle: &dyn core::ops::function::Fn(grafting_procgen_solid_field::vector::Vec3) -> grafting_procgen_solid_field::vector::Vec3)`

Unfolds what flips alone cannot: every free corner of a triangle facing
into the solid moved to the middle of its neighbours and settled back on
the surface, flips tried again after each round, until none faces in or
the rounds run out. Each triangle is asked which way it faces once, then
again only when a corner of it moved.

### `pub fn grafting_procgen_solid_field::trimesh::untangle(triangles: &mut [[usize; 3]], vertices: &[grafting_procgen_solid_field::vector::Vec3], locked: &std::collections::hash::set::HashSet<(usize, usize)>, facing: &dyn core::ops::function::Fn(grafting_procgen_solid_field::vector::Vec3) -> grafting_procgen_solid_field::vector::Vec3)`

Turns over the triangles facing into the solid where a flip of the edge
they share with a neighbour leaves both facing out: the strip stitched to
a ring folds where the ring and the new surface's border run unevenly
beside each other, and a flip undoes the fold. Locked edges never flip.

### `pub fn grafting_procgen_solid_field::trimesh::zipper(outer: &[usize], inner: &[usize], vertices: &[grafting_procgen_solid_field::vector::Vec3]) -> alloc::vec::Vec<[usize; 3]>`

### `pub fn grafting_procgen_solid_field::trimesh::zipper_open(outer: &[usize], inner: &[usize], vertices: &[grafting_procgen_solid_field::vector::Vec3]) -> alloc::vec::Vec<[usize; 3]>`

Triangles stitching the open chain `outer` to the stretch `inner` of a
border running beside it, both walked the same way; the strip advances
along whichever side keeps its new diagonal shorter, end to end.

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

### `pub fn grafting_procgen_solid_field::volume::EditField<'_>::extract(&self, min: grafting_procgen_solid_field::vector::Vec3, max: grafting_procgen_solid_field::vector::Vec3, cell: f64) -> (alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>, alloc::vec::Vec<[usize; 3]>, usize)`

The surface inside the box `min..max`, read on a grid `cell` apart:
vertices and triangles wound so their normal points out of the solid,
and how many faces the grid read both ways had to be settled -- solid
or air finer than the grid, which a finer grid may read as it is.

### `pub fn grafting_procgen_solid_field::volume::EditField<'_>::gradient(&self, point: grafting_procgen_solid_field::vector::Vec3, step: f64) -> grafting_procgen_solid_field::vector::Vec3`

The direction out of the solid at `point`, unnormalised.

### `pub fn grafting_procgen_solid_field::volume::EditField<'_>::project(&self, point: grafting_procgen_solid_field::vector::Vec3, step: f64, limit: f64) -> grafting_procgen_solid_field::vector::Vec3`

`point` moved onto the surface along the gradient, a few Newton steps,
never further than `limit` from where it started.

### `pub fn grafting_procgen_solid_field::volume::EditField<'a>::clone(&self) -> grafting_procgen_solid_field::volume::EditField<'a>`

### `pub grafting_procgen_solid_field::Bed::above: f64`

How far over its rest the ground may rise and still be brought down to it.

### `pub grafting_procgen_solid_field::Bed::below: f64`

How far under its rest the ground may lie and still be brought up to it.

### `pub grafting_procgen_solid_field::Bed::faces: grafting_procgen_solid_field::edit::Faces`

The structure's faces the ground rests under.

### `pub grafting_procgen_solid_field::Bed::margin: f64`

How far past the faces' rim the ground still lies at rest, before the shoulder.

### `pub grafting_procgen_solid_field::Bed::shoulder: f64`

The narrowest a shoulder is.

### `pub grafting_procgen_solid_field::Bed::sink: f64`

How far under the faces the ground comes to rest.

### `pub grafting_procgen_solid_field::Bed::slope: f64`

The shoulder's width for every metre the ground is moved there.

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

### `pub grafting_procgen_solid_field::Effect::Lower`

Takes such a layer away: the trench dug along a stroke.

### `pub grafting_procgen_solid_field::Effect::Raise`

Lays a layer of earth over the solid near the path: as deep as the
shape's `Form::Profile` height on it, thinning to nothing at its
radius -- a pile following the ground it is laid on, a hillside or a
cave's wall alike.

### `pub grafting_procgen_solid_field::Faces::faces: alloc::vec::Vec<alloc::vec::Vec<usize>>`

### `pub grafting_procgen_solid_field::Faces::vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::Form::Column`

The column over the path's plan, `radius` wide, from height `low` to
`high`: what a level is cut down to or filled up to, never reaching
past those heights -- to a cave's ceiling, say.

### `pub grafting_procgen_solid_field::Form::Column::high: f64`

### `pub grafting_procgen_solid_field::Form::Column::low: f64`

### `pub grafting_procgen_solid_field::Form::Profile`

A layer `height` deep on the path, thinning by a cosine to nothing at
the radius -- for [`Effect::Raise`] and [`Effect::Lower`].

### `pub grafting_procgen_solid_field::Form::Profile::height: f64`

### `pub grafting_procgen_solid_field::Form::Swept`

A capsule swept along the path, `squash` times as tall as it is wide:
`1` round -- a tunnel's bore -- and less a pile of earth laid along a
stroke, or the trench dug along one.

### `pub grafting_procgen_solid_field::Form::Swept::squash: f64`

### `pub grafting_procgen_solid_field::GivenPoint::id: usize`

### `pub grafting_procgen_solid_field::GivenPoint::position: grafting_procgen_solid_field::vector::Vec3`

### `pub grafting_procgen_solid_field::Landing::from: grafting_procgen_solid_field::regenerate::Origin`

### `pub grafting_procgen_solid_field::Landing::to: grafting_procgen_solid_field::regenerate::Origin`

### `pub grafting_procgen_solid_field::Landing::vertex: usize`

### `pub grafting_procgen_solid_field::LayerEdit::beds: alloc::vec::Vec<grafting_procgen_solid_field::bed::Bed>`

Structures the ground is brought to rest under, after the shapes.

### `pub grafting_procgen_solid_field::LayerEdit::blend: f64`

How far a level eases into the ground round it.

### `pub grafting_procgen_solid_field::LayerEdit::face_side: f64`

How wide one finished face should be.

### `pub grafting_procgen_solid_field::LayerEdit::seed: u32`

### `pub grafting_procgen_solid_field::LayerEdit::shapes: alloc::vec::Vec<grafting_procgen_solid_field::field::Shape>`

### `pub grafting_procgen_solid_field::LayerEdit::table: core::option::Option<f64>`

The table's height, where a layer laid past the ground rests new
ground on the bare table. `None` never reaches past the ground.

### `pub grafting_procgen_solid_field::Origin::Given(usize)`

A point of one of [`Regeneration::holes`], by its id.

### `pub grafting_procgen_solid_field::Origin::Patch(usize)`

A vertex of the patch handed in -- a corner of its ring.

### `pub grafting_procgen_solid_field::RegeneratedSurface::faces: alloc::vec::Vec<alloc::vec::Vec<usize>>`

In the winding the patch's faces had.

### `pub grafting_procgen_solid_field::RegeneratedSurface::landed: alloc::vec::Vec<grafting_procgen_solid_field::regenerate::Landing>`

### `pub grafting_procgen_solid_field::RegeneratedSurface::origin: alloc::vec::Vec<core::option::Option<grafting_procgen_solid_field::regenerate::Origin>>`

Index-aligned with `vertices`.

### `pub grafting_procgen_solid_field::RegeneratedSurface::refinement_complete: bool`

`false` where the generator stopped at its vertex budget.

### `pub grafting_procgen_solid_field::RegeneratedSurface::vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::Regeneration::face_side: f64`

How wide one finished face should be, measured on the surface.

### `pub grafting_procgen_solid_field::Regeneration::holes: alloc::vec::Vec<alloc::vec::Vec<grafting_procgen_solid_field::regenerate::GivenPoint>>`

Closed rings where structures rest on the ground: no ground inside --
but a ring wound the other way inside one is ground again, a block the
structures close round (non-zero).

### `pub grafting_procgen_solid_field::Regeneration::relax_strength: f64`

The relaxation's strength in the chart, as the plane's generator takes it.

### `pub grafting_procgen_solid_field::Regeneration::seed: u32`

### `pub grafting_procgen_solid_field::Shape::effect: grafting_procgen_solid_field::field::Effect`

### `pub grafting_procgen_solid_field::Shape::form: grafting_procgen_solid_field::field::Form`

### `pub grafting_procgen_solid_field::Shape::path: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::Shape::radius: f64`

### `pub grafting_procgen_solid_field::Shape::up: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

For a layer: the ground's normal out of the solid at each point of the
path. A layer's depth is read across the ground there, not along its
normal, so a point over the path has the whole depth under it. Empty,
the depth is read by plain distance to the path.

### `pub grafting_procgen_solid_field::SurfaceEdit::blend: f64`

Width over which a shape blends into the ground.

### `pub grafting_procgen_solid_field::SurfaceEdit::face_side: f64`

How wide one finished face should be -- the ground's own size; laid
finer where a shape is narrower than ten faces round.

### `pub grafting_procgen_solid_field::SurfaceEdit::neighbours: grafting_procgen_solid_field::edit::Faces`

Faces round the patch that are no ground -- structures standing in it:
never solid, never laid again, but a side of the patch one of them
holds is a ring side, kept where it is.

### `pub grafting_procgen_solid_field::SurfaceEdit::seed: u32`

### `pub grafting_procgen_solid_field::SurfaceEdit::shapes: alloc::vec::Vec<grafting_procgen_solid_field::field::Shape>`

### `pub grafting_procgen_solid_field::SurfaceEdit::table: core::option::Option<f64>`

The table's height, where the edit may rest new ground on it: solid
below it wherever no ground stands. `None` never reads the table.

### `pub grafting_procgen_solid_field::Vec3::x: f64`

### `pub grafting_procgen_solid_field::Vec3::y: f64`

### `pub grafting_procgen_solid_field::Vec3::z: f64`

### `pub grafting_procgen_solid_field::bed::Bed::above: f64`

How far over its rest the ground may rise and still be brought down to it.

### `pub grafting_procgen_solid_field::bed::Bed::below: f64`

How far under its rest the ground may lie and still be brought up to it.

### `pub grafting_procgen_solid_field::bed::Bed::faces: grafting_procgen_solid_field::edit::Faces`

The structure's faces the ground rests under.

### `pub grafting_procgen_solid_field::bed::Bed::margin: f64`

How far past the faces' rim the ground still lies at rest, before the shoulder.

### `pub grafting_procgen_solid_field::bed::Bed::shoulder: f64`

The narrowest a shoulder is.

### `pub grafting_procgen_solid_field::bed::Bed::sink: f64`

How far under the faces the ground comes to rest.

### `pub grafting_procgen_solid_field::bed::Bed::slope: f64`

The shoulder's width for every metre the ground is moved there.

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

### `pub grafting_procgen_solid_field::edit::SurfaceEdit::neighbours: grafting_procgen_solid_field::edit::Faces`

Faces round the patch that are no ground -- structures standing in it:
never solid, never laid again, but a side of the patch one of them
holds is a ring side, kept where it is.

### `pub grafting_procgen_solid_field::edit::SurfaceEdit::seed: u32`

### `pub grafting_procgen_solid_field::edit::SurfaceEdit::shapes: alloc::vec::Vec<grafting_procgen_solid_field::field::Shape>`

### `pub grafting_procgen_solid_field::edit::SurfaceEdit::table: core::option::Option<f64>`

The table's height, where the edit may rest new ground on it: solid
below it wherever no ground stands. `None` never reads the table.

### `pub grafting_procgen_solid_field::field::Effect::Carve`

Takes solid away: a tunnel, a cave.

### `pub grafting_procgen_solid_field::field::Effect::Fill`

Adds solid: a bridge, a ledge.

### `pub grafting_procgen_solid_field::field::Effect::Lower`

Takes such a layer away: the trench dug along a stroke.

### `pub grafting_procgen_solid_field::field::Effect::Raise`

Lays a layer of earth over the solid near the path: as deep as the
shape's `Form::Profile` height on it, thinning to nothing at its
radius -- a pile following the ground it is laid on, a hillside or a
cave's wall alike.

### `pub grafting_procgen_solid_field::field::Form::Column`

The column over the path's plan, `radius` wide, from height `low` to
`high`: what a level is cut down to or filled up to, never reaching
past those heights -- to a cave's ceiling, say.

### `pub grafting_procgen_solid_field::field::Form::Column::high: f64`

### `pub grafting_procgen_solid_field::field::Form::Column::low: f64`

### `pub grafting_procgen_solid_field::field::Form::Profile`

A layer `height` deep on the path, thinning by a cosine to nothing at
the radius -- for [`Effect::Raise`] and [`Effect::Lower`].

### `pub grafting_procgen_solid_field::field::Form::Profile::height: f64`

### `pub grafting_procgen_solid_field::field::Form::Swept`

A capsule swept along the path, `squash` times as tall as it is wide:
`1` round -- a tunnel's bore -- and less a pile of earth laid along a
stroke, or the trench dug along one.

### `pub grafting_procgen_solid_field::field::Form::Swept::squash: f64`

### `pub grafting_procgen_solid_field::field::Shape::effect: grafting_procgen_solid_field::field::Effect`

### `pub grafting_procgen_solid_field::field::Shape::form: grafting_procgen_solid_field::field::Form`

### `pub grafting_procgen_solid_field::field::Shape::path: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::field::Shape::radius: f64`

### `pub grafting_procgen_solid_field::field::Shape::up: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

For a layer: the ground's normal out of the solid at each point of the
path. A layer's depth is read across the ground there, not along its
normal, so a point over the path has the whole depth under it. Empty,
the depth is read by plain distance to the path.

### `pub grafting_procgen_solid_field::layer::LayerEdit::beds: alloc::vec::Vec<grafting_procgen_solid_field::bed::Bed>`

Structures the ground is brought to rest under, after the shapes.

### `pub grafting_procgen_solid_field::layer::LayerEdit::blend: f64`

How far a level eases into the ground round it.

### `pub grafting_procgen_solid_field::layer::LayerEdit::face_side: f64`

How wide one finished face should be.

### `pub grafting_procgen_solid_field::layer::LayerEdit::seed: u32`

### `pub grafting_procgen_solid_field::layer::LayerEdit::shapes: alloc::vec::Vec<grafting_procgen_solid_field::field::Shape>`

### `pub grafting_procgen_solid_field::layer::LayerEdit::table: core::option::Option<f64>`

The table's height, where a layer laid past the ground rests new
ground on the bare table. `None` never reaches past the ground.

### `pub grafting_procgen_solid_field::regenerate::GivenPoint::id: usize`

### `pub grafting_procgen_solid_field::regenerate::GivenPoint::position: grafting_procgen_solid_field::vector::Vec3`

### `pub grafting_procgen_solid_field::regenerate::Landing::from: grafting_procgen_solid_field::regenerate::Origin`

### `pub grafting_procgen_solid_field::regenerate::Landing::to: grafting_procgen_solid_field::regenerate::Origin`

### `pub grafting_procgen_solid_field::regenerate::Landing::vertex: usize`

### `pub grafting_procgen_solid_field::regenerate::Origin::Given(usize)`

A point of one of [`Regeneration::holes`], by its id.

### `pub grafting_procgen_solid_field::regenerate::Origin::Patch(usize)`

A vertex of the patch handed in -- a corner of its ring.

### `pub grafting_procgen_solid_field::regenerate::RegeneratedSurface::faces: alloc::vec::Vec<alloc::vec::Vec<usize>>`

In the winding the patch's faces had.

### `pub grafting_procgen_solid_field::regenerate::RegeneratedSurface::landed: alloc::vec::Vec<grafting_procgen_solid_field::regenerate::Landing>`

### `pub grafting_procgen_solid_field::regenerate::RegeneratedSurface::origin: alloc::vec::Vec<core::option::Option<grafting_procgen_solid_field::regenerate::Origin>>`

Index-aligned with `vertices`.

### `pub grafting_procgen_solid_field::regenerate::RegeneratedSurface::refinement_complete: bool`

`false` where the generator stopped at its vertex budget.

### `pub grafting_procgen_solid_field::regenerate::RegeneratedSurface::vertices: alloc::vec::Vec<grafting_procgen_solid_field::vector::Vec3>`

### `pub grafting_procgen_solid_field::regenerate::Regeneration::face_side: f64`

How wide one finished face should be, measured on the surface.

### `pub grafting_procgen_solid_field::regenerate::Regeneration::holes: alloc::vec::Vec<alloc::vec::Vec<grafting_procgen_solid_field::regenerate::GivenPoint>>`

Closed rings where structures rest on the ground: no ground inside --
but a ring wound the other way inside one is ground again, a block the
structures close round (non-zero).

### `pub grafting_procgen_solid_field::regenerate::Regeneration::relax_strength: f64`

The relaxation's strength in the chart, as the plane's generator takes it.

### `pub grafting_procgen_solid_field::regenerate::Regeneration::seed: u32`

### `pub grafting_procgen_solid_field::table::TableFloor::height: f64`

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

### `pub grafting_procgen_solid_field::volume::EditField::reach: f64`

How far from the ground distances are measured exactly; past it only
their sign is right -- all a grid read needs of a sample far from the
surface. `INFINITY` measures everywhere.

### `pub grafting_procgen_solid_field::volume::EditField::shapes: &'a [grafting_procgen_solid_field::field::Shape]`

### `pub grafting_procgen_solid_field::volume::EditField::table: core::option::Option<&'a grafting_procgen_solid_field::table::TableFloor>`

The table under the ground, solid where no ground stands.

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
- [`table`]: the table under the ground, solid where no ground stands.
- [`trimesh`]: borders, the stitch to the ring, the isotropic remesh.
- [`edit`]: the edit end to end.
- [`regenerate`]: a patch laid again on its own surface, round structures.
- [`layer`]: a layer laid on the ground or taken off it, the ground
  levelled -- the surface moved, never read again off a grid.
- [`bed`]: the ground brought to rest under a structure, never cut for it.

### `pub mod grafting_procgen_solid_field::bed`

The ground laid to rest under a structure: a road, a floor, a ramp.

The ground is never cut where a structure stands on it. It is moved: up to
just under the structure's faces where it lay a little under them, down to
it where it rose through them, and eased back to where it was over a
shoulder round them -- a cutting through a hill, an embankment over a dip.
Where the structure stands far off the ground -- a bridge over a valley, a
floor over a cliff -- the ground is left as it is. One surface either way:
no hole, no side shared with the structure.

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
form swept along a path -- a capsule, round or squashed, or a column
between two heights; carving takes it out of the solid, filling adds it,
both blended over a width so the lip of a tunnel or the foot of a bridge
rounds off instead of creasing.

### `pub mod grafting_procgen_solid_field::layer`

A layer of earth laid on the ground, taken off it, or the ground levelled
-- the brush's everyday strokes -- as the ground's own surface moved, never
read again off a grid.

```text
faces under the stroke (+ the bare table it reaches, for a layer laid)
  -> lying flat in plan?  yes: the irregular grid laid in plan over them,
                               every corner lifted to the old surface
                               and moved by the stroke
                          no:  the surface itself moved by the stroke
                               (a cave's wall), then laid again on its
                               own chart (`regenerate_surface`)
```

The ring round the faces comes back as the very same vertices, and the
ground beyond it is never touched: a stroke laid over a hill adds to the
hill, a stroke laid beside one never reaches it. No signed distance, no
stitch, no remesh -- the grid the plane's ground is laid with, so the
cells come out the same.

### `pub mod grafting_procgen_solid_field::mesh_distance`

Signed distance to a surface given as faces -- the ground itself.

The distance is to the nearest point of any triangle of the faces; its
sign comes from the angle-weighted pseudo-normal of the feature that point
lies on (Baerentzen and Aanaes), outward meaning air. That is what makes
"inside the hill" a question the ground's own mesh answers, with no height
map beside it: a tunnel under faces nobody is laying again still knows it
is in solid.

A uniform grid of triangle buckets keeps a query to the triangles near it.

### `pub mod grafting_procgen_solid_field::regenerate`

Laying a patch of ground again on its own surface, its shape unchanged:
the repair round a structure, wherever the ground is -- a hillside, the
floor of a cave, the deck of an earth bridge.

```text
faces to lay again (a disk, holes allowed)
  -> holes capped                  (a membrane over each, its rim fixed)
  -> a chart of the surface        (projection where it is one-to-one,
                                    else a mean-value embedding)
  -> the structures' rings, charted (closest point on the surface)
  -> the irregular grid in the chart (the constrained generator, as in the plane)
  -> lifted back onto the surface  (through the chart's own triangles)
```

The cells are relaxed once, in the chart, by the generator itself. A second
relaxation over the surface was measured to leave them no squarer and to
fold a cell at a structure's corner, so there is none.

The ring round the patch comes back as the very same vertices. A corner
the generator puts on a ring or a structure's side is reported with the
two corners of the side it landed on, so whoever owns that side can split
it there.

### `pub mod grafting_procgen_solid_field::table`

The table under the ground: solid below its height wherever no ground
stands over or under that point of the plane. A pile of earth laid on the
bare table rests on it, its foot the ground's new border; a pit dug below
the table's height where ground stands is never filled back by it.

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

### `pub struct grafting_procgen_solid_field::Bed`

What one structure asks of the ground under it.

### `pub struct grafting_procgen_solid_field::EditedSurface`

The faces laid in place of the ones handed in.

### `pub struct grafting_procgen_solid_field::Faces`

Faces, as indices into their own vertices, in whatever winding the
caller's ground uses -- the same for every face.

### `pub struct grafting_procgen_solid_field::GivenPoint`

A point of a structure's ring the new ground goes round, with the caller's
own name for it.

### `pub struct grafting_procgen_solid_field::Landing`

A new corner lying on a side somebody already holds, between `from` and `to`.

### `pub struct grafting_procgen_solid_field::LayerEdit`

One stroke: layers raised or lowered (`Form::Profile`), or columns a level
is filled up to or cut down to (`Form::Column`).

### `pub struct grafting_procgen_solid_field::RegeneratedSurface`

The faces laid in place of the patch.

### `pub struct grafting_procgen_solid_field::Regeneration`

One repair: the rings to go round and the cells to lay.

### `pub struct grafting_procgen_solid_field::Shape`

A form swept along a path, carving or filling.

### `pub struct grafting_procgen_solid_field::SurfaceEdit`

One edit: what to carve or fill, and the cells to lay the result in.

### `pub struct grafting_procgen_solid_field::Vec3`

### `pub struct grafting_procgen_solid_field::bed::Bed`

What one structure asks of the ground under it.

### `pub struct grafting_procgen_solid_field::edit::EditedSurface`

The faces laid in place of the ones handed in.

### `pub struct grafting_procgen_solid_field::edit::Faces`

Faces, as indices into their own vertices, in whatever winding the
caller's ground uses -- the same for every face.

### `pub struct grafting_procgen_solid_field::edit::SurfaceEdit`

One edit: what to carve or fill, and the cells to lay the result in.

### `pub struct grafting_procgen_solid_field::field::Shape`

A form swept along a path, carving or filling.

### `pub struct grafting_procgen_solid_field::layer::LayerEdit`

One stroke: layers raised or lowered (`Form::Profile`), or columns a level
is filled up to or cut down to (`Form::Column`).

### `pub struct grafting_procgen_solid_field::mesh_distance::MeshDistance`

The ground as triangles, ready to be asked how far a point is from it.

### `pub struct grafting_procgen_solid_field::regenerate::GivenPoint`

A point of a structure's ring the new ground goes round, with the caller's
own name for it.

### `pub struct grafting_procgen_solid_field::regenerate::Landing`

A new corner lying on a side somebody already holds, between `from` and `to`.

### `pub struct grafting_procgen_solid_field::regenerate::RegeneratedSurface`

The faces laid in place of the patch.

### `pub struct grafting_procgen_solid_field::regenerate::Regeneration`

One repair: the rings to go round and the cells to lay.

### `pub struct grafting_procgen_solid_field::table::TableFloor`

Where ground covers the plane, and the table's height.

### `pub struct grafting_procgen_solid_field::trimesh::Remesh<'a>`

A triangle mesh with locked vertices and edges, being remeshed.

### `pub struct grafting_procgen_solid_field::vector::Vec3`

### `pub struct grafting_procgen_solid_field::volume::EditField<'a>`

The ground after the edit, as a signed distance.

### `pub type grafting_procgen_solid_field::vector::Vec3::Output = grafting_procgen_solid_field::vector::Vec3`
