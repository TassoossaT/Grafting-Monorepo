// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type {
  ConstructionCoveredRegion,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  ConstructionTopologyBoundsQuery,
} from "@/ports";
import type { CutFallout, Effect, Reaction, ReactionOutcome } from "@/features/edit-construction";

import {
  planTerrainCloudCutRepair,
  pointInOrOnPolygon,
  terrainTopologiesBounds,
} from "../../../features/edit-construction/index.ts";
import { timePhase } from "../commit-timing.ts";
import { paintedFalloutOf } from "../interference/painted-topologies.ts";
import { repairTerrainCut, type TerrainRegenerateRuntime } from "./terrain-regenerate.ts";
import { planarUnion, planarDifference } from "../../../features/edit-construction/index.ts";
import type { PlanarArea, PlanarPolygon } from "@/features/edit-construction";

/**
 * The `"lattice-regenerate"` reaction: how a ground cloud answers a change
 * that reached it.
 *
 * Everything here is terrain's own judgement -- which of the reached faces a
 * change actually consumed, which ones it orphaned by abandoning their nodes,
 * and what the regeneration is handed. What reached it, and whether it is
 * allowed to answer, was already decided by the effect pipeline from declared
 * interactions; this never asks which type changed.
 */

/** What regenerating ground needs of the runtime, read and written inside the pipeline's transaction. */
export interface LatticeReactionRuntime extends TerrainRegenerateRuntime {
  getSnapshot(): { readonly tableId: string; readonly map: { readonly nodePositions: ReadonlyMap<string, { readonly position: ConstructionPosition }> } };
  getFootprintCoverage?(polygon: readonly (readonly [number, number])[]): readonly ConstructionCoveredRegion[];
}

/** Regenerates one ground type's consumed faces; returns how many it built. */
export type LatticeRepairExecutor = (
  runtime: TerrainRegenerateRuntime,
  fallout: CutFallout,
  causeId: string,
  tableId: string,
) => number;

const DONE: ReactionOutcome = Object.freeze({ kind: "done" });

function segmentsIntersect(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]): boolean {
  const cross = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const between = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) =>
    Math.min(p[0], q[0]) - 1e-7 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-7 &&
    Math.min(p[1], q[1]) - 1e-7 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-7;
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (abC === 0 && between(a, b, c)) || (abD === 0 && between(a, b, d)) ||
    (cdA === 0 && between(c, d, a)) || (cdB === 0 && between(c, d, b)) ||
    ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0));
}

function topologyIntersectsPolygon(topology: ConstructionRegionTopology, polygon: readonly (readonly [number, number])[]): boolean {
  if (polygon.length < 3 || topology.nodes.length === 0) return false;
  const positions = new Map(topology.nodes.map((node) => [node.id, [node.position.x, node.position.z] as [number, number]]));
  const rings = [...topology.outerLoops, ...topology.holes];
  for (const loop of rings) {
    for (let i = 0; i < loop.length; i += 1) {
      const from = positions.get(loop[i]!.startNodeId);
      const to = positions.get(loop[(i + 1) % loop.length]!.startNodeId);
      if (from === undefined || to === undefined) continue;
      for (let j = 0; j < polygon.length; j += 1) {
        const edgeFrom = polygon[j]!;
        const edgeTo = polygon[(j + 1) % polygon.length]!;
        if (segmentsIntersect(from, to, edgeFrom, edgeTo)) return true;
      }
    }
  }
  const center = topology.nodes.reduce((sum, node) => ({ x: sum.x + node.position.x, z: sum.z + node.position.z }), { x: 0, z: 0 });
  center.x /= topology.nodes.length;
  center.z /= topology.nodes.length;
  return pointInOrOnPolygon(center.x, center.z, polygon) || polygon.some(([x, z]) => {
    return topology.nodes.some((node) => Math.hypot(node.position.x - x, node.position.z - z) < 1e-7);
  });
}

/** Whether any of a face's nodes lies inside an XZ extent -- the engine's own in-bounds rule. */
function hasNodeIn(topology: ConstructionRegionTopology, bounds: ConstructionTopologyBoundsQuery): boolean {
  return topology.nodes.some((node) =>
    node.position.x >= bounds.minX && node.position.x <= bounds.maxX && node.position.z >= bounds.minZ && node.position.z <= bounds.maxZ);
}

/**
 * Ground the changed cloud used to stand on and no longer does, or the other
 * way round -- the places its shape actually changed.
 *
 * **Why this is a shape question and not an identity one.** A path mints every
 * contour node from the operation id (`contour-patch.ts`), so regenerating its
 * cloud re-mints *every* node in the whole connected component, however far
 * from the stroke. "Terrain holding a node the change replaced" is therefore
 * true of every metre of ground the road touches, on every stroke, and using it
 * to decide what to repair means regenerating the entire terrain corridor each
 * time. Identity cannot contain this while the changed cloud throws its own away.
 *
 * The shape can. Where the road came back over exactly the ground it left, the
 * terrain beside it still meets the same boundary in the same place and has
 * nothing to fix; where the road actually moved, it does. This decides *how
 * much* to regenerate and never which node is which, so it is not proximity
 * matching.
 *
 * Slivers are discarded. Re-flattening a curve lands its samples fractionally
 * off the last ones all along its length, so the difference of two runs of the
 * same road is a hairline following the whole network. `2*area/perimeter` is a
 * strip's width, and anything thinner than {@link REALLY_MOVED} is re-sampling
 * noise rather than a change that went somewhere.
 */
const REALLY_MOVED = 0.05;

function areaPolygonsOf(topologies: readonly ConstructionRegionTopology[]): PlanarPolygon[] {
  const polygons: PlanarPolygon[] = [];
  for (const topology of topologies) {
    const at = new Map<string, { x: number; z: number }>();
    for (const node of topology.nodes) at.set(node.id, { x: node.position.x, z: node.position.z });
    const ringOf = (loop: readonly ConstructionRegionEdge[]): [number, number][] | undefined => {
      const ring: [number, number][] = [];
      for (const use of loop) {
        const position = at.get(use.startNodeId);
        if (position === undefined) return undefined;
        ring.push([position.x, position.z]);
      }
      if (ring.length < 3) return undefined;
      ring.push([ring[0]![0], ring[0]![1]]);
      return ring;
    };
    for (const loop of topology.outerLoops) {
      const ring = ringOf(loop);
      if (ring === undefined) continue;
      const holes = topology.holes.map(ringOf).filter((hole): hole is [number, number][] => hole !== undefined);
      polygons.push([ring, ...holes]);
    }
  }
  return polygons;
}

function unionOf(polygons: readonly PlanarPolygon[]): PlanarArea {
  if (polygons.length === 0) return [];
  try {
    return planarUnion(polygons[0]!, ...polygons.slice(1));
  } catch {
    return [];
  }
}

function widthOfPiece(piece: PlanarArea[number]): number {
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

function groundMovedOff(
  before: readonly ConstructionRegionTopology[],
  after: readonly ConstructionRegionTopology[],
): PlanarArea {
  const was = unionOf(areaPolygonsOf(before));
  const is = unionOf(areaPolygonsOf(after));
  if (was.length === 0) return [];
  if (is.length === 0) return was;
  let moved: PlanarArea;
  try {
    moved = planarDifference(was, is);
  } catch {
    return was;
  }
  return moved.filter((piece) => widthOfPiece(piece) >= REALLY_MOVED);
}

/** Even-odd across every ring of a multipolygon, holes included. */
function insideAny(x: number, z: number, polygon: PlanarArea): boolean {
  for (const piece of polygon) {
    let crossings = 0;
    for (const ring of piece) {
      if (pointInOrOnPolygon(x, z, ring)) crossings += 1;
    }
    if (crossings % 2 === 1) return true;
  }
  return false;
}

/** Fast spatial bucketing for proximity queries against a set of points. */
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

function centroidInside(topology: ConstructionRegionTopology, cutters: readonly { outer: [number, number][]; holes: [number, number][][] }[]): boolean {
  if (topology.nodes.length === 0) return false;
  const cx = topology.nodes.reduce((sum, n) => sum + n.position.x, 0) / topology.nodes.length;
  const cz = topology.nodes.reduce((sum, n) => sum + n.position.z, 0) / topology.nodes.length;
  return cutters.some((poly) => pointInOrOnPolygon(cx, cz, poly.outer) && !poly.holes.some((h) => pointInOrOnPolygon(cx, cz, h)));
}

/** The changed cloud's faces as solid XZ polygons, read at their live node positions. */
function cutterPolygonsOf(runtime: LatticeReactionRuntime, faces: readonly ConstructionRegionTopology[]) {
  const liveNodes = runtime.getSnapshot().map.nodePositions;
  const ringOf = (face: ConstructionRegionTopology, loop: readonly ConstructionRegionEdge[]): [number, number][] => {
    const ring: [number, number][] = [];
    for (const edge of loop) {
      const p = liveNodes.get(edge.startNodeId)?.position ?? face.nodes.find((n) => n.id === edge.startNodeId)?.position;
      if (p) ring.push([p.x, p.z]);
    }
    if (ring.length >= 3) ring.push([ring[0]![0], ring[0]![1]]);
    return ring;
  };
  return faces.flatMap((face) => {
    if (face.outerLoops.length === 0) return [];
    const outer = ringOf(face, face.outerLoops[0]!);
    if (outer.length < 4) return [];
    const holes = face.holes.map((loop) => ringOf(face, loop)).filter((ring) => ring.length >= 4);
    return [{ outer, holes }];
  });
}

function answerCut(runtime: LatticeReactionRuntime, effect: Effect, hits: readonly ConstructionRegionTopology[], executor: LatticeRepairExecutor): void {
  const { change } = effect;
  const groundTypes = [...new Set(hits.map((hit) => hit.surfaceType))];
  const groundTypeSet = new Set(groundTypes);

  const changedPositions: ConstructionPosition[] = [
    ...change.after.flatMap((t) => t.nodes.map((n) => n.position)),
    ...change.before.flatMap((t) => t.nodes.map((n) => n.position)),
    ...change.declaredPositions,
    ...(change.footprintOutline ?? []).map(([x, z]) => ({ x, y: 0, z })),
  ];
  if (changedPositions.length === 0) return;

  const footprint = change.footprintOutline !== undefined && change.footprintOutline.length >= 3 ? change.footprintOutline : undefined;
  const extentOf = (points: readonly (readonly [number, number])[]) => {
    const margin = 2.5;
    return {
      minX: Math.min(...points.map(([x]) => x)) - margin,
      maxX: Math.max(...points.map(([x]) => x)) + margin,
      minZ: Math.min(...points.map(([, z]) => z)) - margin,
      maxZ: Math.max(...points.map(([, z]) => z)) + margin,
    };
  };
  const reachBounds = extentOf(footprint ?? changedPositions.map((p) => [p.x, p.z] as const));

  // The reach is deliberately broad, but it must not become the repair scope:
  // any node in the box pulled in large ground faces beside long or curved
  // roads and split their whole cloud. The footprint itself decides admission;
  // the planner still includes faces truly covered through its own checks.
  const underFootprint = hits.filter((t) => hasNodeIn(t, reachBounds) && (footprint === undefined || topologyIntersectsPolygon(t, footprint)));

  const cutters = cutterPolygonsOf(runtime, change.after);

  const afterNodeIds = new Set(change.after.flatMap((t) => t.nodes.map((n) => n.id)));
  const destroyedNodeIds = new Set<ConstructionNodeId>(change.removedNodeIds);
  for (const t of change.before) for (const n of t.nodes) if (!afterNodeIds.has(n.id)) destroyedNodeIds.add(n.id);

  // A destroyed node no new node stands near was genuinely moved or abandoned.
  // A node whose position did not move was merely re-minted, which is no
  // reason to regenerate ground.
  const afterSpatial = pointBucketIndex(change.after.flatMap((t) => t.nodes.map((n) => n.position)), REALLY_MOVED);
  const abandonedNodeIds = new Set<ConstructionNodeId>();
  for (const t of change.before) {
    for (const n of t.nodes) {
      if (destroyedNodeIds.has(n.id) && !afterSpatial.isNear(n.position.x, n.position.z)) abandonedNodeIds.add(n.id);
    }
  }

  // **Ground about to be orphaned, wherever it stands.** A change regenerating
  // its whole connected component re-mints every node in it, including the
  // corners ground split into its own edges to share them. Every one of those
  // stops existing, and the ground holding them is mostly nowhere near the
  // footprint -- so the search reaches the whole replaced extent, not the stroke.
  const orphaned: ConstructionRegionTopology[] = [];
  const changed = timePhase("área deixada pela mudança", () => groundMovedOff(change.before, change.after));
  if (change.before.length > 0) {
    const beforeBounds = terrainTopologiesBounds(change.before, 4.0);
    for (const t of hits) {
      if (!hasNodeIn(t, beforeBounds)) continue;
      const sharesAbandoned = abandonedNodeIds.size > 0 && t.nodes.some((n) => abandonedNodeIds.has(n.id));
      const insideChanged = changed.length > 0 && t.nodes.length > 0 && (
        t.nodes.some((n) => insideAny(n.position.x, n.position.z, changed)) ||
        insideAny(
          t.nodes.reduce((sum, n) => sum + n.position.x, 0) / t.nodes.length,
          t.nodes.reduce((sum, n) => sum + n.position.z, 0) / t.nodes.length,
          changed,
        )
      );
      if (insideChanged || centroidInside(t, cutters) || sharesAbandoned) orphaned.push(t);
    }
  }

  const byKey = new Map<string, ConstructionRegionTopology>();
  for (const t of [...underFootprint, ...orphaned]) byKey.set(t.surfaceKey.join(" "), t);
  const candidateTerrain = [...byKey.values()];
  if (candidateTerrain.length === 0) return;

  const coverageKeys = new Set<string>();
  if (footprint !== undefined && typeof runtime.getFootprintCoverage === "function") {
    for (const entry of runtime.getFootprintCoverage(footprint)) {
      if (!groundTypeSet.has(entry.surfaceType)) continue;
      coverageKeys.add(entry.surfaceKey.join("/"));
      coverageKeys.add(entry.surfaceKey.join(":"));
    }
  }

  const plan = timePhase("plano do reparo", () => planTerrainCloudCutRepair({
    candidateTerrain,
    cutterPositions: footprint !== undefined ? footprint.map(([x, z]) => ({ x, y: 0, z })) : changedPositions,
    cutterNodeIds: destroyedNodeIds,
    coverageSurfaceKeys: coverageKeys,
    footprintOutline: change.footprintOutline,
    cutterPolygons: cutters,
  }));
  if (!plan.requiresRepair && changed.length === 0) return;

  const painter = change.after.length > 0
    ? timePhase("perímetro da mudança", () => paintedFalloutOf(change.after))
    : { paintedNodes: [], paintedLoops: [] };

  const consumedByType = new Map(plan.consumedByType);
  if (consumedByType.size === 0 && changed.length > 0) consumedByType.set(groundTypes[0]!, []);

  const tableId = runtime.getSnapshot().tableId;
  for (const [surfaceType, consumedSurfaceKeys] of consumedByType) {
    timePhase(`regeneração de ${surfaceType}`, () => executor(
      runtime,
      {
        paintedNodes: painter.paintedNodes,
        paintedLoops: painter.paintedLoops,
        consumedSurfaceKeys,
        // The shape the change claimed, and whose type the repair reads again
        // for itself, so it subtracts the changed cloud from the ground it lays
        // instead of laying ground over it.
        footprintOutline: change.footprintOutline,
        painterSurfaceType: change.surfaceType,
        vacatedGround: changed,
      },
      effect.causeId,
      tableId,
    ));
  }
}

/**
 * Builds the reaction around an executor. The default regenerates for real;
 * tests hand in a recorder to see exactly what a regeneration would be given.
 */
export function latticeRegenerateReaction(executor: LatticeRepairExecutor = repairTerrainCut): Reaction<LatticeReactionRuntime> {
  return (runtime, effect, hits) => {
    if (effect.kind === "remove") {
      executor(
        runtime,
        { consumedSurfaceKeys: effect.change.before.map((topology) => topology.surfaceKey), paintedNodes: [], paintedLoops: [] },
        effect.causeId,
        runtime.getSnapshot().tableId,
      );
      return DONE;
    }
    answerCut(runtime, effect, hits, executor);
    return DONE;
  };
}
