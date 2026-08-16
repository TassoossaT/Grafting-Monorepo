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

export interface WallSegment {
  readonly start: ConstructionPosition;
  readonly end: ConstructionPosition;
  readonly height: number;
}

export interface DoorOpening {
  readonly opensAt: number;
  readonly closesAt: number;
}

export interface GenerateWallRequest {
  readonly wall: WallSegment;
  readonly door?: DoorOpening;
  readonly wallType: string;
  readonly doorType: string;
  /** Keyed by wall-role wire name (e.g. `"startBottom"`). */
  readonly nodeIds: Readonly<Record<string, ConstructionNodeId>>;
  /** Keyed by directional role-pair wire name (e.g. `"startBottom->startTop"`). */
  readonly edgeIds: Readonly<Record<string, ConstructionEdgeId>>;
  /**
   * `nodeIds` values (not role names) the caller asserts already exist --
   * e.g. a wall corner welded onto an adjoining wall's endpoint
   * (`VTT-WALL-CORNER-WELD`). The Rust side reuses these instead of
   * creating a new node, and still requires every other id to be free.
   * Omitted/empty means "no welds," matching every caller predating this
   * field.
   */
  readonly weldedNodeIds?: readonly ConstructionNodeId[];
}

export interface WallPiece {
  readonly surfaceKey: ConstructionSurfaceKey;
  readonly surfaceType: string;
}

/**
 * One grid cell in a {@link GenerateCellPartitionRequest}'s own local grid
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
 * One tick of a continuous room-painting brush: the stroke's *whole*
 * current accumulated cell set (not just what changed since the last
 * tick), regenerated and diffed against whatever this structure already
 * holds every call -- see `cell_partition`'s own doc for why a full resend
 * is required and, since unchanged geometry's id never changes, cheap.
 */
export interface GenerateCellPartitionRequest {
  readonly cells: readonly CellCoordinate[];
  readonly cellSize: number;
  readonly origin: ConstructionPosition;
  readonly wallHeight: number;
  /** A connected region larger than this gets auto-split into more than one room. */
  readonly maxRoomCells: number;
  /** The same seed always reproduces the same split layout for the same cell set. */
  readonly seed: number;
  /**
   * Namespaces every id this call derives. Unlike this port's other
   * generators (fresh per call), this must stay the SAME fixed value
   * across every tick of one structure, and across separate strokes
   * painting the same physical structure later -- that stability is what
   * lets repainting the same cells be a no-op instead of minting
   * duplicate geometry.
   */
  readonly idPrefix: string;
  readonly wallType: string;
  readonly doorType: string;
  readonly floorType: string;
  readonly ceilingType: string;
}

export interface CellPartitionOutcome {
  readonly addedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly removedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly removedNodeIds: readonly ConstructionNodeId[];
}

/** One straight or semicircular-arc edge of a drawn wall path -- see `grafting_procgen_structure_generation::wall_path`'s own doc for why a curve is always fully derived from its two endpoints, never a free parameter. */
export interface PathEdgeSpec {
  readonly start: ConstructionPosition;
  readonly end: ConstructionPosition;
  readonly curvature: "straight" | "arc-left" | "arc-right";
}

/**
 * One tick of the continuous wall-brush pen: the stroke's *whole* current
 * accumulated path (not just what changed since the last tick), regenerated
 * and diffed against whatever this structure already holds every call --
 * same full-resend contract as {@link GenerateCellPartitionRequest}. Once
 * the last edge's end lands back on the first edge's start, the Rust side
 * derives a floor + ceiling for free -- no separate room-derive step.
 */
export interface GenerateWallPathRequest {
  readonly edges: readonly PathEdgeSpec[];
  readonly wallHeight: number;
  /** How many straight chords approximate one arc edge. Ignored if every edge is straight. */
  readonly arcFacets: number;
  /** Namespaces every id this call derives -- same stability contract as {@link GenerateCellPartitionRequest.idPrefix}. */
  readonly idPrefix: string;
  readonly wallType: string;
  readonly floorType: string;
  readonly ceilingType: string;
}

export interface WallPathOutcome {
  readonly addedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly removedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly removedNodeIds: readonly ConstructionNodeId[];
  /** True once this call's own path closed into a room. */
  readonly closed: boolean;
}

export interface RemoveRoomRequest {
  /** The room's own floor corner ids, in cycle order -- e.g. `findEnclosingRoom`'s result for a click inside the room. */
  readonly bottomCycle: readonly ConstructionNodeId[];
  readonly topCycle: readonly ConstructionNodeId[];
  /** Surface type for a preserved, door-stripped side's fresh plain-wall replacement. */
  readonly wallType: string;
}

export interface RemoveRoomOutcome {
  readonly removedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly preservedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly removedNodeIds: readonly ConstructionNodeId[];
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
  generateWall(request: GenerateWallRequest): readonly WallPiece[];
  generateCellPartition(request: GenerateCellPartitionRequest): CellPartitionOutcome;
  generateWallPath(request: GenerateWallPathRequest): WallPathOutcome;
  removeRoom(request: RemoveRoomRequest): RemoveRoomOutcome;

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
