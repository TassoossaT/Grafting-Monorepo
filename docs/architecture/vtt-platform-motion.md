# Platforms and consolidated structural motion (#242)

`platform` is a horizontal structural marker with no thickness. Its graph can
represent a base, floor, ceiling or bridge deck. Assets supply appearance. Each
connected cloud has one elevation; upper clouds may have different footprints.
There is no support tree or automatic association based on overlap.

## Creation and contour editing

The **Plataforma** tool accepts a freehand closed contour or successive corner
clicks, closed by clicking the first corner. Its elevation is explicit. **Criar**
creates an independent platform; clicking an existing vertex at the same
elevation deliberately reuses that identity. Wall creation also welds endpoints
to platform vertices in XYZ, including the upper endpoint. Wall welding never
selects a lower storey using XZ alone.

**Ampliar / juntar** adds the uncovered part of the drawn contour to platforms
at the selected elevation. It preserves existing faces as structural seams,
including support vertices that become interior after enlargement. **Recortar /
separar** subtracts the contour and retains holes or disconnected remainders.
Both operations use the existing atomic patch replacement and its history.
Geometry boolean operations run in graph-core, using the existing workspace
version of `i_overlay` behind Grafting-owned types. Boolean simplification
retains original boundary vertices and subdivides seams at intersections.

Only platform faces at the chosen elevation are eligible. Other elevations and
other types are not cut or moved. Surviving shared vertices retain their IDs;
vertices no longer used by a platform remain alive if another type uses them.
Joining different elevations requires moving them first; the tool does not
choose a height for the user. A platform cut does not generate a wall opening
or invoke the still-unsupported wall framing repair.

## Gesture and structural response are separate contracts

| Target / input | Result |
| --- | --- |
| Platform vertex or edge, XZ | Changes that part of the contour; shared incident types respond. |
| Platform body, XYZ | Translates every node of its cloud and transports connected upper clouds. |
| Platform receives Y at any node | Expands that Y displacement through every face in its cloud. |
| Wall base receives movement | Carries the actual upper ends of incident upright boundary edges. |
| Wall top receives Y | Changes the wall height without moving its base. |
| Wall with a hole, base receives Y | The aperture keeps its sill offset and dimensions. |

Direct wall gesture axis restrictions are retained. An indirect elevation from
a platform is not clamped to those gesture axes. Posts cannot collapse, invert,
or become tilted by moving only their upper endpoint sideways. Opening vertices
must remain inside the wall's vertical extent. Invalid edits are rejected as a
whole, with feedback. Connected wall heights must remain greater than `1e-4`
world units. Disconnected platforms may coincide or cross in elevation because
their overlap is not a structural constraint.

In **Editar estrutura → Elevar / baixar**, vertical screen movement changes Y
(40 pixels per world unit). The ordinary mode edits position/contour. A shared
vertex prefers an incident type that permits Y when elevation mode is selected.

## Planning and atomic application

Each `StructureTypeDefinition` can declare `motionInfluences` and
`validateMotion`. These are application semantics; they emit directed identity
links with XYZ masks and validate the resolved positions. Platform faces use
linear-size stars, so shared graph nodes connect the cloud without a second
connectivity authority. Walls use actual incident edges, including subdivided
posts, rather than finding every higher vertex with coincident XZ.

The orchestrator resolves the direct gesture, collects semantic links from a
consistent session state, and submits one `planMotion` query. Graph-core's
finite worklist resolves each node/axis once. Equal demands converge; different
demands on the same axis fail. Zero displacement introduces no demand. Exact
delta equality makes copying independent of visit order. Results are sorted by
identity. Unknown identities and nonfinite values are errors.

After type validation, `moveVertices` validates the complete position batch
before writing. Every node changes once, affected contours are collected once
for the batch, rigidly translated arc centers follow their endpoints, and the
session updates its spatial index once per affected region. The runtime folds
one combined projection/render outcome. The atomic guarantee applies to motion
batches; unrelated legacy mixed topology-op sequences retain their existing
ordered execution contract.

A drag records the original position of every node actually moved, across all
types/clouds. One undo/redo restores the whole affected set. A rejected later
tick retains the history of earlier successful ticks. Planning is recomputed
against current topology on each tick; no cached propagation plan can outlive
its assumptions. Reusing plans remains an optimization, not a correctness
dependency. Standalone legacy `planEdit` callers without a session retain local
policies; platform editing requires the session solver. The actual edit tool
always supplies it.

## Verification

`platform-cascade.test.mjs` executes the real generated WASM module. It covers
the levels 0/3/6 with distinct footprints, base/intermediate/top elevation,
descending limits, shared-node convergence, disconnected overlap, horizontal
transport versus local shape edits, atomic failure, drag history, wall creation
across storeys, bottom edges, apertures, extension, holes and splitting.

`motion_planning.rs` covers axis masks usable by other types, conflicting and
equal cycles, order independence, nonfinite/unknown-node rejection, atomic
failure, arc movement/undo and contour seams. Its 10,000-node graph has 19,997
directed influences with converging paths: exactly 10,000 node/axis resolutions
and 19,997 influence visits. The three-storey WASM scenario submits one planning
call and one mutation batch, with one position per affected vertex.

House composition, pillars, asset thickness, stairs/ramps and terrain policy
changes remain outside this feature. The legacy partition floor/ceiling caps
and their opt-in/elevation/identity work remain with #233; platform creation
uses explicitly scoped XYZ vertex identities and does not depend on those caps.
