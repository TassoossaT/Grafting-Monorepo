// Wraps `@grafting/procgen-construction-wasm`'s `ConstructionSession` (a
// stateful Wasm class, JSON-request/response methods) behind
// `ConstructionSessionPort`. Runs on the main thread for this task -- see
// `apps/vtt/notes/0004-map-product-model.md` for why no Worker boundary
// exists yet. Panics are uncatchable on `wasm32-unknown-unknown`, so only
// `Err`/rejected-promise paths are ever recoverable here; a thrown JS error
// from a session call means the request JSON itself was rejected before any
// panic could occur.

import initConstructionWasm, { ConstructionSession } from "@grafting/procgen-construction-wasm";

import type {
  ApplyPathBrushOutcome,
  ApplyPathBrushRequest,
  CloudOutcome,
  CloudRequest,
  ConstructionNodeSnapshot,
  ConstructionPosition,
  ConstructionSessionPort,
  ConstructionSurfaceKey,
  ConstructionSurfaceSpec,
  DiffOutcome,
  GenerateBoundaryCapRequest,
  GeneratePathExtrusionRequest,
  GenerateRegionPartitionRequest,
  GenerateTerrainCellRequest,
  RemoveEdgeRequest,
  RemoveSurfaceRequest,
  SurfaceMeshResult,
} from "@/ports";

function curvatureToWire(curvature: "straight" | "arc-left" | "arc-right"): string {
  switch (curvature) {
    case "straight":
      return "straight";
    case "arc-left":
      return "arcLeft";
    case "arc-right":
      return "arcRight";
  }
}

type WirePosition = readonly [number, number, number];

function toWirePosition(position: ConstructionPosition): WirePosition {
  return [position.x, position.y, position.z];
}

function fromWirePosition(position: WirePosition): ConstructionPosition {
  const [x, y, z] = position;
  return { x, y, z };
}

interface SnapshotWire {
  readonly nodes: readonly { readonly id: string; readonly position: WirePosition }[];
}

function toWireSpec(spec: ConstructionSurfaceSpec): { cycle: readonly string[]; surfaceType: string; physical: boolean } {
  return { cycle: spec.cycle, surfaceType: spec.surfaceType, physical: spec.physical };
}

interface SurfaceMeshWire {
  readonly surfaceKey: readonly string[];
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly indices: readonly number[];
}

function toMeshResult(wire: SurfaceMeshWire): SurfaceMeshResult {
  return {
    surfaceKey: wire.surfaceKey,
    surfaceType: wire.surfaceType,
    physical: wire.physical,
    mesh: {
      positions: Float32Array.from(wire.positions),
      normals: Float32Array.from(wire.normals),
      indices: Uint32Array.from(wire.indices),
    },
  };
}

function primitiveToWire(primitive: "passage" | "boundary" | "surface"): number {
  switch (primitive) {
    case "passage":
      return 0;
    case "boundary":
      return 1;
    case "surface":
      return 2;
  }
}

class ConstructionSessionWasmAdapter implements ConstructionSessionPort {
  #session?: ConstructionSession;

  async start(): Promise<void> {
    if (this.#session !== undefined) throw new Error("construction session is already started");
    await initConstructionWasm();
    this.#session = new ConstructionSession();
  }

  addNode(id: string, position: ConstructionPosition): void {
    this.#require().add_node_json(JSON.stringify({ id, position: toWirePosition(position) }));
  }

  addEdge(id: string, source: string, target: string): void {
    this.#require().add_edge_json(JSON.stringify({ id, source, target }));
  }

  addSurface(spec: ConstructionSurfaceSpec): ConstructionSurfaceKey {
    const response = JSON.parse(this.#require().add_surface_json(JSON.stringify(toWireSpec(spec)))) as {
      surfaceKey: readonly string[];
    };
    return response.surfaceKey;
  }

  moveNode(nodeId: string, position: ConstructionPosition) {
    const response = JSON.parse(
      this.#require().move_node_json(JSON.stringify({ nodeId, position: toWirePosition(position) })),
    ) as { affectedSurfaceKeys: readonly (readonly string[])[] };
    return { affectedSurfaceKeys: response.affectedSurfaceKeys };
  }

  deleteNode(nodeId: string, capSurfaceType: string, capPhysical: boolean) {
    const response = JSON.parse(
      this.#require().delete_node_json(JSON.stringify({ nodeId, capSurfaceType, capPhysical })),
    ) as { removedSurfaceKeys: readonly (readonly string[])[]; cappingSurfaceKeys: readonly (readonly string[])[] };
    return { removedSurfaceKeys: response.removedSurfaceKeys, cappingSurfaceKeys: response.cappingSurfaceKeys };
  }

  mergeSurfaces(a: ConstructionSurfaceKey, b: ConstructionSurfaceKey, merged: ConstructionSurfaceSpec): ConstructionSurfaceKey {
    const response = JSON.parse(
      this.#require().merge_surfaces_json(JSON.stringify({ a, b, merged: toWireSpec(merged) })),
    ) as { surfaceKey: readonly string[] };
    return response.surfaceKey;
  }

  splitSurface(key: ConstructionSurfaceKey, first: ConstructionSurfaceSpec, second: ConstructionSurfaceSpec) {
    const response = JSON.parse(
      this.#require().split_surface_json(
        JSON.stringify({ key, first: toWireSpec(first), second: toWireSpec(second) }),
      ),
    ) as { firstKey: readonly string[]; secondKey: readonly string[] };
    return { firstKey: response.firstKey, secondKey: response.secondKey };
  }

  duplicateSurface(
    key: ConstructionSurfaceKey,
    nodes: readonly { readonly id: string; readonly position: ConstructionPosition }[],
    ringEdgeIds: readonly string[],
    surfaceType: string,
    physical: boolean,
  ): ConstructionSurfaceKey {
    const response = JSON.parse(
      this.#require().duplicate_surface_json(
        JSON.stringify({
          key,
          nodes: nodes.map((node) => ({ id: node.id, position: toWirePosition(node.position) })),
          ringEdgeIds,
          surfaceType,
          physical,
        }),
      ),
    ) as { surfaceKey: readonly string[] };
    return response.surfaceKey;
  }

  setTerrainMesh(
    width: number,
    height: number,
    layers: number,
    primitive: "passage" | "boundary" | "surface",
    deformationXy: number,
    deformationZ: number,
  ): void {
    this.#require().set_terrain_mesh(width, height, layers, primitiveToWire(primitive), deformationXy, deformationZ);
  }

  generateTerrainCell(request: GenerateTerrainCellRequest): ConstructionSurfaceKey {
    const response = JSON.parse(this.#require().generate_and_apply_terrain_cell_json(JSON.stringify(request))) as {
      surfaceKey: readonly string[];
    };
    return response.surfaceKey;
  }

  applyPathBrush(request: ApplyPathBrushRequest): ApplyPathBrushOutcome {
    const wire = {
      operationId: request.operationId,
      center: [request.center.x, request.center.z],
      radius: request.radius,
      depth: request.depth,
      sourceSurfaceType: request.sourceSurfaceType,
      targetSurfaceType: request.targetSurfaceType,
    };
    const session = this.#require() as ConstructionSession & {
      apply_path_brush_json(requestJson: string): string;
    };
    return this.#pathBrushOutcome(session.apply_path_brush_json(JSON.stringify(wire)));
  }

  generatePathExtrusion(request: GeneratePathExtrusionRequest): DiffOutcome {
    const wire = {
      edges: request.edges.map((edge) => ({
        start: toWirePosition(edge.start),
        end: toWirePosition(edge.end),
        curvature: curvatureToWire(edge.curvature),
        includedAngle: edge.includedAngle,
      })),
      height: request.height,
      idPrefix: request.idPrefix,
      surfaceType: request.surfaceType,
      notch: request.notch,
    };
    return this.#diffOutcome(this.#require().generate_and_apply_path_extrusion_json(JSON.stringify(wire)));
  }

  generateBoundaryCap(request: GenerateBoundaryCapRequest): DiffOutcome {
    const wire = {
      points: request.points.map(toWirePosition),
      idPrefix: request.idPrefix,
      surfaceType: request.surfaceType,
      top: request.top,
    };
    return this.#diffOutcome(this.#require().generate_and_apply_boundary_cap_json(JSON.stringify(wire)));
  }

  generateRegionPartition(request: GenerateRegionPartitionRequest): DiffOutcome {
    const wire = {
      cells: request.cells,
      cellSize: request.cellSize,
      origin: toWirePosition(request.origin),
      wallHeight: request.wallHeight,
      maxRegionCells: request.maxRegionCells,
      seed: request.seed,
      idPrefix: request.idPrefix,
      wallType: request.wallType,
      notchType: request.notchType,
      floorType: request.floorType,
      ceilingType: request.ceilingType,
    };
    return this.#diffOutcome(this.#require().generate_and_apply_region_partition_json(JSON.stringify(wire)));
  }

  removeSurface(request: RemoveSurfaceRequest): void {
    this.#require().remove_surface_json(JSON.stringify({ surfaceKey: request.surfaceKey }));
  }

  removeEdge(request: RemoveEdgeRequest): void {
    this.#require().remove_edge_json(JSON.stringify({ edgeId: request.edgeId }));
  }

  cloudFor(request: CloudRequest): CloudOutcome {
    const response = JSON.parse(
      this.#require().cloud_json(JSON.stringify({ seed: request.seed, surfaceType: request.surfaceType })),
    ) as { surfaceKeys: readonly (readonly string[])[] };
    return { surfaceKeys: response.surfaceKeys };
  }

  #pathBrushOutcome(responseJson: string): ApplyPathBrushOutcome {
    const response = JSON.parse(responseJson) as ApplyPathBrushOutcome;
    return response;
  }

  #diffOutcome(responseJson: string): DiffOutcome {
    const response = JSON.parse(responseJson) as {
      addedSurfaceKeys: readonly (readonly string[])[];
      removedSurfaceKeys: readonly (readonly string[])[];
      removedNodeIds: readonly string[];
    };
    return {
      addedSurfaceKeys: response.addedSurfaceKeys,
      removedSurfaceKeys: response.removedSurfaceKeys,
      removedNodeIds: response.removedNodeIds,
    };
  }

  getSurfaceMesh(surfaceKey: ConstructionSurfaceKey): SurfaceMeshResult {
    const wire = JSON.parse(this.#require().surface_mesh_json(JSON.stringify({ surfaceKey }))) as SurfaceMeshWire;
    return toMeshResult(wire);
  }

  getAllSurfaceMeshes(): readonly SurfaceMeshResult[] {
    const wire = JSON.parse(this.#require().all_surface_meshes_json()) as readonly SurfaceMeshWire[];
    return wire.map(toMeshResult);
  }

  getNodePositions(): readonly ConstructionNodeSnapshot[] {
    const wire = JSON.parse(this.#require().snapshot_json()) as SnapshotWire;
    return wire.nodes.map((node) => ({ id: node.id, position: fromWirePosition(node.position) }));
  }

  async dispose(): Promise<void> {
    if (this.#session === undefined) return;
    this.#session.free();
    this.#session = undefined;
  }

  #require(): ConstructionSession {
    if (this.#session === undefined) throw new Error("construction session is not started");
    return this.#session;
  }
}

export function createConstructionSessionAdapter(): ConstructionSessionPort {
  return new ConstructionSessionWasmAdapter();
}
