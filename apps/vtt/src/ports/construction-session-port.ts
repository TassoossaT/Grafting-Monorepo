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
 * A rectangular `rows` x `cols` grid of uniform-size, welded cells --
 * shared interior walls, one per grid edge, plus a floor+ceiling per cell.
 * Generic on purpose (not house-specific): the app composition layer names
 * a particular use of this "a house," but this port only knows about a
 * grid of walled cells, the same way it only knows about "a wall," not "a
 * bedroom wall."
 */
export interface RoomGridLayout {
  /** The grid's row-0/col-0 corner. */
  readonly origin: ConstructionPosition;
  readonly rows: number;
  readonly cols: number;
  readonly cellWidth: number;
  readonly cellDepth: number;
  readonly wallHeight: number;
}

export interface GenerateRoomGridRequest {
  readonly layout: RoomGridLayout;
  /** Namespaces every id this call generates -- all grid math and id assignment happens on the Rust side, see `generate_room_grid`. */
  readonly idPrefix: string;
  readonly wallType: string;
  readonly doorType: string;
  readonly floorType: string;
  readonly ceilingType: string;
}

export interface RoomGridPiece {
  readonly surfaceKey: ConstructionSurfaceKey;
  readonly surfaceType: string;
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
  generateRoomGrid(request: GenerateRoomGridRequest): readonly RoomGridPiece[];

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
