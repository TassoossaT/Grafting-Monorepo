# Bezier road authoring and junction refinement — issue #257

Status: implementation proposal, prepared before code changes. This document
does not close an OPEN decision or assert that the acceptance scenarios pass.

## Observed problem

`apps/vtt/src/features/edit-construction/structure-types/path/path-reference-line.ts`
reduces each fitted edge to its endpoints in `groundTrack`. An arc on flat
terrain can consequently become two controls. `plan-spine-contour.ts` then
uses Catmull-Rom, so that input produces a straight chord. `spine-graph.ts`
explicitly stores no edge curvature, and `materialize-spine.ts` computes
intersections and snapping against straight chords in XZ. Its proximity
queries do not enforce a separate height tolerance.

Fixing only display tessellation cannot supply durable authoring handles or
make those connectivity queries follow the actual curve.

## Capability boundary

Implement a dedicated public Bezier module inside the existing
`grafting-graph-core` crate. Its local AGENTS.md requires one coherent crate
until a measured deployment/versioning boundary justifies separation. The
module owns generic curve calculations; no road, material, UI or terrain
vocabulary belongs in its API. Public values use Grafting-owned types, with
any third-party curve implementation private.

Expose batched authoring/planning commands through the existing construction
WASM bridge. The bridge parses and validates wire data and calls Rust. VTT
ports and adapters translate those commands; TypeScript must not reimplement
evaluation, fitting, nearest-point queries, subdivision or intersections.
The lab must call the same capability as the product.

Kurbo is the first dependency candidate and flo_curves the alternative named
in #257. A source-backed evaluation of licensing, numerical accuracy,
degeneracies, WASM cost and maintenance remains required before selection.
Cavalier Contours is only a candidate for a demonstrated missing offset or
boolean capability. No dependency is selected by this document.

## Source of truth and editing

Retain the existing construction graph as the topology authority. Each
authored cubic edge refers to two existing anchor IDs and stores its own two
control vectors relative to the respective anchors. Junction degree does not
limit the number of independent incident handles. Moving an anchor carries
its incident handles without refitting the rest of a path.

Automatic, aligned, mirrored and free modes are explicit authoring state.
For a degree-two continuation, aligned means opposite collinear vectors;
mirrored additionally means equal magnitudes. Automatic mode calculates
handles in Rust. A manual drag leaves automatic mode. At a higher-degree
junction, continuity constraints name an explicit pair of incident ends;
there is no global handle pair shared by all branches. G1/C1 constraints do
not imply G2 or exact circular arcs.

Widths and elevation profiles belong to separate authored attributes, not
to tessellation vertices. Cubic parameters locate elevation/width samples;
geometric evaluation must consult those profiles during intersection and
surface generation. A width change does not rewrite curvature handles.

Inserting a point uses de Casteljau at the selected parameter. Preserve the
old edge ID for one resulting interval, mint the other interval and anchor
IDs deterministically from the operation, and return an explicit selection
remap. Removal may fit a replacement only within a supplied error bound;
otherwise refuse and retain the original. Pulling a point on a segment is a
constrained Rust operation with fixed endpoints and deterministic control
adjustment, rather than a whole-path fit on every pointer move.

Preview stays separate from confirmed state. Pointer release submits one
operation containing authored geometry, topology changes and regenerated
surfaces. Cancel submits none. Rejection leaves the previous state intact.
Undo/redo restores handles, profiles, IDs, constraints and generated surfaces
together through the existing history mechanism.

## Legacy data

Distinguish legacy implicit Catmull-Rom edges from explicit cubic geometry.
Convert the legacy chain using the existing evaluator's actual endpoint and
parameterization rules, preserving its shape and anchor IDs. Do not treat a
legacy curved chain as independent straight segments. Persist the converted
handles with the first accepted edit, never merely because a document was
opened. Existing snapshot/history adapters need round-trip coverage for the
new optional data. This does not select a future multiplayer persistence
protocol or close GATE-009.

Authorship anchors and handle IDs remain separate from regenerated surface
vertices. Rendering, picking and selections must use that distinction.

## Network and surface rules

All query inputs include finite, positive position and height tolerances.
The editor supplies its snapping reach independently from numerical curve
accuracy. Curve bounds and subdivision support candidate queries; XZ overlap
alone never creates connectivity.

1. Detect an intentional endpoint snap or a crossing of actual curves.
   Evaluate both elevation profiles at the candidate parameters. Reject a
   connection outside the height tolerance. Coincident spans require an
   explicit overlap result, not an arbitrary collection of intersection hits.
2. Split interior hits exactly, reuse or mint a shared junction anchor, and
   retain independent handles on each incident end. Deduplicate repeated hits
   by parameter and position tolerances in a stable order. Preserve a chosen
   smooth continuation when splitting one existing branch.
3. Compute approach directions and widths from the curves/profiles. Order
   approaches deterministically around the junction and derive trim limits
   from the shared approach footprints. Sample elevation on the same limits.
4. Reuse the existing band contour union and hole-aware triangulation pipeline
   where its contracts suffice. Union only connected, same-level approaches.
   One common junction patch replaces overlap, so branch interiors do not
   leave duplicate coplanar faces. Shared seam vertices use identical position,
   height and normal data. Material/UV policy stays with the product.
5. Regenerate the connected affected neighborhood from authoring data. Never
   feed a previously unioned boundary back as an authored axis. Retire replaced
   surfaces atomically and reclaim only unreferenced generated geometry.

A two-branch connection with different widths uses a bounded transition zone
on the adjacent spans; the zone must fit before neighboring junctions. A
short span that cannot accommodate it produces a diagnostic and refuses the
edit, rather than silently creating an inverted ribbon. The same principle
applies when adjacent junction trim regions overlap: merge a valid shared
junction region or reject the proposed geometry as unsupported.

T, X and Y connections use the same incident-edge model. Bridges and tunnels
whose elevations exceed the connection tolerance remain separate even when
their projected ribbon polygons overlap. A roundabout is a closed authored
path with access branches; its surface is an annulus and the interior island
remains a hole. Closing a path must not imply filling its interior.

Detect offset cusps, inversions and self-intersections before committing a
surface. More tessellation does not repair an invalid offset. Until an
explicit topology repair is supported, return an actionable diagnostic and
keep the last valid geometry. Multi-level or incompatible sloping junctions
must likewise be refused rather than flattened implicitly.

Disconnect and delete operations update both connectivity and dependent
surface ownership. A junction surface is not a traffic turn-permission graph;
lane movements remain additional product semantics.

## Acceptance and verification

- Curve contracts: finite-input validation, degenerate spans, endpoints,
  tangents, arc length/inverse distance, nearest-point and intersection error,
  deterministic fitting, handle constraints and bounded removal.
- Shape tests: arc-like curve, S inflection, hairpin and closed loop; exact
  insertion across several parameters and sampling tolerances. Midpoint-only
  flatness is insufficient for an S curve.
- Network tests: T/X/Y, oblique approaches, unequal widths, roundabout island,
  bridge separation, coincident spans, short approaches, overlapping junction
  areas and invalid offsets. Assert topology and surface ownership as well as
  positions; count orphan/duplicate faces and verify shared seams.
- Editor tests: move anchor/handle, pull segment, insert/remove, close/open,
  disconnect/delete, cancel, reject and undo/redo; verify stable selection
  remaps and save/restore of manual edits.
- `/lab` exposes editable axes, handles, margins, junction trim limits and
  diagnostics using the production Rust capability. The acceptance fixtures
  above must be inspectable there.
- Update reviewed public API snapshots and wire contracts; run graph-core
  tests, api-check, WASM checks/build, VTT check/test/build/docs generation and
  checking, applicable Studio checks, and Graph IR generation/checks when
  topology or project metadata changes. No check is claimed by this proposal.

## Current implementation state

This refinement is recorded before implementation as requested by #257.
Code changes and dependency evaluation remain outstanding. The mandatory
`ia-graft delegate` research/edit provider returned RESOURCE_EXHAUSTED on
2026-09-08; this is a tooling availability problem, not an architecture gate.
