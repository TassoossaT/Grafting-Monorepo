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
  ApplyPatchReplacementRequest,
  ApplyRegionOverlayRequest,
  CloudOutcome,
  CloudRequest,
  ConstructionBoundsXZ,
  ConstructionCoverageKind,
  ConstructionCoveredRegion,
  ConstructionEdgeGeometry,
  ConstructionNodeId,
  ConstructionNodeSnapshot,
  ConstructionGraphSnapshot,
  ConstructionIrregularQuadGrid,
  ConstructionIrregularQuadGridRequest,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionPatchOutcome,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSessionPort,
  ConstructionSurfaceKey,
  ConstructionUnfilledLoop,
  DiffOutcome,
  GenerateRegionPartitionRequest,
  RegionEditOutcome,
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

interface RegionEditOutcomeWire {
  readonly affectedSurfaceKeys: readonly (readonly string[])[];
  readonly createdSurfaceKeys: readonly (readonly string[])[];
  readonly removedSurfaceKeys: readonly (readonly string[])[];
  readonly createdNodeIds: readonly string[];
  readonly removedNodeIds: readonly string[];
}

function fromWireOutcome(wire: RegionEditOutcomeWire): RegionEditOutcome {
  return {
    affectedSurfaceKeys: wire.affectedSurfaceKeys,
    createdSurfaceKeys: wire.createdSurfaceKeys,
    removedSurfaceKeys: wire.removedSurfaceKeys,
    createdNodeIds: wire.createdNodeIds,
    removedNodeIds: wire.removedNodeIds,
  };
}

function toWirePosition(position: ConstructionPosition): WirePosition {
  return [position.x, position.y, position.z];
}

function fromWirePosition(position: WirePosition): ConstructionPosition {
  const [x, y, z] = position;
  return { x, y, z };
}

interface SnapshotWire {
  readonly nodes: readonly { readonly id: string; readonly position: WirePosition }[];
  readonly edges: readonly { readonly id: string; readonly source: string; readonly target: string }[];
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

interface SurfaceMeshWire {
  readonly surfaceKey: readonly string[];
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  /**
   * Flat `uv` pairs in world units -- how far along the surface's own extent
   * each vertex sits, in metres, rather than normalised to `0..1`. See
   * `grafting_procgen_surface_mesh::TriangulatedMesh::uvs`.
   */
  readonly uvs: readonly number[];
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
      uvs: Float32Array.from(wire.uvs),
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

  addHole(request: {
    readonly surfaceKey: ConstructionSurfaceKey;
    readonly hole: readonly ConstructionOrientedEdgeUse[];
  }): RegionEditOutcome {
    return this.#regionEdit(this.#require().add_hole_json(JSON.stringify(request)));
  }

  removeHole(request: { readonly surfaceKey: ConstructionSurfaceKey; readonly index: number }): RegionEditOutcome {
    return this.#regionEdit(this.#require().remove_hole_json(JSON.stringify(request)));
  }

  addPatch(patch: ConstructionPatch): ConstructionPatchOutcome {
    const wire = JSON.parse(
      this.#require().add_patch_json(
        JSON.stringify({
          nodes: patch.nodes.map((node: ConstructionPatch["nodes"][number]) => ({
            id: node.id,
            position: toWirePosition(node.position),
          })),
          edges: patch.edges,
          regions: patch.regions,
        }),
      ),
    ) as { readonly outcome: RegionEditOutcomeWire; readonly skippedRegionIds: readonly string[]; readonly skippedRegionReasons?: readonly string[] };
    return { ...fromWireOutcome(wire.outcome), skippedRegionIds: wire.skippedRegionIds, skippedRegionReasons: wire.skippedRegionReasons ?? [] };
  }

  getUnfilledLoops(scope: readonly ConstructionNodeId[]): readonly ConstructionUnfilledLoop[] {
    if (scope.length === 0) return [];
    const wire = JSON.parse(this.#require().unfilled_loops_json(JSON.stringify({ nodeIds: scope }))) as {
      readonly loops: readonly {
        readonly boundary: readonly { readonly edgeId: string; readonly reversed: boolean }[];
        readonly nodeIds: readonly string[];
        readonly centroid: WirePosition;
        readonly neighbours: readonly { readonly surfaceType: string; readonly physical: boolean }[];
      }[];
    };
    return wire.loops.map((entry) => ({
      boundary: entry.boundary,
      nodeIds: entry.nodeIds,
      centroid: fromWirePosition(entry.centroid),
      neighbours: entry.neighbours,
    }));
  }

  moveRegion(surfaceKey: ConstructionSurfaceKey, delta: ConstructionPosition): RegionEditOutcome {
    return this.#regionEdit(
      this.#require().move_region_json(JSON.stringify({ surfaceKey, delta: toWirePosition(delta) })),
    );
  }

  deleteRegion(surfaceKey: ConstructionSurfaceKey): RegionEditOutcome {
    return this.#regionEdit(this.#require().delete_region_json(JSON.stringify({ surfaceKey })));
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

  classifyPoints(
    points: readonly (readonly [number, number])[],
  ): readonly { readonly index: number; readonly surfaceKey: ConstructionSurfaceKey; readonly surfaceType: string }[] {
    const wire = JSON.parse(this.#require().classify_points_json(JSON.stringify({ points }))) as {
      hits: readonly { index: number; surfaceKey: readonly string[]; surfaceType: string }[];
    };
    return wire.hits;
  }

  generateIrregularQuadGrid(
    request: ConstructionIrregularQuadGridRequest,
  ): ConstructionIrregularQuadGrid | undefined {
    let raw: string;
    try {
      const { relaxStrength, ...rest } = request;
      raw = this.#require().irregular_quad_grid_json(
        // `relax` only when there is something to say: the engine fills in
        // every knob the caller left out, so an absent block is its standard
        // rather than a set of values this side would have to keep in step.
        JSON.stringify(relaxStrength === undefined ? rest : { ...rest, relax: { strength: relaxStrength } }),
      );
    } catch {
      // A refusal, not a failure. The engine answers this way when the
      // contours describe no ground it can triangulate -- degenerate rings,
      // a hole that swallows its own boundary. The caller leaves what is
      // standing alone, which is why this is `undefined` at the port rather
      // than an exception the tool would have to guess the meaning of.
      return undefined;
    }
    const wire = JSON.parse(raw) as {
      readonly vertices: readonly { readonly x: number; readonly z: number; readonly source: number | null }[];
      readonly quads: readonly (readonly [number, number, number, number])[];
      readonly onContour: readonly {
        readonly vertex: number;
        readonly ringKind: "boundary" | "hole";
        readonly ring: number;
        readonly segment: number;
      }[];
      readonly refinementComplete: boolean;
    };
    return {
      vertices: wire.vertices.map((vertex) =>
        vertex.source === null ? { x: vertex.x, z: vertex.z } : { x: vertex.x, z: vertex.z, source: vertex.source },
      ),
      quads: wire.quads,
      onContour: wire.onContour,
      refinementComplete: wire.refinementComplete,
    };
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

  getRegionTopologiesInBounds(bounds: ConstructionBoundsXZ): readonly ConstructionRegionTopology[] {
    const session = this.#require() as ConstructionSession & {
      region_topologies_in_bounds_json(requestJson: string): string;
    };
    const wire = JSON.parse(session.region_topologies_in_bounds_json(JSON.stringify(bounds))) as readonly RegionTopologyWire[];
    return wire.map(fromWireTopology);
  }

  #regionEdit(responseJson: string): RegionEditOutcome {
    return fromWireOutcome(JSON.parse(responseJson) as RegionEditOutcomeWire);
  }

  applyRegionOverlay(request: ApplyRegionOverlayRequest): ConstructionPatchOutcome {
    const session = this.#require() as ConstructionSession & {
      apply_region_overlay_json(requestJson: string): string;
    };
    const patch = {
      nodes: request.patch.nodes.map((node) => ({ id: node.id, position: toWirePosition(node.position) })),
      edges: request.patch.edges,
      regions: request.patch.regions,
    };
    const wire = JSON.parse(session.apply_region_overlay_json(JSON.stringify({
      operationId: request.operationId,
      sourceSurfaceKeys: request.sourceSurfaceKeys,
      outline: request.outline,
      boundary: request.boundary,
      patch,
    }))) as { readonly outcome: RegionEditOutcomeWire; readonly skippedRegionIds: readonly string[]; readonly skippedRegionReasons?: readonly string[] };
    return { ...fromWireOutcome(wire.outcome), skippedRegionIds: wire.skippedRegionIds, skippedRegionReasons: wire.skippedRegionReasons ?? [] };
  }

  applyPatchReplacement(request: ApplyPatchReplacementRequest): ConstructionPatchOutcome {
    const session = this.#require() as ConstructionSession & {
      apply_patch_replacement_json(requestJson: string): string;
    };
    const patch = {
      nodes: request.patch.nodes.map((node) => ({ id: node.id, position: toWirePosition(node.position) })),
      edges: request.patch.edges,
      regions: request.patch.regions,
    };
    const wire = JSON.parse(session.apply_patch_replacement_json(JSON.stringify({
      operationId: request.operationId,
      sourceSurfaceKeys: request.sourceSurfaceKeys,
      graphPatch: request.graphPatch === undefined ? undefined : {
        nodes: request.graphPatch.nodes.map((node) => ({ id: node.id, position: toWirePosition(node.position) })),
        removedEdgeIds: request.graphPatch.removedEdgeIds,
        edges: request.graphPatch.edges,
      },
      patch,
    }))) as { readonly outcome: RegionEditOutcomeWire; readonly skippedRegionIds: readonly string[]; readonly skippedRegionReasons?: readonly string[] };
    return { ...fromWireOutcome(wire.outcome), skippedRegionIds: wire.skippedRegionIds, skippedRegionReasons: wire.skippedRegionReasons ?? [] };
  }

  undoRegionOverlay(operationId: string): void {
    const session = this.#require() as ConstructionSession & { undo_region_overlay(id: string): void };
    session.undo_region_overlay(operationId);
  }

  redoRegionOverlay(operationId: string): void {
    const session = this.#require() as ConstructionSession & { redo_region_overlay(id: string): void };
    session.redo_region_overlay(operationId);
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

  cloudFor(request: CloudRequest): CloudOutcome {
    const response = JSON.parse(
      this.#require().cloud_json(JSON.stringify({ seed: request.seed, surfaceType: request.surfaceType })),
    ) as { surfaceKeys: readonly (readonly string[])[] };
    return { surfaceKeys: response.surfaceKeys };
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
    return this.getGraphSnapshot().nodes;
  }

  getGraphSnapshot(): ConstructionGraphSnapshot {
    const wire = JSON.parse(this.#require().snapshot_json()) as SnapshotWire;
    return {
      nodes: wire.nodes.map((node) => ({ id: node.id, position: fromWirePosition(node.position) })),
      edges: wire.edges.map((edge) => ({ edgeId: edge.id, startNodeId: edge.source, endNodeId: edge.target })),
    };
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
