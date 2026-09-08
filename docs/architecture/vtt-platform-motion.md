# Platforms and consolidated structural motion (#242)

`platform` is a horizontal structural marker with no thickness. Its graph can
represent a base, floor, ceiling or bridge deck. Assets supply appearance. Each
connected cloud has one elevation; upper clouds may have different footprints.
There is no support tree or automatic association based on overlap.

## Creation and contour editing

**Edifícios → Plataforma** shares directed line/arc contours with wall
construction. The circle preset consumes exactly the Tower contour and radius
presets; freehand uses the existing wall stroke fitter (with arcs disabled when
grid snapping is on). Rectangle drag and explicit polygon corners create lines.
Platforms stay independent structural types; selecting this tool does not create
walls or compose a house.

- **Retângulo**: drag from one corner to the opposite corner.
- **Círculo**: select a radius and click the center.
- **Polígono**: click corners, then the first corner to close.
- **Livre / curvas**: drag a closed outline; correction controls fitting.

**Criar** uses the chosen elevation. **Ampliar / juntar** and **Recortar /
separar** use the elevation of the platform where the gesture starts, or the
chosen elevation when starting elsewhere. To enlarge, draw across the existing
boundary into the new area. Empty/degenerate gestures and absent target levels
produce feedback; a fully covered extension is a no-op.

Surviving vertices retain their identities. Explicitly picked vertices at the
drawing elevation may connect; picking the ground below never welds floors.
Wall creation welds endpoints to platform vertices in XYZ, including the upper
endpoint, without selecting another storey by XZ alone.

The analytic boolean query lives in graph-core and uses the existing contour
intersection primitives for line/line, line/arc and arc/arc crossings. It retains
arc centers and sweep directions instead of tessellating the graph into chords.
Outer/hole winding is accepted in either direction; coincident boundaries and
tangent contacts are handled. Its positional tolerance is 1e-5 world units.
No new geometry dependency is introduced. The older polygon-only query remains
available to its existing callers.

Extension retains source faces as structural seams and adds uncovered area.
Cutting supports holes and disconnected remainders. Splitting includes original
vertices and analytic crossings, so support vertices remain cloud members after
enlargement. Candidate faces are restricted to the target elevation; faces whose
directed boundary spans do not change keep their identities and render items.
Other types are never cut or moved by contour booleans. Removed platform nodes
stay alive if another type still uses them.

Each completed gesture applies one atomic replacement with one undo/redo entry.
The dispatcher consumes the release position, suppresses the native click after
a drag, and clears unfinished polygon drafts on Escape, cancellation, tool
switch or unmount while releasing capture.

A platform cut does not create a wall opening or invoke wall framing repair.
Different elevations must be moved together before joining; the tool never
flattens several storeys to a height of its choosing.

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
for the batch, arc centers follow the similarity between the old and new endpoint chords, and the
session updates its spatial index once per affected region. The runtime folds
one combined projection/render outcome. A single-endpoint shape edit retains a valid circular arc and its sweep; collapsed arc chords reject the batch. The atomic guarantee applies to motion
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
It also covers circular/freehand creation, mixed line/arc cuts, extension from
a picked elevated floor, endpoint editing, and untouched distant identities.

The pointer lifecycle test runs the actual hook and platform tool against WASM
with only React scheduling and render/pick adapters substituted. It verifies
the final release sample, one commit per drag, suppressed trailing clicks,
Escape, draft reset, unmount and capture release.

Rust curved boolean tests exercise coincident/tangent circles, winding reversal,
exact intersections, structural seams, holes and a grid of rotated crossings.

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
