# Roof construction — agreed behavior for #232

Status: implementation in progress. This specification records the owner's
decisions from the construction discussion; it does not change ADR-0022 or
declare the editor feature complete.

## Authoring contract

A roof is a construction type. Its cloud has one horizontal base elevation.
Touching roof footprints at that elevation unite, and the covering is recomputed
over the combined contour. Roofs at different base elevations remain separate.
Regeneration may reposition ridges. The resulting cloud is derived from the
authoritative graph, never a separately persisted building model.

The user controls maximum height above the base, rather than pitch. Enlarging
the contour preserves that height. When roofs unite, the larger maximum height
wins. Height is shared by the entire roof, not independently authored at every
ridge or junction. This delivery does not add a height handle.

Overhang uses a global application value, without a per-roof control. A future
per-band control is not part of this implementation contract. The numeric
default was not specified in the discussion.

Both curved footprints and curved elevation profiles are required. Each face
has its own curvature. A circular tower covering consists of four leaves,
aligned with the four quarter-circle side panels, rather than one circular
face. Neighboring leaves remain connected even when their curvatures differ.

Creation on a platform and creation accompanying rooms or towers must ultimately
use the same roof type and geometry rules. Room generation and automatic room
partitioning are separate from this roof implementation.

## Geometry foundation

`grafting-graph-core::profile_surface` evaluates analytic line/arc sections and
bounded elevation profiles. Curvature changes the rise between the sections,
without moving their elevations. Each sheet has its own middle profile; shared
side values currently use the average of incident middle values with smooth
interpolation across the sheet. This is an implementation choice for continuous
seams, not an assertion about Tiny Glade's algorithm.

`grafting-graph-core::profile_cap` produces four sheets for rectangular and
circular bases. Rectangles have a ridge along the longer axis; circles keep four
analytic quarter-circle sections meeting at one apex. This generator does not
yet solve unions, arbitrary concave footprints, or holes. It must not be used as
a bounding-box approximation of those shapes.

`grafting-procgen-surface-mesh::profile` derives transient meshes from sheets.
Tessellation vertices are not construction vertices or additional logical faces.
Each leaf remains one sheet regardless of rendering subdivision. Shared seams
use the same rise subdivision; collapsed apex triangles are omitted.

The foundation alone is not the editor feature: graph-backed profile ownership,
cloud regeneration, same-level contour unions, platform/tool integration, and
editing transactions must be connected and verified before #232 can close.
The existing geometry ownership contract remains authoritative during that work.

## Acceptance examples

- A rectangular base has four connected faces and the requested maximum height.
- Resizing a base changes slope, while preserving its authored maximum height.
- Four circular leaves preserve the exact analytic base radius and meet at the
  same apex; different face curvatures do not introduce cracks.
- Two roofs at the same base unite, adopting the larger height, without retaining
  interior overhangs. A roof at another level is unaffected.
- An L-shaped union covers the actual L, including its inner corner, without
  filling the missing quadrant. Circular/rectangular unions retain curved parts.
- Regeneration preserves surviving face curvature assignments. Creation,
  regeneration, undo and redo operate as atomic construction transactions.
- There is no height handle or individual overhang control in this delivery.

Research: [construction elements](../research/construction-elements-online-research.md).
Architecture: [ADR-0022](../adr/ADR-0022-wall-representation-free-geometry.md) and
[VTT application architecture](vtt-application-architecture.md).
