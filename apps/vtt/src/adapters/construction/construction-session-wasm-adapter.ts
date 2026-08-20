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
  ConstructionCoverageKind,
  ConstructionCoveredRegion,
  ConstructionEdgeGeometry,
  ConstructionNodeSnapshot,
  ConstructionOrientedEdgeUse,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionRemovalOutcome,
  ConstructionSessionPort,
  ConstructionSurfaceKey,
  ConstructionSurfaceSpec,
  DiffOutcome,
  GenerateBoundaryCapRequest,
  GeneratePathExtrusionRequest,
  GenerateRegionPartitionRequest,
  GenerateTerrainCellRequest,
  RegionEditOutcome,
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

/** The engine tags an arc `"arc"`; its center is an XZ pair, never a 3D normal. */
function toWireGeometry(geometry: ConstructionEdgeGeometry): unknown {
  return geometry.kind === "line"
    ? { kind: "line" }
    : { kind: "arc", center: geometry.center, clockwise: geometry.clockwise };
}

interface RegionEdgeWire {
  readonly edgeId: string;
  readonly reversed: boolean;
  readonly startNodeId: string;
  readonly endNodeId: string;
  readonly geometry: ConstructionEdgeGeometry;
}

interface RegionTopologyWire {
  readonly surfaceKey: readonly string[];
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly outerLoops: readonly (readonly RegionEdgeWire[])[];
  readonly holes: readonly (readonly RegionEdgeWire[])[];
  readonly nodes: readonly { readonly id: string; readonly position: WirePosition }[];
}

function fromWireTopology(wire: RegionTopologyWire): ConstructionRegionTopology {
  return {
    surfaceKey: wire.surfaceKey,
    surfaceType: wire.surfaceType,
    physical: wire.physical,
    outerLoops: wire.outerLoops,
    holes: wire.holes,
    nodes: wire.nodes.map((node) => ({ id: node.id, position: fromWirePosition(node.position) })),
  };
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

  // ---- The atomic edit vocabulary ----

  moveVertex(nodeId: string, position: ConstructionPosition): RegionEditOutcome {
    return this.#regionEdit(
      this.#require().move_vertex_json(JSON.stringify({ nodeId, position: toWirePosition(position) })),
    );
  }

  insertVertex(request: {
    readonly edgeId: string;
    readonly nodeId: string;
    readonly position: ConstructionPosition;
    readonly firstEdgeId: string;
    readonly secondEdgeId: string;
  }): RegionEditOutcome {
    return this.#regionEdit(
      this.#require().insert_vertex_json(
        JSON.stringify({ ...request, position: toWirePosition(request.position) }),
      ),
    );
  }

  removeVertex(nodeId: string, weldedEdgeId: string): RegionEditOutcome {
    return this.#regionEdit(this.#require().remove_vertex_json(JSON.stringify({ nodeId, weldedEdgeId })));
  }

  retypeEdge(edgeId: string, geometry: ConstructionEdgeGeometry): RegionEditOutcome {
    return this.#regionEdit(
      this.#require().retype_edge_json(JSON.stringify({ edgeId, geometry: toWireGeometry(geometry) })),
    );
  }

  moveEdge(edgeId: string, delta: ConstructionPosition): RegionEditOutcome {
    return this.#regionEdit(
      this.#require().move_edge_json(JSON.stringify({ edgeId, delta: toWirePosition(delta) })),
    );
  }

  addRegion(request: {
    readonly regionId: string;
    readonly outerLoops: readonly (readonly ConstructionOrientedEdgeUse[])[];
    readonly holes?: readonly (readonly ConstructionOrientedEdgeUse[])[];
    readonly surfaceType: string;
    readonly physical: boolean;
  }): RegionEditOutcome {
    return this.#regionEdit(
      this.#require().add_region_json(JSON.stringify({ holes: [], ...request })),
    );
  }

  addContourEdge(request: {
    readonly edgeId: string;
    readonly startNodeId: string;
    readonly endNodeId: string;
    readonly geometry: ConstructionEdgeGeometry;
  }): void {
    this.#require().add_contour_edge_json(
      JSON.stringify({ ...request, geometry: toWireGeometry(request.geometry) }),
    );
  }

  moveRegion(surfaceKey: ConstructionSurfaceKey, delta: ConstructionPosition): RegionEditOutcome {
    return this.#regionEdit(
      this.#require().move_region_json(JSON.stringify({ surfaceKey, delta: toWirePosition(delta) })),
    );
  }

  deleteRegion(surfaceKey: ConstructionSurfaceKey): RegionEditOutcome {
    return this.#regionEdit(this.#require().delete_region_json(JSON.stringify({ surfaceKey })));
  }

  deleteRegions(surfaceKeys: readonly ConstructionSurfaceKey[]): ConstructionRemovalOutcome {
    const responseJson = this.#require().delete_regions_json(JSON.stringify({ surfaceKeys }));
    const wire = JSON.parse(responseJson) as { exposedLoops: readonly (readonly RegionEdgeWire[])[] };
    return { ...this.#regionEdit(responseJson), exposedLoops: wire.exposedLoops };
  }

  getFootprintCoverage(
    polygon: readonly (readonly [number, number])[],
  ): readonly ConstructionCoveredRegion[] {
    const wire = JSON.parse(this.#require().footprint_coverage_json(JSON.stringify({ polygon }))) as {
      covered: readonly {
        surfaceKey: readonly string[];
        surfaceType: string;
        physical: boolean;
        coverage: ConstructionCoverageKind;
        centroid: WirePosition;
        nodeIds: readonly string[];
      }[];
    };
    return wire.covered.map((entry) => ({
      surfaceKey: entry.surfaceKey,
      surfaceType: entry.surfaceType,
      physical: entry.physical,
      coverage: entry.coverage,
      centroid: fromWirePosition(entry.centroid),
      nodeIds: entry.nodeIds,
    }));
  }

  duplicateRegion(request: {
    readonly surfaceKey: ConstructionSurfaceKey;
    readonly suffix: string;
    readonly offset: ConstructionPosition;
    readonly surfaceType: string;
    readonly physical: boolean;
  }): RegionEditOutcome {
    return this.#regionEdit(
      this.#require().duplicate_region_json(
        JSON.stringify({ ...request, offset: toWirePosition(request.offset) }),
      ),
    );
  }

  cutRegion(request: {
    readonly surfaceKey: ConstructionSurfaceKey;
    readonly cutPath: readonly ConstructionOrientedEdgeUse[];
    readonly firstRegionId: string;
    readonly secondRegionId: string;
  }): RegionEditOutcome {
    return this.#regionEdit(this.#require().cut_region_json(JSON.stringify(request)));
  }

  addHole(surfaceKey: ConstructionSurfaceKey, hole: readonly ConstructionOrientedEdgeUse[]): RegionEditOutcome {
    return this.#regionEdit(this.#require().add_hole_json(JSON.stringify({ surfaceKey, hole })));
  }

  removeHole(surfaceKey: ConstructionSurfaceKey, index: number): RegionEditOutcome {
    return this.#regionEdit(this.#require().remove_hole_json(JSON.stringify({ surfaceKey, index })));
  }

  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined {
    const wire = JSON.parse(this.#require().region_topology_json(JSON.stringify({ surfaceKey }))) as
      | RegionTopologyWire
      | null;
    return wire === null ? undefined : fromWireTopology(wire);
  }

  getAllRegionTopologies(): readonly ConstructionRegionTopology[] {
    const wire = JSON.parse(this.#require().all_region_topologies_json()) as readonly RegionTopologyWire[];
    return wire.map(fromWireTopology);
  }

  #regionEdit(responseJson: string): RegionEditOutcome {
    const wire = JSON.parse(responseJson) as {
      affectedSurfaceKeys: readonly (readonly string[])[];
      createdSurfaceKeys: readonly (readonly string[])[];
      removedSurfaceKeys: readonly (readonly string[])[];
      createdNodeIds: readonly string[];
      removedNodeIds: readonly string[];
    };
    return {
      affectedSurfaceKeys: wire.affectedSurfaceKeys,
      createdSurfaceKeys: wire.createdSurfaceKeys,
      removedSurfaceKeys: wire.removedSurfaceKeys,
      createdNodeIds: wire.createdNodeIds,
      removedNodeIds: wire.removedNodeIds,
    };
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
      samples: request.samples.map((sample) => [sample.x, sample.z]),
      brushShape: request.brushShape,
      depth: request.depth,
      sourceSurfaceTypes: request.sourceSurfaceTypes,
      targetSurfaceType: request.targetSurfaceType,
    };
    const session = this.#require() as ConstructionSession & {
      apply_path_brush_json(requestJson: string): string;
    };
    return this.#pathBrushOutcome(session.apply_path_brush_json(JSON.stringify(wire)));
  }

  previewPathBrush(request: ApplyPathBrushRequest): readonly SurfaceMeshResult[] {
    const wire = {
      operationId: request.operationId,
      samples: request.samples.map((sample) => [sample.x, sample.z]),
      brushShape: request.brushShape,
      depth: request.depth,
      sourceSurfaceTypes: request.sourceSurfaceTypes,
      targetSurfaceType: request.targetSurfaceType,
    };
    const session = this.#require() as ConstructionSession & {
      preview_path_brush_json(requestJson: string): string;
    };
    const response = JSON.parse(session.preview_path_brush_json(JSON.stringify(wire))) as readonly SurfaceMeshWire[];
    return response.map(toMeshResult);
  }
  undoPathBrush(operationId: string): void {
    const session = this.#require() as ConstructionSession & { undo_path_brush(operationId: string): void };
    session.undo_path_brush(operationId);
  }

  redoPathBrush(operationId: string): void {
    const session = this.#require() as ConstructionSession & { redo_path_brush(operationId: string): void };
    session.redo_path_brush(operationId);
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

  getSurfaceMesh(surfaceKey: ConstructionSurfaceKey): readonly SurfaceMeshResult[] {
    const wire = JSON.parse(
      this.#require().surface_mesh_json(JSON.stringify({ surfaceKey })),
    ) as readonly SurfaceMeshWire[];
    return wire.map(toMeshResult);
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
