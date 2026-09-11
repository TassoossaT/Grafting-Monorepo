// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type {
  ApplyPatchReplacementRequest,
  ConstructionNodeId,
  ConstructionPatch,
  ConstructionPatchEdge,
  ConstructionPatchOutcome,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
  ConstructionTopologyBoundsQuery,
} from "@/ports";
import {
  planTerrainCloudCutRepair,
  resolveCreationInteraction,
  resolveCutRepair,
  terrainTopologiesBounds,
  type CutFallout,
} from "../../../features/edit-construction/index.ts";
import { repairTerrainCut, type TerrainRegenerateRuntime } from "../terrain/terrain-regenerate.ts";
import { paintedFalloutOf } from "./painted-topologies.ts";
import { pointInOrOnPolygon } from "../../../features/edit-construction/index.ts";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";

import type { TabletopRuntime } from "../tabletop-runtime.ts";

/**
 * One covered type's own answer to being cut -- `resolveCutRepair`'s
 * `"regenerate"`, made real. The type itself owns the whole thing, decision
 * and execution both (`repairTerrainCut`, `terrain/terrain-regenerate.ts`);
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
 * Ground the painter used to stand on and no longer does, or the other way
 * round -- the places its shape actually changed.
 *
 * **Why this is a shape question and not an identity one.** A path mints every
 * contour node from the operation id (`contour-patch.ts`), so regenerating its
 * cloud re-mints *every* node in the whole connected component, however far
 * from the stroke. "Terrain holding a node the painter replaced" is therefore
 * true of every metre of ground the road touches, on every stroke, and using it
 * to decide what to repair means regenerating the entire terrain corridor each
 * time. Identity cannot contain this while the painter throws its own away.
 *
 * The shape can. Where the road came back over exactly the ground it left, the
 * terrain beside it still meets the same boundary in the same place and has
 * nothing to fix; where the road actually moved, it does. This is a geometric
 * question answered geometrically -- it decides *how much* to regenerate and
 * never which node is which, so it is not the proximity matching this pipeline
 * bans.
 *
 * Slivers are discarded. Re-flattening a curve lands its samples fractionally
 * off the last ones all along its length, so the difference of two runs of the
 * same road is a hairline following the whole network. `2*area/perimeter` is a
 * strip's width, and anything thinner than {@link ROAD_REALLY_MOVED} is
 * re-sampling noise rather than a road that went somewhere.
 */
const ROAD_REALLY_MOVED = 0.05;

function areaPolygonsOf(topologies: readonly ConstructionRegionTopology[]): Polygon[] {
  const polygons: Polygon[] = [];
  for (const topology of topologies) {
    const at = new Map<string, { x: number; z: number }>();
    for (const node of topology.nodes) at.set(node.id, { x: node.position.x, z: node.position.z });
    for (const loop of topology.outerLoops) {
      const ring: [number, number][] = [];
      let complete = true;
      for (const use of loop) {
        const position = at.get(use.startNodeId);
        if (position === undefined) { complete = false; break; }
        ring.push([position.x, position.z]);
      }
      if (!complete || ring.length < 3) continue;
      ring.push([ring[0]![0], ring[0]![1]]);
      const holes: [number, number][][] = [];
      for (const holeLoop of topology.holes) {
        const holeRing: [number, number][] = [];
        let holeComplete = true;
        for (const use of holeLoop) {
          const position = at.get(use.startNodeId);
          if (position === undefined) { holeComplete = false; break; }
          holeRing.push([position.x, position.z]);
        }
        if (holeComplete && holeRing.length >= 3) {
          holeRing.push([holeRing[0]![0], holeRing[0]![1]]);
          holes.push(holeRing);
        }
      }
      polygons.push([ring, ...holes]);
    }
  }
  return polygons;
}

function unionOf(polygons: readonly Polygon[]): MultiPolygon {
  if (polygons.length === 0) return [];
  try {
    return polygonClipping.union(polygons[0]!, ...polygons.slice(1));
  } catch {
    return [];
  }
}

function widthOfPiece(piece: MultiPolygon[number]): number {
  let area = 0;
  let perimeter = 0;
  for (const ring of piece) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const [ax, az] = ring[index]!;
      const [bx, bz] = ring[index + 1]!;
      area += ax * bz - bx * az;
      perimeter += Math.hypot(bx - ax, bz - az);
    }
  }
  if (perimeter <= 1e-9) return 0;
  return Math.abs(area) / perimeter;
}

function groundThePainterMovedOff(
  before: readonly ConstructionRegionTopology[],
  after: readonly ConstructionRegionTopology[],
): MultiPolygon {
  const was = unionOf(areaPolygonsOf(before));
  const is = unionOf(areaPolygonsOf(after));
  if (was.length === 0) return [];
  if (is.length === 0) return was;
  let moved: MultiPolygon;
  try {
    moved = polygonClipping.difference(was, is);
  } catch {
    return was;
  }
  return moved.filter((piece) => widthOfPiece(piece) >= ROAD_REALLY_MOVED);
}

/** Even-odd across every ring of a multipolygon, holes included. */
function insideAny(x: number, z: number, polygon: MultiPolygon): boolean {
  for (const piece of polygon) {
    let crossings = 0;
    for (const ring of piece) {
      if (pointInOrOnPolygon(x, z, ring)) crossings += 1;
    }
    if (crossings % 2 === 1) return true;
  }
  return false;
}

/**
 * Reconstructs region topologies from a patch directly when they are not yet
 * retrievable from the engine or runtime queries.
 */
function topologiesFromPatch(
  patch: ConstructionPatch,
  runtime: Pick<TabletopRuntime, "getSnapshot">,
): readonly ConstructionRegionTopology[] {
  const edgeById = new Map<string, ConstructionPatchEdge>();
  for (const edge of patch.edges) edgeById.set(edge.edgeId ?? (edge as unknown as { id: string }).id, edge);
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
        geometry: edge?.geometry ?? { kind: "line" },
      });
    }
    return {
      surfaceKey: ["@region", region.regionId],
      surfaceType: region.surfaceType,
      physical: region.physical,
      nodes: [...regionNodes].map(([id, position]) => ({ id, position })),
      outerLoops: [regionEdges],
      holes: [],
    };
  });
}

/**
 * Fast spatial bucketing for proximity queries against road points.
 */
export function pointBucketIndex(points: readonly ConstructionPosition[], cellSize: number) {
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

export { paintedFalloutOf, paintedNodesOf, paintedTopologiesOf } from "./painted-topologies.ts";

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

  // Collect all road positions across both new and replaced geometry
  const allRoadPositions: ConstructionPosition[] = [];
  const replacedNodeIds = new Set<string>();
  for (const t of newRoadTopologies) {
    for (const n of t.nodes) {
      allRoadPositions.push(n.position);
    }
  }
  for (const t of replacedTopologies) {
    for (const n of t.nodes) {
      allRoadPositions.push(n.position);
      replacedNodeIds.add(n.id);
    }
  }
  for (const n of request.patch.nodes) {
    allRoadPositions.push(n.position);
  }
  for (const n of request.graphPatch?.nodes ?? []) {
    allRoadPositions.push(n.position);
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
  if (request.footprintOutline && request.footprintOutline.length >= 3) {
    for (const [x, z] of request.footprintOutline) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  } else {
    for (const pos of allRoadPositions) {
      if (pos.x < minX) minX = pos.x;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.z < minZ) minZ = pos.z;
      if (pos.z > maxZ) maxZ = pos.z;
    }
  }

  const margin = 2.5;
  const bounds: ConstructionTopologyBoundsQuery = {
    minX: minX - margin,
    minZ: minZ - margin,
    maxX: maxX + margin,
    maxZ: maxZ + margin,
  };

  const topologiesInBounds = typeof runtime.getRegionTopologiesInBounds === "function"
    ? runtime.getRegionTopologiesInBounds(bounds)
    : runtime.getAllRegionTopologies();

  const underFootprint = topologiesInBounds.filter((t) => {
    if (!targetTypes.includes(t.surfaceType)) return false;
    if (request.footprintOutline && request.footprintOutline.length >= 3) {
      // The query above is deliberately broad (an AABB), but it must not
      // become the repair scope. Using any node in the box pulled in large
      // terrain faces beside long/curved roads and caused their whole cloud
      // to be split and re-minted. Use the actual footprint for the final
      // admission test; the terrain planner will still include faces that
      // are truly covered through its coverage/edge checks.
      const center = t.nodes.reduce(
        (sum, n) => ({ x: sum.x + n.position.x, z: sum.z + n.position.z }),
        { x: 0, z: 0 },
      );
      if (t.nodes.length === 0) return false;
      center.x /= t.nodes.length;
      center.z /= t.nodes.length;
      const footprint = request.footprintOutline.map(([x, z]) => [x, z] as [number, number]);
      return pointInOrOnPolygon(center.x, center.z, footprint) || t.nodes.some((n) => pointInOrOnPolygon(n.position.x, n.position.z, footprint));
    }
    return true;
  });

  // Build solid polygons of new road topologies so any terrain face covered by the road is consumed
  const liveNodes = runtime.getSnapshot().map.nodePositions;
  const cutterPolygons: {
    outer: [number, number][];
    holes: [number, number][][];
  }[] = [];
  for (const road of newRoadTopologies) {
    if (road.outerLoops.length === 0) continue;
    const outer: [number, number][] = [];
    for (const edge of road.outerLoops[0]!) {
      const p = liveNodes.get(edge.startNodeId)?.position ?? road.nodes.find((n) => n.id === edge.startNodeId)?.position;
      if (p) outer.push([p.x, p.z]);
    }
    if (outer.length < 3) continue;
    outer.push([outer[0]![0], outer[0]![1]]);

    const holes: [number, number][][] = [];
    for (const holeLoop of road.holes) {
      const hole: [number, number][] = [];
      for (const edge of holeLoop) {
        const p = liveNodes.get(edge.startNodeId)?.position ?? road.nodes.find((n) => n.id === edge.startNodeId)?.position;
        if (p) hole.push([p.x, p.z]);
      }
      if (hole.length >= 3) {
        hole.push([hole[0]![0], hole[0]![1]]);
        holes.push(hole);
      }
    }
    cutterPolygons.push({ outer, holes });
  }

  const newNodeIds = new Set(newRoadTopologies.flatMap((t) => t.nodes.map((n) => n.id)));
  const trulyDestroyedNodeIds = new Set<string>();
  for (const id of replacedNodeIds) {
    if (!newNodeIds.has(id)) trulyDestroyedNodeIds.add(id);
  }
  if (outcome?.removedNodeIds) {
    for (const id of outcome.removedNodeIds) trulyDestroyedNodeIds.add(id);
  }

  // A destroyed node that no new road node stands near (>= ROAD_REALLY_MOVED)
  // was genuinely moved or abandoned by the road. Any terrain face holding it
  // has to be regenerated to meet the new road contour. A node whose position
  // did not move was merely re-minted, which is no reason to regenerate ground.
  const newRoadPositions = newRoadTopologies.flatMap((t) => t.nodes.map((n) => n.position));
  const newRoadSpatial = pointBucketIndex(newRoadPositions, ROAD_REALLY_MOVED);
  const abandonedNodeIds = new Set<string>();
  for (const t of replacedTopologies) {
    for (const n of t.nodes) {
      if (trulyDestroyedNodeIds.has(n.id) && !newRoadSpatial.isNear(n.position.x, n.position.z)) {
        abandonedNodeIds.add(n.id);
      }
    }
  }

  // **Ground the painter is about to orphan, wherever it stands.**
  //
  // A stroke's footprint is what that stroke claims. What it *destroys* is a
  // different set and a much larger one: a path regenerates its whole
  // connected component and re-mints every node in it, including the ones a
  // terrain repair split into its edges so the two could share a corner. Every
  // one of those corners stops existing, and the terrain holding them is
  // mostly nowhere near the stroke -- so scoping the search to the footprint
  // meant it was never looked for. It kept naming dead nodes, and the road
  // visibly came apart from the ground as the network filled in.
  const orphaned: ConstructionRegionTopology[] = [];
  const changed = groundThePainterMovedOff(replacedTopologies, newRoadTopologies);
  if (replacedTopologies.length > 0) {
    const replacedBounds = terrainTopologiesBounds(replacedTopologies, 4.0);
    const near = typeof runtime.getRegionTopologiesInBounds === "function"
      ? runtime.getRegionTopologiesInBounds(replacedBounds)
      : runtime.getAllRegionTopologies();
    for (const t of near) {
      if (!targetTypes.includes(t.surfaceType)) continue;
      const sharesAbandoned = abandonedNodeIds.size > 0 && t.nodes.some((n) => abandonedNodeIds.has(n.id));
      const insideChanged = changed.length > 0 && (
        t.nodes.some((n) => insideAny(n.position.x, n.position.z, changed)) ||
        (t.nodes.length > 0 &&
          insideAny(
            t.nodes.reduce((sum, n) => sum + n.position.x, 0) / t.nodes.length,
            t.nodes.reduce((sum, n) => sum + n.position.z, 0) / t.nodes.length,
            changed,
          ))
      );
      let insideRoad = false;
      if (cutterPolygons.length > 0 && t.nodes.length > 0) {
        const cx = t.nodes.reduce((sum, n) => sum + n.position.x, 0) / t.nodes.length;
        const cz = t.nodes.reduce((sum, n) => sum + n.position.z, 0) / t.nodes.length;
        for (const poly of cutterPolygons) {
          if (pointInOrOnPolygon(cx, cz, poly.outer) && !poly.holes.some((h) => pointInOrOnPolygon(cx, cz, h))) {
            insideRoad = true;
            break;
          }
        }
      }
      if (insideChanged || insideRoad || sharesAbandoned) {
        orphaned.push(t);
      }
    }
  }

  const byKey = new Map<string, ConstructionRegionTopology>();
  for (const t of [...underFootprint, ...orphaned]) byKey.set(t.surfaceKey.join(" "), t);
  const candidateTerrain = [...byKey.values()];
  if (candidateTerrain.length === 0) return;

  const outlineCoverageKeys = new Set<string>();
  if (request.footprintOutline && request.footprintOutline.length >= 3 && typeof runtime.getFootprintCoverage === "function") {
    try {
      for (const entry of runtime.getFootprintCoverage(request.footprintOutline)) {
        if (targetTypes.includes(entry.surfaceType)) {
          outlineCoverageKeys.add(entry.surfaceKey.join("/"));
          outlineCoverageKeys.add(entry.surfaceKey.join(":"));
        }
      }
    } catch {
      // best-effort coverage query
    }
  }

  // Pure domain planning via TerrainCloud:
  const repairPlan = planTerrainCloudCutRepair({
    candidateTerrain,
    cutterPositions: request.footprintOutline && request.footprintOutline.length >= 3
      ? request.footprintOutline.map(([x, z]) => ({ x, y: 0, z }))
      : allRoadPositions,
    cutterNodeIds: trulyDestroyedNodeIds,
    coverageSurfaceKeys: outlineCoverageKeys,
    footprintOutline: request.footprintOutline,
    cutterPolygons,
  });

  if (!repairPlan.requiresRepair && changed.length === 0) return;

  // Derive painted loops and nodes scoped to the affected road
  let paintedLoops: readonly (readonly ConstructionRegionEdge[])[] = [];
  let paintedNodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [];

  const allRoads = newRoadTopologies.length > 0
    ? newRoadTopologies
    : (request.patch.regions.length > 0 ? topologiesFromPatch(request.patch, runtime) : []);

  const roadToUse = allRoads;

  if (roadToUse.length > 0) {
    const painter = paintedFalloutOf(roadToUse);
    paintedLoops = painter.paintedLoops;
    paintedNodes = painter.paintedNodes;
  }

  const consumedByType = new Map(repairPlan.consumedByType);
  if (consumedByType.size === 0 && changed.length > 0) {
    consumedByType.set("terrain", []);
  }

  for (const [surfaceType, consumedSurfaceKeys] of consumedByType) {
    const executor = executors[surfaceType];
    if (executor === undefined) continue;
    try {
      executor(
        runtime,
        {
          paintedNodes,
          paintedLoops,
          consumedSurfaceKeys,
          // The shape the cut was actually asked about, and whose type the
          // repair has to read again for itself. Handing these over is what
          // lets the repair subtract the painter from the ground it lays
          // instead of laying ground over it and hoping a hole ring saves it.
          footprintOutline: request.footprintOutline,
          painterSurfaceType: paintedType,
          vacatedGround: changed,
        },
        causeId,
        runtime.getSnapshot().tableId,
      );
    } catch (error) {
      console.warn(`[type-interference] Failed to repair cut for ${surfaceType} (cause: ${causeId}):`, error);
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
    ? (removedTopologyOrExecutors as ConstructionRegionTopology)
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
      console.warn(`[type-interference] Failed to repair removal for ${surfaceType} (cause: ${causeId}):`, error);
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
