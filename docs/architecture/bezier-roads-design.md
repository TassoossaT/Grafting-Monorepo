# Bézier road authoring and junction refinement — #257

The initial refinement was committed as `89a143b` before implementation.
This document records the resulting implementation and its boundaries.
No OPEN decision or future persistence/traffic gate is closed here.

## Problem and authority

The previous path pipeline reduced fitted arcs to endpoint controls in
`groundTrack`, then reconstructed a Catmull-Rom curve. A flat arc reduced to
two controls consequently became a straight chord. The spine stored no edge
curvature, and intersection queries operated on straight chords.

Dedicated Bézier modules now live inside `grafting-graph-core`, following
ADR-0013 and the crate's existing authority. They own curve evaluation,
nearest points, lengths, fitting, subdivision, handle constraints, bounded
removal, network insertion and ribbon derivation. Grafting-owned XYZ arrays
and structs form the public API; vendor types remain private. The existing
construction WASM bridge exposes batched JSON commands. VTT and the lab
consume those commands rather than reimplementing curve calculations.

Reusable offset code formerly owned by procgen curve-offset now lives in
graph-core. The old package remains a compatibility facade. Polygon union
reuses graph-core's existing i_overlay implementation and triangulation uses
the existing earcut dependency. There is one mathematical authority.

## Library evaluation

| Candidate | Evaluation and disposition |
| --- | --- |
| [Kurbo](https://github.com/linebender/kurbo) | Selected at exactly 0.13.1. MIT OR Apache-2.0. Its f64 primitives and accuracy-controlled nearest/length/inverse-length APIs fit the boundary. Native and WASM integration compile. The README warns that APIs and MSRV may evolve, so the dependency is private and pinned behind Grafting contracts. |
| [flo_curves](https://github.com/Logicalshift/flo_curves) | Apache-2.0. Generic coordinate traits, cubic collision queries and path arithmetic make it a credible alternative. Evaluated from its API, not installed or benchmarked. Adding it alongside Kurbo would duplicate primitives without measured benefit. Reconsider if intersection degeneracies require another backend. |
| [Cavalier Contours](https://github.com/jbuckmccready/cavalier_contours) | MIT OR Apache-2.0. Supports offsets, booleans and WASM, using line/circular-arc polylines. This is complementary to cubic authoring. Existing planar union already serves the implementation, so no overlapping dependency is added. |

Sources were checked on 2026-09-09. These observations do not promise future
maintenance of any dependency. No comparative latency or binary-size advantage
over uninstalled alternatives is claimed. Curve command counts, adaptive
sample/depth budgets and network candidate/sample-pair budgets bound resource
consumption; they are not a real-time performance guarantee.

## Authorship and editing

The existing graph remains the topology authority. Each edge stores two
control vectors relative to its anchor IDs, its handle mode and independent
start/end lateral profiles. Surface vertices are derived data. Elevation
changes preserve XZ controls; changing width preserves the authored curve.

- Free handles move independently. Aligned controls share a tangent direction
  with independent lengths; mirrored controls also have equal lengths.
- Automatic anchors recalculate automatic spans in Rust. Explicit manual spans
  are not refitted when adjacent geometry regenerates.
- The paired-handle interaction is limited to unambiguous degree-two
  continuations. Higher-degree junctions retain independent incident handles;
  the implementation does not infer a traffic continuation pair.
- Dragging a segment's midpoint pulls the cubic with fixed endpoints.
  Clicking it inserts an anchor using exact de Casteljau subdivision.
- Removal requires a control-hull error certificate within 0.025 world units.
  It is refused for incompatible profiles, junction anchors or excess error.
- Start/end widths interpolate along the segment. A taper can join different
  approach widths without rewriting curvature. Splitting also splits the
  width profile.
- Closing connects the two ends of an open path. Disconnecting a shared
  anchor opens a loop or separates branches; deleting a segment removes it.

The editor's shape and elevation gestures are separate. Preview does not
mutate confirmed state. Release submits one replacement containing graph
changes and regenerated dependent surfaces; cancel submits none. The same
history entry restores controls, profiles, topology and surfaces.

Legacy implicit chains are converted using the canonical Rust centripetal
conversion, including endpoint reflection. IDs remain stable. Conversion is
persisted with the first accepted edit, not on document inspection. Snapshots
include optional curve payloads; the absence of a payload still identifies
legacy data. This is snapshot/history round-trip support, not a new multiplayer
storage protocol or a decision on GATE-009.

## Connections and surfaces

Insertion queries the actual cubics with explicit position and height
tolerances. Broad snapping uses the brush reach against standing geometry;
new stroke anchors only coalesce within numerical tolerance, preserving tight
authored turns. Candidate intersections are refined against the original
curves. Same-level crossings split both curves and share an anchor; a bridge
at another height remains disconnected. Self-crossings use separate curve
parameters and preserve the loop interval.

Split intervals retain exact controls, with one retaining the original edge
ID. New interval/junction IDs derive deterministically from the operation.
An endpoint snap may move an anchor within the caller's declared reach;
the retained absolute controls are re-anchored accordingly.

The affected connected spine component determines surface replacement.
Ribbon contours are normalized by the existing nonzero planar union before
meshing, including overlap at tight turns. Roundabout surfaces preserve holes.
Nonfinite/unordered widths, stationary tangents and empty normalized contours
are rejected before commit. Splits, removals and deletions prune orphan graph
anchors while preserving nodes referenced by remaining edges or topology.

The implementation does not promise G2, exact circular arcs, unrestricted
sloping-junction height solving or exact classification of coincident/tangent
degeneracies. Numerical intersection candidates and Newton refinement have
those limits. Surface union is separate from connectivity and does not define
traffic lanes, permitted turns, materials or future traffic semantics.

## Lab and evidence

The route is `/lab/trials/bezier-roads`. Fixtures cover arc, S, hairpin, T/X/Y,
roundabout, bridge and width transition. Axes, handles, margins and resulting
junction topology are inspectable. Authored JSON saves/restores locally;
saving also stores a gallery preview through the existing preview storage.

Tests cover subdivision, inflections, length/inverse distance, handle
constraints, certified removal, self-intersection and height separation.
Real WASM session tests additionally cover a roundabout island, crossing and
bridge identity, tapered subdivision, paired controls, invalid-edit rollback,
removal/disconnect/deletion and complete undo/redo. Existing road regressions
cover hairpins, T/X contact, continuation and collapsed snaps.

Public API snapshots and wire contracts are updated alongside bridge changes.
Final verification includes the affected Rust tests, API checks, WASM build,
VTT tests/type checks/docs, Studio checks and generated dependency metadata.
A connected browser was unavailable in this automation session; interactive
visual inspection is not claimed.

## Contour stability

Incident cubics contribute a coplanar bevel join computed in Rust from their
endpoint cross-sections. This fills the outside corner of an L or a closed
circuit instead of leaving a notch down to its shared spine anchor. Joins use
exact graph connectivity; coincident disconnected anchors and bridge levels
remain separate. Straight collinear sections need no additional polygon.

Generated Bézier region IDs encode their contributing corridor IDs separately
from gesture IDs. Regeneration follows both current spine connectivity and the
ownership of standing surfaces, including disconnected remnants. Replacing one
face therefore reconstructs all of its surviving authorship. Bézier scope does
not spread through incidental contour welding, and regenerated contour vertices
are kept separate from authoring anchors and unrelated standing surfaces.

Regression coverage includes angled joins, closed corners with an island,
repeated width edits after segment deletion and after disconnecting separately
authored corridors, plus exact undo/redo of disconnected remnants.

