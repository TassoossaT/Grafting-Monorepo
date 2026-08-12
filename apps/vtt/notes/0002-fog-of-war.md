# Note 0002 — Fog of war: the design, and what the engine must not preclude

- Recorded: 2026-08-07
- Status: original design recorded and refined by research; deliberately not
  implemented; roadmap task `E2.4` remains open
- Owner's framing: "é algo que eu devo fazer bem para o futuro, pois será bem
  complexa" — this is written to be picked up later without re-deriving it

Research consolidation:
`docs/research/vtt-perception-memory-and-fog-of-war.md`
(`VTT-FOG-RESEARCH-001`).

The three-state model below is the historical seed, not an implementation enum.
The research record separates evidence modality, disclosure level, temporal
relation, spatial precision, and presentation. An implementation MUST NOT use
current secret geometry as remembered state and MUST NOT treat sound, memory,
and direct vision as equivalent.

Nothing here is built. The purpose is that the decision exists in writing
before the code does, and that `@grafting/render-3d` does not quietly make it
impossible in the meantime.

## The design

Three states of knowledge, not two:

| State | Meaning | Treatment |
| --- | --- | --- |
| **Unknown** | never seen, never heard | literal fog — an opaque volume, nothing beneath it readable |
| **Remembered** | seen before, or inferred from sound or another sense, but not currently observed | **silhouette as a point cloud** — shape and volume legible, surface detail absent |
| **Observed** | currently within a sense's reach | drawn normally |

The middle state is the interesting one, and the reason to write this down.

### Why a point cloud for the remembered state

A point cloud conveys silhouette and volume while being **structurally
incapable of carrying surface detail**. That is not an aesthetic choice; it is
what makes it the right primitive. "You remember the shape, not the specifics"
stops being a rule someone has to implement correctly and becomes a property of
the medium — there is no path by which detail leaks, because the representation
has nowhere to put it.

Most tabletops render the remembered state as greyed-out or dimmed terrain,
which is weaker: dimming is a filter over complete information, so every
question about what exactly stays hidden has to be answered by hand, and each
answer is a place to get it wrong.

The visual reference is deck.gl's `PointCloudLayer`:

- <https://deck.gl/examples/point-cloud-layer>
- <https://github.com/visgl/deck.gl/tree/9.3-release/examples/website/point-cloud>

**Reference, not dependency.** `docs/research/vtt-map-and-terrain-construction-options.md`
already settled this: deck.gl is a technique reference and Three.js is the sole
renderer. Point clouds are native to Three.js (`THREE.Points` +
`THREE.PointsMaterial`, millions of points on desktop), so replicating the
technique costs nothing and reopens nothing.

## What changed in the engine because of this note

One thing, and it is deliberately generic.

`MaterialDescriptor` gained a `points` surface. Before it, the engine could
build meshes and wireframes only — the remembered state was not merely
unimplemented, it was **inexpressible**, and discovering that after building
fog of war would have meant reopening the visual contract.

It pairs with *any* geometry, which is the part that matters:

```ts
// The same terrain, remembered rather than observed. No second copy of the
// data, no separate "silhouette mesh" to keep in sync.
{ geometry: { shape: "heightfield", field }, material: { surface: "points", size: 0.4 } }
```

Nothing in the engine mentions fog, memory, or visibility. It gained a way to
draw points, which is equally a scan, a particle field, or a preview of data
not yet resolved. The fog is assembled by the product from that primitive.

## What the engine must not preclude, and where it currently stands

### 1. Per-viewer divergence — the real architectural question

Fog is per-viewer by definition: the GM sees everything, and two players may
have explored different rooms. The engine's `scene` is global, and
`scene.setVisible()` applies to every view.

**This is less of a problem than it first appears.** In deployment each browser
shows one viewer: the player's client renders the player's fog, the GM's client
renders the GM's. A global scene per client is exactly right, and the engine
handles the primary case today with no change.

Per-view divergence is needed only for the GM previewing *what a specific
player currently sees*, side by side with their own view. That is a real
feature and a secondary one.

**Do not build it pre-emptively.** When it is needed, the cheap generic
primitive is a per-view item filter — `View.setItemFilter(predicate)` — not a
fog concept in the engine, and not one engine per viewer, which would forfeit
the single-context design for a preview panel. Recorded so the eventual
implementer does not conclude the architecture forbids it. It does not.

### 2. The fog volume itself

The unknown-state fog can be built today from ordinary geometry with an
`unlit` material at partial opacity — crude but functional, and enough for a
first pass.

A *good* fog — soft edges, animated drift, dithered boundaries — needs either a
shader material descriptor or a post-processing pass. Neither exists.
`postprocessing` (pmndrs) is recorded as a candidate in
`docs/research/render-3d-engine-libraries.md`, flagged Zlib rather than MIT and
pending a license review.

### 3. Reveal cost

Fog changes constantly — every step a token takes edits it. The engine's
default equality is reference-based, so handing it a new array rebuilds the
whole cloud. At map scale that is the wrong shape.

Whatever implements this needs partial buffer updates rather than a rebuild per
reveal, and the measurement to prove it. This is the same category as the
already-recorded debt in note 0001 section 5.

### 4. Line of sight has to come from somewhere

Deciding *which* cells are observed is a geometry problem — casting from each
sense's origin against occluders. `three-mesh-bvh` (MIT) provides `shapecast`
for exactly this, and the same library covers area-of-effect and range queries.
Recorded as the first-pick candidate in the research document above.

Doing it by hand means writing and maintaining a spatial acceleration structure
for a problem that has a well-tested MIT answer.

## What to decide before implementing

- **Is fog tied to the grid?** gTove (MIT, the closest web analogue) requires a
  defined grid before anything can be hidden, which simplifies the
  implementation enormously. Deciding this late is expensive.
- **What resolution is remembered state stored at?** Per grid cell, per object,
  or per surface sample — this determines whether the point cloud is generated
  from the terrain's own vertices or from a separate sampling.
- **Does sound produce the same remembered state as sight?** The owner's
  framing includes hearing. If a heard event yields a weaker state than a seen
  one, three states become four.
- **Who is authoritative?** Fog is per-player knowledge, so it is replicated
  state, not local presentation — which puts it under DEC-013's model and note
  0001 section 2's requirement that every change carry its origin.
