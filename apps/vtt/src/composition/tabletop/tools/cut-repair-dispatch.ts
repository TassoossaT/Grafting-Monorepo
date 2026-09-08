// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type {
  ApplyPatchReplacementRequest,
  ConstructionEdge,
  ConstructionNodeId,
  ConstructionPatch,
  ConstructionPatchOutcome,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
  ConstructionTopologyBoundsQuery,
} from "@/ports";
import {
  outwardPerimeterRings,
  resolveCoverage,
  resolveCreationInteraction,
  resolveCutRepair,
  type CutFallout,
} from "../../../features/edit-construction/index.ts";
import { repairTerrainCut, type TerrainRegenerateRuntime } from "./terrain/terrain-regenerate.ts";

import type { TabletopRuntime } from "../tabletop-runtime.ts";
import { reportToolFailure } from "./core/tool-diagnostics.ts";

/**
 * One covered type's own answer to being cut -- `resolveCutRepair`'s
 * `"regenerate"`, made real. The type itself owns the whole thing, decision
 * and execution both (`repairTerrainCut`, `tools/terrain/terrain-regenerate.ts`);
 * this only needs to know it by a runtime-shaped signature, never a
 * concrete `TabletopRuntime` import, so this table stays as thin as the
 * types it points at.
 */
export type CutRepairExecutor = (
  runtime: TerrainRegenerateRuntime,
  fallout: CutFallout,
  causeId: string,
  tableId: string,
) => number;

/**
 * Every structure type that has actually implemented `resolveCutRepair`'s
 * `"regenerate"` answer, keyed by `surfaceType`.
 *
 * `dispatchCutRepairs` is this table's only reader: it already knows, from
 * `resolveCutRepair` itself, which consumed region's type is entitled to a
 * repair -- this is only where it finds *whose* code to call for one. A
 * type absent here despite `resolveCutRepair` answering `"regenerate"` for
 * it is a declaration nobody has built yet, not a contradiction; a missing
 * entry is treated as nothing to do.
 */
export const CUT_REPAIR_EXECUTORS: Readonly<Record<string, CutRepairExecutor>> = Object.freeze({
  terrain: repairTerrainCut,
  "terrain-grass": repairTerrainCut,
});

/**
 * Reconstructs region topologies from a patch directly when they are not yet
 * retrievable from the engine or runtime queries.
 */
function topologiesFromPatch(
  patch: ConstructionPatch,
  runtime: Pick<TabletopRuntime, "getSnapshot">,
): readonly ConstructionRegionTopology[] {
  const edgeById = new Map<string, ConstructionEdge>();
  for (const edge of patch.edges) edgeById.set(edge.id, edge);
  const nodeById = new Map<string, ConstructionPosition>();
  for (const node of patch.nodes) nodeById.set(node.id, node.position);
  const liveNodes = runtime.getSnapshot().map.nodePositions;

  return patch.regions.map((region) => {
    const regionEdges: ConstructionRegionEdge[] = [];
    const regionNodes = new Map<string, ConstructionPosition>();
    for (const use of region.boundary) {
      const edge = edgeById.get(use.edgeId);
      const startId = edge ? (use.reversed ? edge.endNodeId : edge.startNodeId) : "";
      const endId = edge ? (use.reversed ? edge.startNodeId : edge.endNodeId) : "";
      const startPos = startId ? (nodeById.get(startId) ?? liveNodes.get(startId)?.position) : undefined;
      const endPos = endId ? (nodeById.get(endId) ?? liveNodes.get(endId)?.position) : undefined;
      if (startId && startPos) regionNodes.set(startId, startPos);
      if (endId && endPos) regionNodes.set(endId, endPos);
      regionEdges.push({
        edgeId: use.edgeId,
        reversed: use.reversed,
        startNodeId: startId,
        endNodeId: endId,
        geometry: edge?.geometry,
      });
    }
    return {
      surfaceKey: ["@region", region.regionId],
      surfaceType: region.surfaceType,
      nodes: [...regionNodes].map(([id, position]) => ({ id, position })),
      outerLoops: [regionEdges],
      holes: [],
    };
  });
}

/**
 * Fast spatial bucketing for proximity queries against road points.
 */
function pointBucketIndex(points: readonly ConstructionPosition[], cellSize: number) {
  const buckets = new Map<string, ConstructionPosition[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`;
  for (const pt of points) {
    const k = key(pt.x, pt.z);
    const list = buckets.get(k);
    if (list === undefined) buckets.set(k, [pt]);
    else list.push(pt);
  }
  const maxDistSq = cellSize * cellSize;

  return {
    isNear(x: number, z: number): boolean {
      const col = Math.floor(x / cellSize);
      const row = Math.floor(z / cellSize);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const list = buckets.get(`${col + dx}:${row + dz}`);
          if (list !== undefined) {
            for (const pt of list) {
              const ddx = x - pt.x;
              const ddz = z - pt.z;
              if (ddx * ddx + ddz * ddz <= maxDistSq) return true;
            }
          }
        }
      }
      return false;
    },
  };
}

/**
 * The painter's own ground, as the repair needs it: its real nodes to weld
 * onto, and one closed ring per face it owns so the area it occupies can be
 * taken out of the hole.
 *
 * Read from **every live face of the painter's type**, optionally scoped
 * to bounds.
 */
export function paintedNodesOf(
  runtime: Pick<TabletopRuntime, "getAllRegionTopologies" | "getRegionTopologiesInBounds" | "getSnapshot">,
  paintedType: string,
  bounds?: ConstructionTopologyBoundsQuery,
): Pick<CutFallout, "paintedNodes" | "paintedLoops"> {
  const topologies = bounds !== undefined && typeof runtime.getRegionTopologiesInBounds === "function"
    ? runtime.getRegionTopologiesInBounds(bounds)
    : runtime.getAllRegionTopologies();
  const painted = topologies.filter((topology) => topology.surfaceType === paintedType);
  const nodesById = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const topology of painted) {
    for (const node of topology.nodes) nodesById.set(node.id, node.position);
  }
  return {
    paintedNodes: [...nodesById].map(([id, position]) => ({ id, position })),
    paintedLoops: outwardPerimeterRings(painted),
  };
}

/**
 * Resolves type interference between an acting structure (e.g. `path`) and any
 * covered structures (e.g. `terrain`) that declare `repairAfterCut: "regenerate"`.
 *
 * Fully decoupled from UI tools: operates purely on structure types, topologies,
 * and geometric footprints. Handles full-road creations, replacements, movements,
 * and deletions where the entire affected terrain corridor is regenerated cleanly,
 * filling vacated voids and stitching seamlessly along the entire new road perimeter.
 */
export function dispatchCutRepairs(
  runtime: TabletopRuntime,
  request: ApplyPatchReplacementRequest,
  causeId: string,
  replacedTopologies: readonly ConstructionRegionTopology[] = [],
  outcome?: ConstructionPatchOutcome,
  executors: Readonly<Record<string, CutRepairExecutor>> = CUT_REPAIR_EXECUTORS,
): void {
  const paintedType = request.patch.regions[0]?.surfaceType ?? replacedTopologies[0]?.surfaceType;
  if (paintedType === undefined) return;

  const targetTypes = ["terrain", "terrain-grass"].filter((coveredType) => {
    const interaction = resolveCreationInteraction(paintedType, coveredType);
    const repair = resolveCutRepair(coveredType);
    return interaction.kind === "cut" && repair.kind === "regenerate";
  });
  if (targetTypes.length === 0) return;

  // Retrieve new road topologies
  let newRoadTopologies: readonly ConstructionRegionTopology[] = [];
  if (outcome?.createdSurfaceKeys && outcome.createdSurfaceKeys.length > 0 && typeof runtime.getRegionTopology === "function") {
    newRoadTopologies = outcome.createdSurfaceKeys
      .map((k) => {
        try {
          return runtime.getRegionTopology(k);
        } catch {
          return undefined;
        }
      })
      .filter((t): t is ConstructionRegionTopology => t !== undefined && t.surfaceType === paintedType);
  }
  if (newRoadTopologies.length === 0 && request.patch.regions.length > 0) {
    newRoadTopologies = topologiesFromPatch(request.patch, runtime);
  }

  // Collect all road positions and node IDs across both new and replaced geometry
  const allRoadPositions: ConstructionPosition[] = [];
  const roadNodeIds = new Set<string>();
  for (const t of newRoadTopologies) {
    for (const n of t.nodes) {
      allRoadPositions.push(n.position);
      roadNodeIds.add(n.id);
    }
  }
  for (const t of replacedTopologies) {
    for (const n of t.nodes) {
      allRoadPositions.push(n.position);
      roadNodeIds.add(n.id);
    }
  }
  for (const n of request.patch.nodes) {
    allRoadPositions.push(n.position);
    roadNodeIds.add(n.id);
  }
  for (const n of request.graphPatch?.nodes ?? []) {
    allRoadPositions.push(n.position);
    roadNodeIds.add(n.id);
  }
  if (request.footprintOutline) {
    for (const [x, z] of request.footprintOutline) {
      allRoadPositions.push({ x, y: 0, z });
    }
  }

  if (allRoadPositions.length === 0) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const pos of allRoadPositions) {
    if (pos.x < minX) minX = pos.x;
    if (pos.x > maxX) maxX = pos.x;
    if (pos.z < minZ) minZ = pos.z;
    if (pos.z > maxZ) maxZ = pos.z;
  }

  const margin = 4.0;
  const bounds: ConstructionTopologyBoundsQuery = {
    minX: minX - margin,
    minZ: minZ - margin,
    maxX: maxX + margin,
    maxZ: maxZ + margin,
  };

  const topologiesInBounds = typeof runtime.getRegionTopologiesInBounds === "function"
    ? runtime.getRegionTopologiesInBounds(bounds)
    : runtime.getAllRegionTopologies();

  const candidateTerrain = topologiesInBounds.filter((t) => targetTypes.includes(t.surfaceType));
  if (candidateTerrain.length === 0) return;

  const outlineCoverageKeys = new Set<string>();
  if (request.footprintOutline && request.footprintOutline.length >= 3 && typeof runtime.getFootprintCoverage === "function") {
    try {
      for (const entry of runtime.getFootprintCoverage(request.footprintOutline)) {
        if (targetTypes.includes(entry.surfaceType)) {
          outlineCoverageKeys.add(entry.surfaceKey.join("/"));
        }
      }
    } catch {
      // best-effort coverage query
    }
  }

  const indexer = pointBucketIndex(allRoadPositions, 3.5);
  const consumedByType = new Map<string, ConstructionSurfaceKey[]>();

  for (const t of candidateTerrain) {
    const sharesNode = t.nodes.some((n) => roadNodeIds.has(n.id));
    const inCoverage = outlineCoverageKeys.has(t.surfaceKey.join("/"));
    const cx = t.nodes.length > 0 ? t.nodes.reduce((sum, n) => sum + n.position.x, 0) / t.nodes.length : 0;
    const cz = t.nodes.length > 0 ? t.nodes.reduce((sum, n) => sum + n.position.z, 0) / t.nodes.length : 0;
    const nearRoad = indexer.isNear(cx, cz) || t.nodes.some((n) => indexer.isNear(n.position.x, n.position.z));

    if (sharesNode || inCoverage || nearRoad) {
      const keys = consumedByType.get(t.surfaceType) ?? [];
      keys.push(t.surfaceKey);
      consumedByType.set(t.surfaceType, keys);
    }
  }

  if (consumedByType.size === 0) return;

  // Derive painted loops and nodes scoped to the affected road
  let paintedLoops: readonly (readonly ConstructionRegionEdge[])[] = [];
  let paintedNodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [];

  if (newRoadTopologies.length > 0) {
    const roadInBounds = topologiesInBounds.filter((t) => t.surfaceType === paintedType);
    const roadToUse = roadInBounds.length > 0 ? roadInBounds : newRoadTopologies;
    paintedLoops = outwardPerimeterRings(roadToUse);
    const nodesById = new Map<ConstructionNodeId, ConstructionPosition>();
    for (const t of roadToUse) {
      for (const n of t.nodes) nodesById.set(n.id, n.position);
    }
    paintedNodes = [...nodesById].map(([id, position]) => ({ id, position }));
  }

  for (const [surfaceType, consumedSurfaceKeys] of consumedByType) {
    const executor = executors[surfaceType];
    if (executor === undefined) continue;
    try {
      executor(runtime, { paintedNodes, paintedLoops, consumedSurfaceKeys }, causeId, runtime.getSnapshot().tableId);
    } catch (error) {
      reportToolFailure("cut-repair", `repair ${surfaceType} after a cut`, { causeId, consumedSurfaceKeys }, error);
    }
  }
}

/**
 * Resolves post-removal cut repair for a directly removed surface.
 *
 * If the removed surface is a regenerating type (e.g. `terrain`), regenerates its hole.
 * If the removed surface is an acting cutter (e.g. `path`) that was cutting a regenerating
 * type, heals the vacated terrain hole.
 */
export function dispatchRemovalRepairs(
  runtime: TabletopRuntime,
  surfaceKey: ConstructionSurfaceKey,
  surfaceType: string,
  causeId: string,
  removedTopologyOrExecutors?: ConstructionRegionTopology | Readonly<Record<string, CutRepairExecutor>>,
  maybeExecutors: Readonly<Record<string, CutRepairExecutor>> = CUT_REPAIR_EXECUTORS,
): void {
  const removedTopology = (removedTopologyOrExecutors !== undefined && "surfaceKey" in removedTopologyOrExecutors)
    ? removedTopologyOrExecutors
    : undefined;
  const executors = (removedTopologyOrExecutors !== undefined && !("surfaceKey" in removedTopologyOrExecutors))
    ? (removedTopologyOrExecutors as Readonly<Record<string, CutRepairExecutor>>)
    : maybeExecutors;

  const repair = resolveCutRepair(surfaceType);
  if (repair.kind === "regenerate") {
    const executor = executors[surfaceType];
    if (executor === undefined) return;

    try {
      executor(
        runtime,
        {
          consumedSurfaceKeys: [surfaceKey],
          paintedNodes: [],
          paintedLoops: [],
        },
        causeId,
        runtime.getSnapshot().tableId,
      );
    } catch (error) {
      reportToolFailure("cut-repair", `repair ${surfaceType} after removal`, { causeId, surfaceKey }, error);
    }
    return;
  }

  if (removedTopology !== undefined) {
    const targetTypes = ["terrain", "terrain-grass"].filter((coveredType) => {
      const interaction = resolveCreationInteraction(surfaceType, coveredType);
      const rep = resolveCutRepair(coveredType);
      return interaction.kind === "cut" && rep.kind === "regenerate";
    });
    if (targetTypes.length > 0) {
      dispatchCutRepairs(
        runtime,
        {
          operationId: causeId,
          sourceSurfaceKeys: [surfaceKey],
          patch: { nodes: [], edges: [], regions: [] },
        },
        causeId,
        [removedTopology],
        undefined,
        executors,
      );
    }
  }
}
