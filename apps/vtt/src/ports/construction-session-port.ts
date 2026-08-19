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

export interface CornerHeightModule {
  readonly name: string;
  /** Exactly 4 entries, in `PrismGridMesh::cell_corners`' cyclic order. */
  readonly cornerHeights: readonly [number, number, number, number];
}

export interface GenerateTerrainCellRequest {
  readonly cell: number;
  readonly module: CornerHeightModule;
  readonly surfaceType: string;
  /** One id per corner slot, in cyclic order -- exactly 4 entries. */
  readonly nodeIds: readonly [
    ConstructionNodeId,
    ConstructionNodeId,
    ConstructionNodeId,
    ConstructionNodeId,
  ];
  readonly edgeIds: readonly [
    ConstructionEdgeId,
    ConstructionEdgeId,
    ConstructionEdgeId,
    ConstructionEdgeId,
  ];
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

/** Renderer-neutral convex brush shape accepted by authoritative Rust brush queries. */
export type ConstructionBrushShape =
  | { readonly kind: "circle"; readonly radius: number }
  | { readonly kind: "square"; readonly size: number; readonly rotationRadians: number }
  | { readonly kind: "hexagon"; readonly radius: number; readonly rotationRadians: number };

/** One resolved continuous convex terrain-to-path brush request. */
export interface ApplyPathBrushRequest {
  readonly operationId: string;
  readonly samples: readonly ConstructionPosition[];
  readonly brushShape: ConstructionBrushShape;
  readonly depth: number;
  readonly sourceSurfaceTypes: readonly string[];
  readonly targetSurfaceType: string;
}

/** Result of one atomic terrain-to-path transformation. */
export interface ApplyPathBrushOutcome {
  readonly nodeIds: TransformationIdentityDelta<ConstructionNodeId>;
  readonly edgeIds: TransformationIdentityDelta<ConstructionEdgeId>;
  readonly surfaceIds: TransformationIdentityDelta<ConstructionSurfaceKey>;
  readonly invalidation: SurfaceTransformationInvalidation;
}

/** One straight or circular-arc edge of a drawn path -- see `grafting_procgen_structure_generation::extrusion`'s own doc for why a curve is always fully derived from its two endpoints plus `includedAngle`, never a free parameter. */
export interface PathEdgeSpec {
  readonly start: ConstructionPosition;
  readonly end: ConstructionPosition;
  readonly curvature: "straight" | "arc-left" | "arc-right";
  /**
   * The arc's own swept angle, in radians -- ignored for `"straight"`.
   * Omit for a true semicircle (`Math.PI`), the only shape wall-brush's own
   * curve-fitting (`path-fitting.ts`) ever detects; a caller building a
   * closed shape from 3+ arcs (a full circle, most commonly -- see
   * `tower-geometry.ts`) supplies a smaller angle so no two arcs share the
   * same endpoint pair (which two true semicircles closing the same circle
   * always would, since a curved edge's own corner ids are purely
   * position-derived).
   */
  readonly includedAngle?: number;
}

/** A single opening cut into a one-straight-edge path -- see `extrude_path`'s own scoping of this. */
export interface EdgeNotchSpec {
  readonly startsAt: number;
  readonly endsAt: number;
  readonly surfaceType: string;
}

/**
 * One tick of a continuous path-brush pen (wall, fence, any other
 * extruded panel run): the stroke's *whole* current accumulated path (not
 * just what changed since the last tick), regenerated and diffed against
 * whatever this structure already holds every call. Never generates a
 * floor/ceiling itself -- see {@link GenerateBoundaryCapRequest}/{@link
 * GenerateRegionPartitionRequest} for that.
 */
export interface GeneratePathExtrusionRequest {
  readonly edges: readonly PathEdgeSpec[];
  readonly height: number;
  /**
   * Namespaces every id this call derives. Must stay the SAME fixed value
   * across every tick of one structure, and across separate strokes
   * painting the same physical structure later -- that stability is what
   * lets repainting the same path be a no-op instead of minting
   * duplicate geometry.
   */
  readonly idPrefix: string;
  readonly surfaceType: string;
  /** Only valid when `edges` is exactly one straight edge. */
  readonly notch?: EdgeNotchSpec;
}

/**
 * One closed boundary of arbitrary 3D points becomes one capping surface
 * (a floor, a ceiling, or any other flat or per-vertex-height polygon).
 */
export interface GenerateBoundaryCapRequest {
  readonly points: readonly ConstructionPosition[];
  readonly idPrefix: string;
  readonly surfaceType: string;
  readonly top: boolean;
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

export interface RemoveEdgeRequest {
  readonly edgeId: ConstructionEdgeId;
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

/**
 * Hides `grafting-procgen-construction-wasm`'s `ConstructionSession` ABI
 * (Rust panics are uncatchable on `wasm32-unknown-unknown`, so an adapter
 * must validate at this boundary, not rely on recovering from one) behind
 * app-owned types. Mirrors the whole session ABI, not only the slice the
 * current runtime wiring calls.
 */
export interface ConstructionSessionPort {
  /**
   * Loads the underlying Wasm module and starts an empty session. Every
   * other method requires this to have resolved first, mirroring
   * {@link import("./scene-render-port.ts").SceneRenderPort}'s own
   * `start`/`dispose` lifecycle so a composition root awaits both the same
   * way.
   */
  start(): Promise<void>;

  addNode(id: ConstructionNodeId, position: ConstructionPosition): void;
  addEdge(id: ConstructionEdgeId, source: ConstructionNodeId, target: ConstructionNodeId): void;
  addSurface(spec: ConstructionSurfaceSpec): ConstructionSurfaceKey;

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
  /** Registers a bare boundary edge -- the staging step before `cutRegion`/`addHole`. */
  addContourEdge(request: {
    readonly edgeId: ConstructionEdgeId;
    readonly startNodeId: ConstructionNodeId;
    readonly endNodeId: ConstructionNodeId;
    readonly geometry: ConstructionEdgeGeometry;
  }): void;

  /** Moves every node on a region's boundary, holes included. */
  moveRegion(surfaceKey: ConstructionSurfaceKey, delta: ConstructionPosition): RegionEditOutcome;
  /** Unregisters a region, leaving zero orphaned nodes or edges behind. */
  deleteRegion(surfaceKey: ConstructionSurfaceKey): RegionEditOutcome;
  /** Mints a parallel copy; the same `suffix` always reproduces the same copy. */
  duplicateRegion(request: {
    readonly surfaceKey: ConstructionSurfaceKey;
    readonly suffix: string;
    readonly offset: ConstructionPosition;
    readonly surfaceType: string;
    readonly physical: boolean;
  }): RegionEditOutcome;
  /** Divides one region in two along an already-registered cut path. */
  cutRegion(request: {
    readonly surfaceKey: ConstructionSurfaceKey;
    readonly cutPath: readonly ConstructionOrientedEdgeUse[];
    readonly firstRegionId: string;
    readonly secondRegionId: string;
  }): RegionEditOutcome;
  /** Adds an inner loop -- what a door or a window is. */
  addHole(
    surfaceKey: ConstructionSurfaceKey,
    hole: readonly ConstructionOrientedEdgeUse[],
  ): RegionEditOutcome;
  /** Drops one inner loop by index. */
  removeHole(surfaceKey: ConstructionSurfaceKey, index: number): RegionEditOutcome;

  /** One region's live boundary, or `undefined` for a stale key. */
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
  /** Every region's boundary -- the edit-mode bootstrap call. */
  getAllRegionTopologies(): readonly ConstructionRegionTopology[];

  /** Must be called once before {@link generateTerrainCell}. */
  setTerrainMesh(
    width: number,
    height: number,
    layers: number,
    primitive: "passage" | "boundary" | "surface",
    deformationXy: number,
    deformationZ: number,
  ): void;
  generateTerrainCell(request: GenerateTerrainCellRequest): ConstructionSurfaceKey;
  /** Applies one resolved terrain-to-path brush atomically through the domain transformer. */
  applyPathBrush(request: ApplyPathBrushRequest): ApplyPathBrushOutcome;
  /** Derives exact target meshes on cloned state; confirmed state is untouched. */
  previewPathBrush(request: ApplyPathBrushRequest): readonly SurfaceMeshResult[];
  /** Restores the confirmed state immediately before that path-brush operation. */
  undoPathBrush(operationId: string): void;
  /** Restores the confirmed state immediately after that undone path-brush operation. */
  redoPathBrush(operationId: string): void;
  generatePathExtrusion(request: GeneratePathExtrusionRequest): DiffOutcome;
  generateBoundaryCap(request: GenerateBoundaryCapRequest): DiffOutcome;
  generateRegionPartition(request: GenerateRegionPartitionRequest): DiffOutcome;
  /** Unregisters a surface outright -- no hole-repair, no cascading. */
  removeSurface(request: RemoveSurfaceRequest): void;
  /** Removes an edge outright -- no repair, no cascading. */
  removeEdge(request: RemoveEdgeRequest): void;
  /** `ADR-0022`'s "cloud" query. */
  cloudFor(request: CloudRequest): CloudOutcome;

  /**
   * One surface's mesh piece(s), by key. Almost always one piece -- but an
   * analytic-region key (a merged path-brush source/target region) can
   * legitimately triangulate into several disjoint pieces (one per outer
   * loop), and every one of them must be rendered, not just the first.
   */
  getSurfaceMesh(surfaceKey: ConstructionSurfaceKey): readonly SurfaceMeshResult[];
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

  dispose(): Promise<void>;
}
