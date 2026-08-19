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

export interface DeleteNodeOutcome {
  readonly removedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly cappingSurfaceKeys: readonly ConstructionSurfaceKey[];
}

export interface SplitSurfaceOutcome {
  readonly firstKey: ConstructionSurfaceKey;
  readonly secondKey: ConstructionSurfaceKey;
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
 * app-owned types. Mirrors the whole session ABI, not only the
 * generate-terrain-cell/generate-wall slice this task's own runtime wiring
 * calls -- `E3.7`'s edit-mode interaction needs the five mutation
 * operations too, and shaping this once avoids redesigning the boundary
 * when that lands.
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

  moveNode(nodeId: ConstructionNodeId, position: ConstructionPosition): AffectedSurfaces;
  deleteNode(
    nodeId: ConstructionNodeId,
    capSurfaceType: string,
    capPhysical: boolean,
  ): DeleteNodeOutcome;
  mergeSurfaces(
    a: ConstructionSurfaceKey,
    b: ConstructionSurfaceKey,
    merged: ConstructionSurfaceSpec,
  ): ConstructionSurfaceKey;
  splitSurface(
    key: ConstructionSurfaceKey,
    first: ConstructionSurfaceSpec,
    second: ConstructionSurfaceSpec,
  ): SplitSurfaceOutcome;
  duplicateSurface(
    key: ConstructionSurfaceKey,
    nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[],
    ringEdgeIds: readonly ConstructionEdgeId[],
    surfaceType: string,
    physical: boolean,
  ): ConstructionSurfaceKey;

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

  getSurfaceMesh(surfaceKey: ConstructionSurfaceKey): SurfaceMeshResult;
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
