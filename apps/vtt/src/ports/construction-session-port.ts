import type { RenderMeshData } from "./scene-render-port.ts";

export type ConstructionNodeId = string;
export type ConstructionEdgeId = string;

/** A construction surface's canonical node-set identity, unordered. */
export type ConstructionSurfaceKey = readonly ConstructionNodeId[];

export interface ConstructionPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Axis-aligned world-space extent in the construction plane. */
export interface ConstructionBoundsXZ {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** Local topology query, optionally restricted to clouds reached from seeds. */
export interface ConstructionTopologyBoundsQuery extends ConstructionBoundsXZ {
  readonly seeds?: readonly CloudRequest[];
}

export interface ConstructionSurfaceSpec {
  readonly cycle: readonly ConstructionNodeId[];
  readonly surfaceType: string;
  readonly physical: boolean;
}

export interface AffectedSurfaces {
  readonly affectedSurfaceKeys: readonly ConstructionSurfaceKey[];
}

/**
 * What one atomic region edit changed. Every op in the vocabulary reports
 * this same shape, so a caller batching a policy's primary op with its
 * cascade merges outcomes instead of branching per op -- see
 * `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.
 */
export interface RegionEditOutcome {
  /** Surfaces whose mesh must be re-derived. */
  readonly affectedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly createdSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly removedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly createdNodeIds: readonly ConstructionNodeId[];
  /** Nodes the engine's own zero-orphan cleanup reclaimed. */
  readonly removedNodeIds: readonly ConstructionNodeId[];
}

/**
 * A contour edge's explicit geometry. `"arc"`'s `center` is an XZ point in
 * the surface's own plane -- geometry lives per edge, so a tapering wall is
 * simply two edges with their own centers, not a special case.
 */
export type ConstructionEdgeGeometry =
  | { readonly kind: "line" }
  | { readonly kind: "arc"; readonly center: readonly [number, number]; readonly clockwise: boolean };

/** One boundary edge walked in a loop's own direction. */
export interface ConstructionOrientedEdgeUse {
  readonly edgeId: ConstructionEdgeId;
  readonly reversed: boolean;
}

/** One edge of a region's boundary, with its walk direction already resolved. */
export interface ConstructionRegionEdge extends ConstructionOrientedEdgeUse {
  readonly startNodeId: ConstructionNodeId;
  readonly endNodeId: ConstructionNodeId;
  readonly geometry: ConstructionEdgeGeometry;
}

/**
 * How a brush footprint touches one existing region.
 *
 * Reported as data rather than resolved by the engine: a type that swaps
 * whole faces (terrain restacking onto itself) and a type that cuts (a path
 * carved through) need different rules from the very same answer.
 */
export type ConstructionCoverageKind =
  /** The region's own centroid is under the brush -- the whole face is covered. */
  | "centroid"
  /** The brush and the region overlap, but the centroid is outside -- the brush clips it. */
  | "overlap";

/** One existing region a footprint touches, with what a per-type rule needs to decide. */
export interface ConstructionCoveredRegion {
  readonly surfaceKey: ConstructionSurfaceKey;
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly coverage: ConstructionCoverageKind;
  /** World-space centroid; `y` is the height the face currently sits at. */
  readonly centroid: ConstructionPosition;
  readonly nodeIds: readonly ConstructionNodeId[];
}

/**
 * What a removal left behind. `exposedLoops` are the closed rims bounding
 * the hole that opened -- exactly what new geometry must be stitched onto so
 * the result carries neither a leftover hole nor an extra face. Empty when
 * the removal opened no hole.
 */
/** One face of a generated patch, over edges the same request declares. */
export interface ConstructionPatchRegion {
  readonly regionId: string;
  readonly boundary: readonly ConstructionOrientedEdgeUse[];
  /**
   * Inner loops this face is opened by -- a door, a window, any opening.
   * Absent means a solid face, which is what almost every patch declares.
   *
   * An opening leaves one use free on every edge of its own rim, so a
   * second face can take that rim as its own boundary and stand in the
   * opening. Declaring both in one patch is the point: half of it is a
   * wall with an opening nobody is standing in.
   */
  readonly holes?: readonly (readonly ConstructionOrientedEdgeUse[])[];
  readonly surfaceType: string;
  readonly physical: boolean;
}

/**
 * One boundary segment of a generated patch, named by its caller.
 *
 * `geometry` is optional and defaults to a straight chord, which is what
 * every flat-ground patch declares. It matters because a patch is the only
 * way a generator names a **shared** edge: an arc two faces meet along has
 * no other way to reach the graph curved, so a curved wall panel and its
 * neighbour would otherwise be forced back onto an unshared edge each.
 */
export interface ConstructionPatchEdge {
  readonly edgeId: ConstructionEdgeId;
  readonly startNodeId: ConstructionNodeId;
  readonly endNodeId: ConstructionNodeId;
  readonly geometry?: ConstructionEdgeGeometry;
}

/**
 * A whole generated patch: its nodes, its **shared** boundary edges, and the
 * faces over them.
 *
 * The caller naming its own edges is the point, not the batching. A face
 * registered from a bare node cycle mints an edge per step named after that
 * face, so two faces sitting side by side get two different edges along the
 * line they visually share -- coincident, never connected, and the manifold
 * rule stays silent because each is used once. Naming the segment instead
 * lets both faces reference the same edge, which is what makes the result a
 * mesh and what gives {@link ConstructionSessionPort.getUnfilledLoops} a
 * free-versus-shared distinction to read.
 */
export interface ConstructionPatch {
  readonly nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[];
  readonly edges: readonly ConstructionPatchEdge[];
  readonly regions: readonly ConstructionPatchRegion[];
}

/** What {@link ConstructionSessionPort.addPatch} registered, and what it refused. */
export interface ConstructionPatchOutcome extends RegionEditOutcome {
  /**
   * Faces left unregistered because their boundary had no room -- the ground
   * under them already has a face on both sides of an edge they wanted.
   * Reported rather than thrown: one refused face must not cost the whole
   * stroke.
   */
  readonly skippedRegionIds: readonly string[];
  /**
   * Why each of `skippedRegionIds` was refused, in the same order and naming
   * the edge that decided it. A refusal is not one thing -- an edge already
   * interior, an edge whose one free side faces the other way, a loop that
   * never closes -- and those want opposite fixes, so a caller reading only
   * the ids is left to guess.
   */
  readonly skippedRegionReasons: readonly string[];
}

/** A closed loop of boundary with no face on it -- a hole in the surface. */
export interface ConstructionUnfilledLoop {
  /**
   * The loop's edges, each already oriented for the face that would fill it
   * -- opposite the single region still using it. Registrable verbatim.
   */
  readonly boundary: readonly ConstructionOrientedEdgeUse[];
  readonly nodeIds: readonly ConstructionNodeId[];
  readonly centroid: ConstructionPosition;
  /**
   * The face on the far side of each boundary edge, in the loop's own walk
   * order and with repeats -- so a caller filling the gap can make it match
   * the ground around it instead of whatever the current brush happens to
   * be set to. Reported, never applied: the engine has no opinion on what a
   * gap should be made of.
   */
  readonly neighbours: readonly { readonly surfaceType: string; readonly physical: boolean }[];
}

/**
 * One region's live boundary, in the engine's own deterministic order. That
 * ordering is the entire contract behind index-to-role mapping: the front
 * end asked for a specific generated shape, so it already knows what
 * `nodes[0]` means. Rust never tags a node or edge with a role.
 */
export interface ConstructionRegionTopology {
  readonly surfaceKey: ConstructionSurfaceKey;
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly outerLoops: readonly (readonly ConstructionRegionEdge[])[];
  readonly holes: readonly (readonly ConstructionRegionEdge[])[];
  readonly nodes: readonly ConstructionNodeSnapshot[];
}

/**
 * One grid cell in a {@link GenerateRegionPartitionRequest}'s own local grid
 * -- not world units (multiply by `cellSize` and offset by `origin` to get
 * a world position). Generic on purpose (not house-specific): the app
 * composition layer names a particular use of this "a house," but this
 * port only knows about painted cells partitioned into rooms, the same way
 * it only knows about "a wall," not "a bedroom wall."
 */
export interface CellCoordinate {
  readonly x: number;
  readonly z: number;
}

/**
 * Every `generate*` mutation shares this outcome shape: the whole
 * request's geometry was regenerated and diffed against whatever this
 * structure already held, and only the difference applied.
 */
export interface DiffOutcome {
  readonly addedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly removedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly removedNodeIds: readonly ConstructionNodeId[];
}

/** Identity lifecycle emitted by an atomic surface transformation. */
export interface TransformationIdentityDelta<TIdentity> {
  readonly created: readonly TIdentity[];
  readonly preserved: readonly TIdentity[];
  readonly replaced: readonly TIdentity[];
  readonly removed: readonly TIdentity[];
}

/** Local derived-state refresh scope emitted by an atomic transformation. */
export interface SurfaceTransformationInvalidation {
  readonly changedSurfaces: readonly ConstructionSurfaceKey[];
  readonly topologyRepairNeighbors: readonly ConstructionSurfaceKey[];
  readonly directDependencies: readonly ConstructionSurfaceKey[];
}

/** Declarative cross-section consumed by the generic Rust sweep. */
export interface ConstructionSweepParameters {
  readonly profile: readonly { readonly lateralOffset: number; readonly elevation: number }[];
  readonly miterLimit: number;
}

/** Graph-neutral result of a reusable Rust profile sweep. */
export interface ConstructionSweepPlan {
  /** The stations the formation actually used, carrying the height each one rides at. */
  readonly referenceLine: readonly ConstructionPosition[];
  readonly vertices: readonly ConstructionPosition[];
  readonly quads: readonly (readonly [number, number, number, number])[];
  readonly boundary: readonly number[];
  /**
   * The lengthwise edges that are curves rather than chords, by the pair of
   * vertices each runs between.
   *
   * Sparse: a straight formation reports none. A curved one reports the arc
   * every offset of that stretch follows -- concentric, so one centre serves
   * the spine and both rims.
   */
  readonly curves?: readonly {
    readonly from: number;
    readonly to: number;
    readonly geometry: ConstructionEdgeGeometry;
  }[];
}

/** One generic overlay whose geometry and affected regions were resolved by the application. */
export interface ApplyRegionOverlayRequest {
  readonly operationId: string;
  readonly sourceSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly outline: readonly (readonly [number, number])[];
  readonly boundary: readonly ConstructionOrientedEdgeUse[];
  readonly patch: ConstructionPatch;
}

/**
 * Replaces an exact set of application-selected regions with one generated
 * patch. The executor performs the removal and addition as one all-or-nothing
 * transaction; it has no product or contour policy of its own.
 */
export interface ApplyPatchReplacementRequest {
  readonly operationId: string;
  readonly sourceSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly patch: ConstructionPatch;
  readonly graphPatch?: ConstructionGraphPatch;
  /**
   * This patch's own flat footprint, XZ, offered back for the runtime's own
   * use -- never sent to the engine. A `sourceSurfaceKey` this replaces may
   * belong to a type that needs to conform its own leftover to this outline
   * once the swap lands (`resolveCutRepair`'s `"regenerate"`); the runtime
   * is what checks for that and dispatches it, generically, for any caller
   * of this method, not a concern this port or any one caller decides.
   */
  readonly footprintOutline?: readonly (readonly [number, number])[];
}

/**
 * One tick of a continuous cell-painting brush ("Pintar Casa," a
 * wall-brush stroke's closure): the stroke's *whole* current accumulated
 * cell set (not just what changed since the last tick), regenerated and
 * diffed against whatever this structure already holds every call. Cells
 * are auto-split into disjoint regions larger than `maxRegionCells`; every
 * region gets its own per-cell floor/ceiling and a wall along every
 * boundary run, notched where a run borders a neighboring region.
 */
export interface GenerateRegionPartitionRequest {
  readonly cells: readonly CellCoordinate[];
  readonly cellSize: number;
  readonly origin: ConstructionPosition;
  readonly wallHeight: number;
  /** A connected region larger than this gets auto-split into more than one region. */
  readonly maxRegionCells: number;
  /** The same seed always reproduces the same split layout for the same cell set. */
  readonly seed: number;
  /** Namespaces every id this call derives -- same stability contract as {@link GeneratePathExtrusionRequest.idPrefix}. */
  readonly idPrefix: string;
  readonly wallType: string;
  readonly notchType: string;
  readonly floorType: string;
  readonly ceilingType: string;
}

export interface RemoveSurfaceRequest {
  readonly surfaceKey: ConstructionSurfaceKey;
}

/**
 * `ADR-0022`'s "cloud" query: the connected component of same-`type`
 * surfaces reachable from `seed` by shared graph nodes.
 */
export interface CloudRequest {
  readonly seed: ConstructionSurfaceKey;
  readonly surfaceType: string;
}

export interface CloudOutcome {
  readonly surfaceKeys: readonly ConstructionSurfaceKey[];
}

export interface SurfaceMeshResult {
  readonly surfaceKey: ConstructionSurfaceKey;
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly mesh: RenderMeshData;
}

export interface ConstructionNodeSnapshot {
  readonly id: ConstructionNodeId;
  readonly position: ConstructionPosition;
}

/** One generic graph edge, including edges deliberately not used by a face. */
export interface ConstructionEdgeSnapshot {
  readonly edgeId: ConstructionEdgeId;
  readonly startNodeId: ConstructionNodeId;
  readonly endNodeId: ConstructionNodeId;
}

/** The durable generic graph; semantic types decide what its primitives mean. */
export interface ConstructionGraphSnapshot {
  readonly nodes: readonly ConstructionNodeSnapshot[];
  readonly edges: readonly ConstructionEdgeSnapshot[];
}

/** Generic graph primitives committed with a surface replacement. */
export interface ConstructionGraphPatch {
  readonly nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[];
  /** Generic edges superseded by this patch, e.g. one spine segment split at a new junction. */
  readonly removedEdgeIds?: readonly ConstructionEdgeId[];
  readonly edges: readonly { readonly edgeId: ConstructionEdgeId; readonly startNodeId: ConstructionNodeId; readonly endNodeId: ConstructionNodeId }[];
}

/**
 * Hides `grafting-procgen-construction-wasm`'s `ConstructionSession` ABI
 * (Rust panics are uncatchable on `wasm32-unknown-unknown`, so an adapter
 * must validate at this boundary, not rely on recovering from one) behind
 * app-owned types. Mirrors the whole session ABI, not only the slice the
 * current runtime wiring calls.
 */
/**
 * One point of a contour handed to the grid generator as a constraint.
 *
 * `source` is an index into a table the *caller* keeps, never a node id.
 * The engine forwards it untouched and never looks inside it, which is what
 * lets a node come back identified instead of being matched to a position by
 * proximity -- the guess that minted a second node on top of a real one in
 * every fill this generator replaces.
 */
export interface ConstructionGridConstraintPoint {
  readonly x: number;
  readonly z: number;
  readonly source?: number;
}

/** What bounds the ground to generate, and at what scale. */
export interface ConstructionIrregularQuadGridRequest {
  readonly seed: number;
  /** Closed rings bounding the ground. Points in ring order; the closing edge is implicit. */
  readonly boundary: readonly (readonly ConstructionGridConstraintPoint[])[];
  /**
   * Closed rings of ground another cloud already holds -- a road contour, a
   * building footprint -- subtracted from `boundary`.
   *
   * Every ring is a constraint either way: no cell crosses one, whichever
   * list it came from. This only decides which of the resulting cells come
   * back as ground.
   */
  readonly holes?: readonly (readonly ConstructionGridConstraintPoint[])[];
  /**
   * How wide one finished terrain face should be, in world units.
   *
   * The face, not the lattice triangle behind it. Two subdivision stages sit
   * between the two, so asking in lattice terms yields faces about a third of
   * the size meant -- which is how a stroke asking for cells of 2 came back
   * with roughly seven times the faces it wanted. The engine owns that
   * conversion; this side says what it wants to see.
   */
  readonly faceSide: number;
  /**
   * How hard the relaxation pulls cells toward square, `0` hardest and `1`
   * leaving the raw irregular variety the rhombus pairing produced. Omitted
   * takes the generator's own standard.
   */
  readonly relaxStrength?: number;
  /**
   * Hard ceiling on the extra vertices the refinement may invent chasing
   * quality, so a pathological pair of contours costs a coarser patch rather
   * than tens of thousands of points to adopt. Omitted takes the generator's
   * own standard (a ceiling generous enough it is rarely the binding limit).
   *
   * Reproduced against the real engine: two boundary rings meeting at a
   * shallow, near-tangent angle -- the exact shape a stroke's own halo draws
   * around a neighbour it barely reaches -- made the refinement invent over
   * 23,000 points for a contour of 10. The points themselves generate fast;
   * adopting that many, one failed batch away from one `applyRegionEdit` per
   * node, is what actually stalls the stroke.
   */
  readonly maxAdditionalVertices?: number;
}

/** One corner the generator put along a contour the caller supplied. */
export interface ConstructionGridContourNode {
  /** Index into {@link ConstructionIrregularQuadGrid.vertices}. */
  readonly vertex: number;
  /** Which of the two request lists {@link ring} indexes. */
  readonly ringKind: "boundary" | "hole";
  readonly ring: number;
  /** The segment running from point `segment` of that ring to the next. */
  readonly segment: number;
}

/**
 * A generated grid, and what each of its corners already is.
 *
 * Handed back rather than applied, because registering it needs two decisions
 * this layer owns and the engine does not: a node id for every new corner,
 * and a height for it. The engine has no idea what a `ConstructionNodeId`
 * looks like, and height is sampled from the heightmap here.
 */
export interface ConstructionIrregularQuadGrid {
  readonly vertices: readonly {
    readonly x: number;
    readonly z: number;
    /** The `source` this corner arrived with; absent where it is new ground. */
    readonly source?: number;
  }[];
  readonly quads: readonly (readonly [number, number, number, number])[];
  /**
   * Corners sitting *on* a supplied contour that arrived with no source --
   * nodes the cloud owning that contour has to adopt.
   *
   * They exist because the refinement splits a constraint segment where a
   * nearby point encroaches on it, and because quadrangulation puts a
   * midpoint on every edge, a contour edge included. Both are wanted: the
   * alternative to a shared node here is a terrain corner resting against
   * the middle of a road edge without sharing it, which reads as a gap along
   * the path.
   *
   * Each names the segment it landed on, addressed back into the request.
   * That is the difference between adopting it and guessing: the caller
   * supplied the rings, so a ring and segment index already identifies one
   * of its own edges by id, and the node is adopted by splitting that edge
   * rather than by finding the nearest one to a position.
   */
  readonly onContour: readonly ConstructionGridContourNode[];
  /**
   * `false` where the refinement stopped at its vertex budget. The grid is
   * still usable, just coarser somewhere -- worth logging, never worth
   * discarding the result over.
   */
  readonly refinementComplete: boolean;
}

export interface ConstructionSessionPort {
  /**
   * Loads the underlying Wasm module and starts an empty session. Every
   * other method requires this to have resolved first, mirroring
   * {@link import("./scene-render-port.ts").SceneRenderPort}'s own
   * `start`/`dispose` lifecycle so a composition root awaits both the same
   * way.
   */
  start(): Promise<void>;

  // ---- The atomic edit vocabulary ----
  //
  // Type-agnostic by construction: nothing below knows what a wall or a
  // terrain patch is. Which ops a structure type allows, what constrains
  // their parameters, and what cascades alongside them lives entirely in
  // `features/edit-construction/structure-types/`.

  /** Moves one boundary node to an absolute position. */
  moveVertex(nodeId: ConstructionNodeId, position: ConstructionPosition): RegionEditOutcome;
  /**
   * Subdivides one boundary edge, minting a new node on it. Both fragments
   * keep the original's geometry description. Called twice on the same
   * original edge, this is also the whole of the "carve a movable notch"
   * case -- there is deliberately no separate cut primitive here.
   */
  insertVertex(request: {
    readonly edgeId: ConstructionEdgeId;
    readonly nodeId: ConstructionNodeId;
    readonly position: ConstructionPosition;
    readonly firstEdgeId: ConstructionEdgeId;
    readonly secondEdgeId: ConstructionEdgeId;
  }): RegionEditOutcome;
  /** Welds a node's two neighboring edges into one -- `insertVertex`'s inverse. */
  removeVertex(nodeId: ConstructionNodeId, weldedEdgeId: ConstructionEdgeId): RegionEditOutcome;

  /** Swaps one edge's geometry without touching either endpoint. */
  retypeEdge(edgeId: ConstructionEdgeId, geometry: ConstructionEdgeGeometry): RegionEditOutcome;
  /** Moves both of an edge's endpoints as one rigid unit. */
  moveEdge(edgeId: ConstructionEdgeId, delta: ConstructionPosition): RegionEditOutcome;
  /**
   * Opens one more inner loop on an existing face -- what a door or a
   * window is an opening for. The loop must already be registered, and it
   * keeps one free use per edge so a face can stand in it.
   */
  addHole(request: {
    readonly surfaceKey: ConstructionSurfaceKey;
    readonly hole: readonly ConstructionOrientedEdgeUse[];
  }): RegionEditOutcome;
  /** Closes one of a face's openings back up, by index, reclaiming whatever rim nothing stands on anymore. */
  removeHole(request: {
    readonly surfaceKey: ConstructionSurfaceKey;
    readonly index: number;
  }): RegionEditOutcome;
  /**
   * Registers a whole generated patch in one transaction -- see
   * {@link ConstructionPatch} for why a generator names its own edges.
   * Nodes, edges, and regions already present are skipped, not rejected: a
   * stroke overlapping an earlier one re-declares what they share, and that
   * must not mint a second copy.
   */
  addPatch(patch: ConstructionPatch): ConstructionPatchOutcome;
  /**
   * Every closed loop of boundary **among `scope`'s nodes** that another
   * such loop encloses and no face fills -- a hole in the surface whose rim
   * already exists.
   *
   * Structural, not geometric: it reports only loops the registered edges
   * already close, never a gap guessed from proximity. Filling one adds no
   * edge and no node, because the boundary was there all along.
   *
   * `scope` is the region the caller just touched, and narrowing to it is
   * what makes the answer right rather than merely cheap: free boundary
   * elsewhere on the map bounds shapes nobody is editing, and a courtyard
   * between two unrelated patches reads as a hole from every angle except
   * "did this stroke put it there". An empty scope reports nothing.
   */
  getUnfilledLoops(scope: readonly ConstructionNodeId[]): readonly ConstructionUnfilledLoop[];
  /** Moves every node on a region's boundary, holes included. */
  moveRegion(surfaceKey: ConstructionSurfaceKey, delta: ConstructionPosition): RegionEditOutcome;
  /** Unregisters a region, leaving zero orphaned nodes or edges behind. */
  deleteRegion(surfaceKey: ConstructionSurfaceKey): RegionEditOutcome;
  /**
   * What a footprint currently covers, before anything is generated -- the
   * creation-side counterpart to {@link getRegionTopology}. The engine
   * reports; `features/edit-construction`'s per-type table decides.
   */
  getFootprintCoverage(
    polygon: readonly (readonly [number, number])[],
  ): readonly ConstructionCoveredRegion[];
  /**
   * Which of `points` already sit inside a region -- the per-point form of
   * {@link getFootprintCoverage}, for a generator deciding face by face
   * whether the ground under it is free. A stroke spanning both occupied and
   * open ground needs that distinction *within* its own area, which one
   * footprint-wide verdict cannot give.
   *
   * Indexed back to the request; a point over open ground is simply absent.
   */
  classifyPoints(
    points: readonly (readonly [number, number])[],
  ): readonly { readonly index: number; readonly surfaceKey: ConstructionSurfaceKey; readonly surfaceType: string }[];
  /**
   * One irregular quad grid, generated against the contours the request
   * names -- what ground is *made of*, whether it is being created on empty
   * land or regenerated beside something that moved.
   *
   * Pure: it reads nothing from the live graph and changes nothing in it.
   * The caller mints ids for the new corners, samples their height, and
   * registers the result through {@link addPatch} -- see
   * {@link ConstructionIrregularQuadGrid} for why that split is deliberate.
   *
   * `undefined` where the contours describe no ground that can be
   * triangulated. That is a refusal, not an error: a caller that gets one
   * leaves what is standing alone rather than substituting something.
   */
  generateIrregularQuadGrid(
    request: ConstructionIrregularQuadGridRequest,
  ): ConstructionIrregularQuadGrid | undefined;
  /** Mints a parallel copy; the same `suffix` always reproduces the same copy. */
  duplicateRegion(request: {
    readonly surfaceKey: ConstructionSurfaceKey;
    readonly suffix: string;
    readonly offset: ConstructionPosition;
    readonly surfaceType: string;
    readonly physical: boolean;
  }): RegionEditOutcome;
  /** One region's live boundary, or `undefined` for a stale key. */
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
  /** Region boundaries with at least one node inside an XZ extent, returned in one engine crossing. */
  getRegionTopologiesInBounds(bounds: ConstructionTopologyBoundsQuery): readonly ConstructionRegionTopology[];
  /** Every region's boundary -- the edit-mode bootstrap call. */
  getAllRegionTopologies(): readonly ConstructionRegionTopology[];

  /** Atomically overlays an application-generated patch onto exact source regions. */
  applyRegionOverlay(request: ApplyRegionOverlayRequest): ConstructionPatchOutcome;
  /** Atomically replaces exact source regions with an application-generated patch. */
  applyPatchReplacement(request: ApplyPatchReplacementRequest): ConstructionPatchOutcome;
  undoRegionOverlay(operationId: string): void;
  redoRegionOverlay(operationId: string): void;
  generateRegionPartition(request: GenerateRegionPartitionRequest): DiffOutcome;
  /** Unregisters a surface outright -- no hole-repair, no cascading. */
  removeSurface(request: RemoveSurfaceRequest): void;
  /** `ADR-0022`'s "cloud" query. */
  cloudFor(request: CloudRequest): CloudOutcome;

  /**
   * One surface's mesh piece(s), by key. Almost always one piece -- but an
   * analytic-region key (a merged path-brush source/target region) can
   * legitimately triangulate into several disjoint pieces (one per outer
   * loop), and every one of them must be rendered, not just the first.
   */
  getSurfaceMesh(surfaceKey: ConstructionSurfaceKey): readonly SurfaceMeshResult[];
  /** A known mutation set's meshes in one engine crossing. */
  getSurfaceMeshes(surfaceKeys: readonly ConstructionSurfaceKey[]): readonly SurfaceMeshResult[];
  /** Every currently-known surface's mesh -- the bootstrap/full-render call. */
  getAllSurfaceMeshes(): readonly SurfaceMeshResult[];

  /**
   * Every node currently in the session with its live position -- what an
   * edit-mode caller needs to seed hit-testing/handle placement without
   * re-deriving positions from triangulated mesh data. Backed by the Wasm
   * session's own `snapshot_json`, which already carries node positions;
   * this method exposes only that slice (edges/surfaces are unused by any
   * caller so far).
   */
  getNodePositions(): readonly ConstructionNodeSnapshot[];
  /** Generic graph primitives, including non-region edges such as a path spine. */
  getGraphSnapshot(): ConstructionGraphSnapshot;

  dispose(): Promise<void>;
}
