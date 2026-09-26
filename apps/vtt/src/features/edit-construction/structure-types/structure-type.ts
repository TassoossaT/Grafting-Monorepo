import type { ApplyPatchReplacementRequest, BezierPort, ConstructionEdgeGeometry, ConstructionGraphPatch, ConstructionMotionInfluence } from "@/ports";
import type {
  ConstructionGraphSnapshot,
  ConstructionNodeId,
  ConstructionRegionEdge,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import type { AtomicEditOp, EditAxis, EditGesture, EditTarget } from "../orchestration/atomic-edit.ts";
import type { CloudTopology } from "../topology/construction-cloud.ts";
import type { CreationInteraction } from "./creation-interaction.ts";
import type { EffectKind, ReactionId } from "../effects/effect.ts";
import type { SpineGlobalHandleKind } from "../spine/spine-handle-ids.ts";
import type { PlanarArea } from "../topology/planar-area.ts";
import type { FieldPort } from "./path/contour/curve-projection.ts";

/**
 * A role is this app's own name for "what a particular node/edge of a
 * generated shape means" -- `"wall-bottom-corner"`, `"tower-rim-edge"`.
 * Deliberately a plain string: the engine never sees one, never returns one,
 * and never validates one. Each structure-type file mints its own.
 */
export type EditRole = string;

/** What a role's policy allows a gesture to do. */
export type EditResolution =
  /** Apply the op as computed, subject to `axes`. */
  | { readonly kind: "allow" }
  /** Refuse the gesture outright; nothing reaches the engine. */
  | { readonly kind: "deny"; readonly reason: string }
  /**
   * Escalate to a whole-region regeneration instead of an atomic op -- the
   * organic case. Terrain has no meaningful fixed "this vertex is always the
   * corner," so a terrain "edit" is a fresh generation call replacing the
   * region, not a sequence of primitives.
   */
  | { readonly kind: "regenerate"; readonly reason: string };

/**
 * How far a gesture on this role reaches.
 *
 * `ADR-0022` settles the default: the cloud is what editing operates on,
 * never a face in isolation. A role is `"surface"` only where the grabbed
 * part genuinely belongs to one face and to no other -- a panel's own
 * corner is that panel's corner, and moving it moves whatever else happens
 * to reference the node, which is a consequence of the graph rather than a
 * scope decision. `"cloud"` is for the roles that name the *whole thing*:
 * grabbing a wall's body means the wall, not the one panel under the
 * pointer.
 */
export type EditScope = "surface" | "cloud";

/**
 * One role's complete editing policy: what it allows, how far it reaches,
 * what constrains the op's own parameter, and what else fires in the same
 * transaction.
 */
export interface RolePolicy {
  readonly role: EditRole;
  readonly resolve: EditResolution;
  /** Axes the gesture's delta survives on. Ignored when `resolve` is not `"allow"`. */
  readonly axes: readonly EditAxis[];
  /**
   * Whether the op applies to the grabbed face alone or to every member of
   * its cloud. Declared per role rather than defaulted, so a new structure
   * type states its reach on purpose instead of inheriting whichever answer
   * happened to be cheaper -- the same posture the axes list already takes.
   */
  readonly scope: EditScope;
  /** Whole-object translation also transports connected support clouds horizontally. */
  readonly transport?: boolean;
  /**
   * Extra ops fired alongside the primary one, as one transaction -- e.g.
   * moving a wall's bottom corner moves its paired top corner by the *same*
   * delta. Same-delta cascades are all this model needs so far; there is no
   * scaled or cross-axis variant.
   */
  readonly cascade?: (context: CascadeContext) => readonly AtomicEditOp[];
  /**
   * Extra ops matched by a type's own declared value or trait across the
   * *whole table*, not the grabbed cloud -- the opportunistic case, where
   * what reaches together is decided at gesture time by comparing current
   * state, not by any standing weld. A wall's per-segment height widget uses
   * this to raise every other wall currently level with the one grabbed.
   *
   * Applied unconditionally, unlike {@link cascade}: the solver path
   * (`edit-orchestrator.ts`) supersedes `cascade` whenever the type also
   * declares `motionInfluences`, because that path derives structural
   * cascades from the influence graph instead. A `groupCascade` match is not
   * structural -- no influence link could express it -- so it is never
   * superseded.
   */
  readonly groupCascade?: (context: CascadeContext) => readonly AtomicEditOp[];
  /**
   * Present when the grabbed edge's curve may be reshaped through a curve
   * handle, returning the extra ops that reshape alongside it in the same
   * transaction -- a wall's top run following its bottom run. Absent means
   * the edge keeps the curve it has.
   */
  readonly reshape?: (context: ReshapeContext) => readonly AtomicEditOp[];
  /**
   * Narrows the gesture's delta past what whole world {@link axes} can say:
   * onto a direction the type reads off its own shape at gesture time -- a
   * ramp's corner sliding only along its own edge. Applied after `axes`,
   * before anything else sees the delta.
   */
  readonly constrain?: (context: ConstrainContext) => ConstructionPosition;
}

/** What a role's {@link RolePolicy.constrain} gets to look at. */
export interface ConstrainContext {
  /** The face the gesture landed on. */
  readonly topology: ConstructionRegionTopology;
  readonly target: EditTarget;
  /** The delta already constrained by the role's own axes. */
  readonly delta: ConstructionPosition;
}

/** What a reshape cascade gets to look at: the whole cloud, the edge and the geometry it is taking. */
export interface ReshapeContext {
  readonly cloud: CloudTopology;
  readonly edgeId: string;
  /** The new geometry, walked from the edge's own start node. */
  readonly geometry: ConstructionEdgeGeometry;
}

/**
 * What a cascade gets to look at when deriving its extra ops.
 *
 * The whole cloud, not only the grabbed face: a cascade exists precisely to
 * reach parts the gesture never named, and a panel welded onto a neighbour
 * shares its column with that neighbour. Reading one face would make the
 * answer depend on which of two panels the pointer happened to land on.
 *
 * A swept product needs the same reach for its own reason -- one station
 * runs through every band it was built from, and the rim belongs only to
 * the outermost -- which is why there is no second "related regions" list
 * beside this one. The cloud already *is* that list, resolved by the layer
 * whose job it is (`construction-cloud.ts`) instead of recomputed by
 * whichever tool happens to be calling.
 */
export interface CascadeContext {
  readonly cloud: CloudTopology;
  /** The face the gesture landed on -- `cloud.seed`, offered directly for the common case. */
  readonly topology: ConstructionRegionTopology;
  readonly target: EditTarget;
  /** The delta already constrained by the role's own axes. */
  readonly delta: { readonly x: number; readonly y: number; readonly z: number };
  readonly graphSnapshot?: ConstructionGraphSnapshot;
  /**
   * Every region topology the plan can see: the whole table when the
   * session is at hand, only the grabbed cloud's members otherwise. A
   * `groupCascade` reaches through this for matches outside the grabbed
   * cloud -- e.g. every wall currently level with the grabbed one, wherever
   * it stands -- which a cloud, scoped to one connected same-type run, can
   * never contain by construction.
   */
  readonly allTopologies?: readonly ConstructionRegionTopology[];
}

/**
 * What a `"cut"` actually did to one ground type -- the seam its lattice
 * regeneration now needs to close by welding onto the changed cloud's own
 * geometry, not merely echoing its position.
 *
 * Painter-agnostic: the `"lattice-regenerate"` reaction assembles it from the
 * effect that reached it (`effects/effect.ts`), and hands it to the
 * regeneration. This shape is that hand-off, not the repair, which needs a
 * runtime this pure layer does not have.
 */
export interface CutFallout {
  /**
   * Every live node of the painter's own type, real graph nodes with real
   * ids -- not a bare outline of numbers, and not only the handful *this one
   * submission* happened to (re)declare.
   *
   * A repair needs these to name the far side of the hole. The engine
   * considers an edge free-boundary only when **both** of its nodes are in
   * the scope it was asked about, and the hole a cut leaves is bounded by the
   * covered type's surviving rim on one side and the painter's own contour on
   * the other -- so a repair naming only its own nodes finds no closed loop
   * at all, and the cut visibly happens while nothing regenerates.
   *
   * Every live node of the type, not the current submission's own: a brush
   * resubmits only its latest increment each tick, and most of an
   * established cloud's boundary near a given hole was registered several
   * ticks ago and never named again. Scoping to the increment leaves most of
   * the hole's far side unnamed, which is the same failure by a slower route.
   */
  readonly paintedNodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[];
  /**
   * The painter's own faces, each as its own boundary loop of real oriented
   * edges, in that face's own walk order.
   *
   * A cut can leave the painter standing *inside* the ground it removed --
   * a road drawn across the middle of a field, reaching none of its borders.
   * The engine reports the hole's outer rim and stops there, correctly: it
   * tells a gap from an outline by which side the neighbouring faces lie on,
   * and a face alone in the middle of a hole reads as an outline, not as
   * something to fill. A repair mending the outer rim alone therefore lays
   * ground straight across the painter -- the two banks joined over the top
   * of the road instead of stopping at its contour. These are what let it
   * open around the painter instead, and they are edges rather than
   * positions because the mend has to *reuse* them: the painter already holds
   * one side of each, and the repair takes the other.
   */
  readonly paintedLoops: readonly (readonly ConstructionRegionEdge[])[];
  /** Exactly the regions this cut consumed -- the covered type's own to delete and repair around. */
  readonly consumedSurfaceKeys: readonly ConstructionSurfaceKey[];
  /**
   * The XZ shape the cut was asked about -- the painter's own footprint.
   *
   * A repair that regrows ground through the same generator the sculpt brush
   * uses needs an *area*, because that generator is driven by one: it asks the
   * engine what the area covers, gathers the connected ground around it, and
   * bounds everything it does by that extent. Without it a repair can only
   * guess an extent from the faces it was handed, which is the hole and not
   * the cut.
   */
  readonly footprintOutline?: readonly (readonly [number, number])[];
  /**
   * The painter's `surfaceType`.
   *
   * The repair reads the painter's standing contour again for itself, scoped
   * to its own working extent, rather than trusting {@link paintedLoops} to be
   * the right *scope* -- those are assembled by whoever dispatched the cut and
   * may reach further than the ground being regrown.
   */
  readonly painterSurfaceType?: string;
  /** Ground vacated by the painter that should be restored to terrain. */
  readonly vacatedGround?: PlanarArea;
}

/** What a spine owner is handed to regenerate its surface after a spine edit. */
export interface SpineRegenerationInput {
  /** The graph before the edit, already prepared by the owner. */
  readonly snapshot: ConstructionGraphSnapshot;
  /** What the edit does to the spine. */
  readonly graphPatch: ConstructionGraphPatch;
  readonly topologies: readonly ConstructionRegionTopology[];
  readonly port: BezierPort;
  /** The engine, which elevates every contour vertex the plan-view union hands back flat. */
  readonly field: FieldPort;
  readonly operationId: string;
  readonly tableId: string;
}

/** The replacement a spine owner commits, and the curve it previews while dragging. */
export interface SpineRegeneration {
  readonly request: ApplyPatchReplacementRequest;
  readonly preview: Float32Array;
}

/**
 * How a type is generated along a spine (`features/edit-construction/spine`):
 * the same control nodes and bezier spans for every owner, regenerated into
 * whatever surface this type makes of them.
 */
export interface SpineGeneration {
  /** The width a span with no profile of its own is given. */
  readonly defaultOffsets: readonly number[];
  /**
   * The spine's points move in plan only: the owner derives every height
   * itself on regeneration, so a drag keeps the grabbed point's own height
   * instead of taking whatever lies under the pointer, and never snaps onto
   * another network's node by position. Heights still change on purpose, in
   * elevation mode.
   */
  readonly planOnly?: boolean;
  /**
   * The whole-spine handles this owner's spines show (`spine-global-handles.ts`):
   * a pivot that moves it, a height handle at its far end, a turns handle
   * that winds a spiral. None for a network whose connected spine is many
   * structures at once -- a road grid would move as one.
   */
  readonly globalHandles?: readonly SpineGlobalHandleKind[];
  /**
   * What winding a spiral on or back keeps: its grade (more turns climb
   * higher -- the default) or its far end's height (more turns climb gentler).
   */
  readonly windKeeps?: "grade" | "height";
  /** Normalizes the standing graph before an edit reads it -- legacy data, say. */
  readonly prepare?: (snapshot: ConstructionGraphSnapshot, port: BezierPort) => ConstructionGraphSnapshot;
  readonly regenerate: (input: SpineRegenerationInput) => SpineRegeneration | undefined;
}

/**
 * A tag a structure type carries so other code can ask what the type *is for*
 * without naming it.
 *
 * This is the only vocabulary for relations between types. A platform does
 * not cut `"terrain"`; it cuts whatever is `"ground"`. A new kind of ground
 * joins every existing relation by declaring the trait, with no edit anywhere
 * else. The set is closed on purpose: adding a trait is a deliberate design
 * change, not a string a caller invents.
 */
export type StructureTrait =
  /** Natural ground: what platforms and paths carve, what paths ride, what terrain restacks onto. */
  | "ground"
  /** A level sheet other structures land on and weld to: wall corners, ramp ends, a roof's base. */
  | "floor"
  /** An upright run other runs weld their columns onto. */
  | "partition"
  /** Subtracts its own area from every face its nodes are pinned to. */
  | "cuts"
  /** Can be cut by a `"cuts"` region pinned to it. */
  | "accepts-cuts";

/**
 * What a type is shown of another type it meets: its traits and a label for
 * messages, never its name. Handing reactions this instead of a type string
 * is what keeps a type from branching on another type's identity.
 */
export interface StructureView {
  readonly label: string;
  readonly traits: ReadonlySet<StructureTrait>;
}

/** What a type's derived motion may consult beyond the positions themselves. */
export interface MotionContext {
  readonly graphSnapshot?: ConstructionGraphSnapshot;
  readonly port?: Pick<BezierPort, "curveBatch">;
}

/**
 * One structure type's definition -- which is to say, **what a cloud of this
 * type does**, since the cloud is what the type names (`ADR-0022`, and
 * `construction-cloud.ts`). Nothing below is a property of a single face;
 * a face only carries the string that selects this table.
 *
 * It pairs the halves the design doc keeps together on purpose:
 *
 * 1. **How it is created** -- which generation call produced it, in what
 *    expected shape.
 * 2. **The role table derived from that shape**, each role declaring its own
 *    reach. Because this side *asked* for a specific shape, it already knows
 *    by construction what index 0 of the engine's deterministically-ordered
 *    response means. Nothing travels back from Rust to say so.
 * 3. **How it meets every other type** when painted over one.
 *
 * A tool preset -- "a tower," "a house" -- is not a type and never appears
 * here. A preset chooses parameters and a generator; the geometry it
 * produces lands in a cloud whose type is one of these, and that cloud is
 * where its behaviour comes from. This is why a tower needs no editing code
 * of its own.
 */
export interface StructureTypeDefinition {
  /** The `surfaceType` the engine reports for regions of this kind. */
  readonly surfaceType: string;
  readonly label: string;
  /** What this type is for, as other types and tools see it. See {@link StructureTrait}. */
  readonly traits: readonly StructureTrait[];
  /**
   * Whether a gesture on this type can only be planned through the session's
   * structural motion solver. Without one, such a gesture is refused instead
   * of applying a partial move.
   */
  readonly requiresMotionSolver?: boolean;
  /** Responses to received motion, independent of direct gesture constraints. */
  readonly motionInfluences?: (topology: ConstructionRegionTopology, transport: boolean) => readonly ConstructionMotionInfluence[];
  /**
   * Positions this type derives for its own unmoved nodes once motion has
   * been resolved -- a shape that bends with a received move instead of
   * kinking at it. Handed every face of the type, since the shape may span
   * faces the move never reached. Derived moves do not propagate further.
   */
  readonly deriveMotion?: (topologies: readonly ConstructionRegionTopology[], positions: ReadonlyMap<string, ConstructionPosition>, context: MotionContext) => ReadonlyMap<string, ConstructionPosition>;
  /** Present when this type is generated along a spine. */
  readonly spine?: SpineGeneration;
  /** Returns a reason when a proposed position batch violates this type. */
  readonly validateMotion?: (topology: ConstructionRegionTopology, positions: ReadonlyMap<string, ConstructionPosition>) => string | undefined;
  /**
   * How this type is generated, recorded next to the roles it implies --
   * the doc's whole point is that these two halves must not drift apart.
   */
  readonly creation: string;
  /** Resolves what the grabbed part of this region means. */
  readonly roleFor: (topology: ConstructionRegionTopology, target: EditTarget) => EditRole;
  /** The policy for one role. */
  readonly policyFor: (role: EditRole) => RolePolicy;
  /**
   * What happens when **this** type is painted over `covered` -- the
   * creation half of the same declaration. Directional on purpose: a wall
   * goes on terrain, terrain does not go on a wall, and neither direction
   * says anything about the other.
   *
   * `covered` exposes traits, not a type name, so the answer is always about
   * what the covered structure is for.
   *
   * `paintedSubtype` is the preset the run being painted was built from,
   * when its type has subtypes at all. It is what lets one type vary a
   * declared behaviour -- a bridge deck consuming nothing where a road
   * carves -- without splitting into a second type with its own role table
   * and its own logic to keep in step.
   */
  readonly interactionOver: (
    covered: StructureView,
    paintedSubtype?: string,
  ) => CreationInteraction;
  /**
   * How a cloud of this type answers each effect that reaches it, by declared
   * reaction name (`effects/effect.ts`). An effect kind absent here leaves the
   * cloud as the change left it.
   */
  readonly reactions?: Readonly<Partial<Record<EffectKind, ReactionId>>>;
  /**
   * Whether regions of this type vertically conform to a support with these traits beneath them
   * (e.g. taking height from ground), optionally parameterized by `subtype`.
   */
  readonly conformsTo?: (support: ReadonlySet<StructureTrait>, subtype?: string) => boolean;
}

/** The policy every unknown role falls back to: refuse rather than guess. */
export function denied(role: EditRole, reason: string): RolePolicy {
  return { role, resolve: { kind: "deny", reason }, axes: [], scope: "surface" };
}

/** Convenience for the common "allowed, on these axes, at this reach, no cascade" policy. */
export function allowed(
  role: EditRole,
  axes: readonly EditAxis[],
  scope: EditScope,
  cascade?: RolePolicy["cascade"],
): RolePolicy {
  return { role, resolve: { kind: "allow" }, axes, scope, cascade };
}

export type { EditGesture };
