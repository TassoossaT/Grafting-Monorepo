import type {
  ConstructionEdgeId,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
} from "@/ports";

import { createBoundaryEdges, reverseGeometry } from "../core/boundary-edges.ts";
import type { ToolContext } from "../core/tool-context.ts";

export interface SteppedTerrainOutcome {
  readonly floorFaces: number;
  readonly sidewallFaces: number;
  readonly skipped: readonly string[];
}

/**
 * Performs stepped volumetric excavation (deltaY < 0) or plateau creation (deltaY > 0).
 *
 * Rather than moving existing vertices and stretching quads into steep slopes,
 * this replaces affected faces with:
 * 1. A stepped floor/plateau translated vertically by `deltaY`.
 * 2. Vertical sidewall faces (barrancos de terra/rocha) along every perimeter edge
 *    that borders retained ground, seamlessly connecting the top rim and bottom rim.
 *
 * Edges that open to the outside world (empty air) remain open without walls,
 * allowing natural entrances when carving into hillsides or terrain boundaries.
 */
export function stepTerrain(
  ctx: ToolContext,
  targetSurface: string,
  affected: readonly ConstructionRegionTopology[],
  retained: readonly ConstructionRegionTopology[],
  deltaY: number,
  causeId: string,
): SteppedTerrainOutcome {
  if (affected.length === 0 || Math.abs(deltaY) < 1e-4) {
    return { floorFaces: 0, sidewallFaces: 0, skipped: [] };
  }

  const snapshot = ctx.runtime.getSnapshot().map;
  const nodePositions = snapshot.nodePositions;

  // Identify nodes belonging to retained terrain
  const retainedNodeIds = new Set<ConstructionNodeId>();
  for (const topology of retained) {
    for (const node of topology.nodes) {
      retainedNodeIds.add(node.id);
    }
  }

  // Collect all unique nodes used by affected faces
  const affectedNodeIds = new Set<ConstructionNodeId>();
  for (const topology of affected) {
    for (const node of topology.nodes) {
      affectedNodeIds.add(node.id);
    }
  }

  const salt = ctx.nextSequence();
  const mint = `${ctx.tableId}:step-${salt}`;

  // Map each affected node to a newly minted node translated by deltaY
  const mappedNodeIds = new Map<ConstructionNodeId, ConstructionNodeId>();
  const newNodes: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [];

  for (const nodeId of affectedNodeIds) {
    const entry = nodePositions.get(nodeId);
    if (!entry) continue;
    const newId = `${mint}:${nodeId}`;
    mappedNodeIds.set(nodeId, newId);
    newNodes.push({
      id: newId,
      position: {
        x: entry.position.x,
        y: entry.position.y + deltaY,
        z: entry.position.z,
      },
    });
  }

  const edges = createBoundaryEdges(ctx.tableId, { kind: "refuse-when-full" });
  const regions: ConstructionPatchRegion[] = [];
  let regionIndex = 0;

  // 1. Build translated floor/plateau regions
  for (const topology of affected) {
    const outerLoop = topology.outerLoops[0];
    if (!outerLoop || outerLoop.length < 3) continue;

    const boundary: ConstructionOrientedEdgeUse[] = [];
    let valid = true;

    for (const edge of outerLoop) {
      const from = mappedNodeIds.get(edge.startNodeId);
      const to = mappedNodeIds.get(edge.endNodeId);
      if (!from || !to) {
        valid = false;
        break;
      }
      boundary.push(edges.use(from, to, edge.geometry));
    }

    if (!valid || boundary.length < 3) continue;

    // Translate any hole loops
    const holes: ConstructionOrientedEdgeUse[][] = [];
    for (const holeLoop of topology.holes) {
      const holeBoundary: ConstructionOrientedEdgeUse[] = [];
      let holeValid = true;
      for (const edge of holeLoop) {
        const from = mappedNodeIds.get(edge.startNodeId);
        const to = mappedNodeIds.get(edge.endNodeId);
        if (!from || !to) {
          holeValid = false;
          break;
        }
        holeBoundary.push(edges.use(from, to, edge.geometry));
      }
      if (holeValid && holeBoundary.length >= 3) {
        holes.push(holeBoundary);
      }
    }

    regions.push({
      regionId: `${mint}:floor:${regionIndex++}`,
      boundary,
      holes: holes.length > 0 ? holes : undefined,
      surfaceType: targetSurface,
      physical: true,
    });
  }

  // 2. Identify perimeter edges bordering retained ground and generate vertical sidewalls
  const retainedEdgeUses = new Map<ConstructionEdgeId, ConstructionRegionEdge>();
  for (const topology of retained) {
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const edge of loop) {
        retainedEdgeUses.set(edge.edgeId, edge);
      }
    }
  }

  const processedBoundaryEdges = new Set<ConstructionEdgeId>();
  let sidewallCount = 0;

  for (const topology of affected) {
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const edge of loop) {
        if (processedBoundaryEdges.has(edge.edgeId)) continue;
        processedBoundaryEdges.add(edge.edgeId);

        const retainedEdge = retainedEdgeUses.get(edge.edgeId);
        if (retainedEdge === undefined) {
          // Open to empty air or interior between affected faces
          continue;
        }

        // In retained ground, the edge walked from retainedEdge.startNodeId to retainedEdge.endNodeId.
        // The free direction for the sidewall is the opposite direction!
        const rimStart = retainedEdge.endNodeId;
        const rimEnd = retainedEdge.startNodeId;

        const floorStart = mappedNodeIds.get(rimStart);
        const floorEnd = mappedNodeIds.get(rimEnd);

        if (!floorStart || !floorEnd) continue;

        if (deltaY < 0) {
          // Excavation: rim is at Y_top, floor is at Y_bottom
          // Sidewall quad cycle: rimStart -> rimEnd -> floorEnd -> floorStart
          const sidewallBoundary: ConstructionOrientedEdgeUse[] = [
            edges.use(rimStart, rimEnd, reverseGeometry(retainedEdge.geometry)),
            edges.use(rimEnd, floorEnd),
            edges.use(floorEnd, floorStart, retainedEdge.geometry),
            edges.use(floorStart, rimStart),
          ];
          regions.push({
            regionId: `${mint}:wall:${sidewallCount++}`,
            boundary: sidewallBoundary,
            surfaceType: targetSurface,
            physical: true,
          });
        } else {
          // Plateau: rim is at Y_base, plateau is at Y_top
          // Sidewall quad cycle: rimEnd -> rimStart -> floorStart -> floorEnd
          const sidewallBoundary: ConstructionOrientedEdgeUse[] = [
            edges.use(rimEnd, rimStart, retainedEdge.geometry),
            edges.use(rimStart, floorStart),
            edges.use(floorStart, floorEnd, reverseGeometry(retainedEdge.geometry)),
            edges.use(floorEnd, rimEnd),
          ];
          regions.push({
            regionId: `${mint}:wall:${sidewallCount++}`,
            boundary: sidewallBoundary,
            surfaceType: targetSurface,
            physical: true,
          });
        }
      }
    }
  }

  const patchEdges = edges.all();
  const patch: ConstructionPatch = {
    nodes: newNodes,
    edges: patchEdges,
    regions,
  };

  const outcome = ctx.runtime.applyPatchReplacement(
    {
      operationId: `${causeId}:stepped-terrain`,
      sourceSurfaceKeys: affected.map((t) => t.surfaceKey),
      patch,
    },
    "local",
    causeId,
  );

  return {
    floorFaces: regionIndex,
    sidewallFaces: sidewallCount,
    skipped: outcome.skippedRegionReasons,
  };
}
