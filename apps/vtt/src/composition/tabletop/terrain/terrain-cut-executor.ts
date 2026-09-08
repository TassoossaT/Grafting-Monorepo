import type {
  ConstructionCoveredRegion,
  ConstructionGridConstraintPoint,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
} from "@/ports";
import type {
  StructuralCutRequest,
  StructuralCutOutcome,
  StructuralCutArea,
} from "@/features/edit-construction";
import {
  calculateProfileDisplacement,
  calculateProfileHeight,
  distanceAndElevationOnPath,
} from "../../../features/edit-construction/index.ts";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";

import {
  constraintsFromRings,
  perimeterConstraints,
  type ConstraintRing,
  type ConstraintTable,
} from "./terrain-constraints.ts";
import { DEFAULT_FACE_SIDE, fillTerrain } from "./terrain-fill.ts";
import { terrainStandingAround, type TerrainStrokeBounds } from "./terrain-neighborhood.ts";
import { heightFieldOf, type TerrainRegenerateRuntime } from "./terrain-regenerate.ts";
import { paintedNodesOf } from "../interference/type-interference-dispatch.ts";

function centroidOf(nodes: readonly { readonly position: ConstructionPosition }[]): { x: number; y: number; z: number } {
  if (nodes.length === 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const n of nodes) {
    x += n.position.x;
    y += n.position.y;
    z += n.position.z;
  }
  return { x: x / nodes.length, y: y / nodes.length, z: z / nodes.length };
}

function insidePolygon(point: ConstructionPosition, polygon: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i++) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if (zi > point.z !== zj > point.z && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function insideSwept(point: ConstructionPosition, swept: MultiPolygon): boolean {
  const inRing = (ring: readonly (readonly [number, number])[]): boolean => {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const [ax, az] = ring[index]!;
      const [bx, bz] = ring[previous]!;
      if (az > point.z !== bz > point.z && point.x < ((bx - ax) * (point.z - az)) / (bz - az) + ax) {
        inside = !inside;
      }
    }
    return inside;
  };
  for (const polygon of swept) {
    const outer = polygon[0];
    if (outer === undefined || !inRing(outer)) continue;
    if (polygon.slice(1).some((hole) => inRing(hole))) continue;
    return true;
  }
  return false;
}

function faceIntersectsArea(
  topology: ConstructionRegionTopology,
  area: StructuralCutArea,
  outline: readonly (readonly [number, number])[],
): boolean {
  if (area.sweptPolygon && area.sweptPolygon.length > 0) {
    for (const node of topology.nodes) {
      if (insideSwept(node.position, area.sweptPolygon)) return true;
    }
    return insideSwept(centroidOf(topology.nodes), area.sweptPolygon);
  }
  for (const node of topology.nodes) {
    if (insidePolygon(node.position, outline)) return true;
  }
  return insidePolygon(centroidOf(topology.nodes), outline);
}

function topologyToPolygon(topology: ConstructionRegionTopology): Polygon {
  const nodes = topology.nodes;
  if (nodes.length < 3) return [];
  const ring: [number, number][] = nodes.map((n) => [n.position.x, n.position.z]);
  ring.push([nodes[0]!.position.x, nodes[0]!.position.z]);
  return [ring];
}

/**
 * A connecting structure's own loops (e.g. a road), as polygons to subtract.
 *
 * This is the piece that was missing: {@link buildConstraintRings} can only
 * reattach a node id to a boundary point that already sits at that node's
 * exact position. For terrain retained around the cut that is true by
 * construction -- its perimeter never left the union. A road's perimeter
 * never entered it at all; it was handed over afterward as a hole appended to
 * the result, geometrically unrelated to the boundary `targetPolygon` had
 * just settled on. Two independently-produced boundaries sharing a border
 * only by convention is exactly the seam the commits on this cut kept
 * patching one symptom of at a time. Subtracting the road here, before any
 * ring is built, makes the boundary and the hole one polygon-clipping
 * operation's output -- so the corner where they meet is the same point
 * twice, not two points that are merely supposed to agree.
 */
function loopsToPolygons(
  loops: readonly (readonly ConstructionRegionEdge[])[],
  positionOf: (nodeId: ConstructionNodeId) => { readonly x: number; readonly z: number } | undefined,
): Polygon[] {
  const polygons: Polygon[] = [];
  for (const loop of loops) {
    const ring: [number, number][] = [];
    let complete = true;
    for (const edge of loop) {
      const position = positionOf(edge.startNodeId);
      if (position === undefined) {
        complete = false;
        break;
      }
      ring.push([position.x, position.z]);
    }
    if (!complete || ring.length < 3) continue;
    ring.push([ring[0]![0], ring[0]![1]]);
    polygons.push([ring]);
  }
  return polygons;
}

export function buildConstraintRings(
  targetPolygon: MultiPolygon,
  faceSize: number,
  perimeters: ConstraintTable,
): readonly (ConstraintRing & { readonly isHole: boolean })[] {
  const rings: (ConstraintRing & { readonly isHole: boolean })[] = [];
  const snapDist = Math.max(0.25, faceSize * 0.18);
  const minStep = Math.max(0.08, faceSize * 0.08);

  for (const polygon of targetPolygon) {
    for (let rIdx = 0; rIdx < polygon.length; rIdx++) {
      const isHole = rIdx > 0;
      const rawRing = polygon[rIdx]!;
      const pts = rawRing.slice(0, -1);
      const welded: [number, number][] = [];
      for (const [x, z] of pts) {
        const prev = welded[welded.length - 1];
        if (!prev || Math.hypot(x - prev[0], z - prev[1]) >= minStep) {
          welded.push([x, z]);
        }
      }
      if (welded.length < 3) continue;

      const points: ConstructionGridConstraintPoint[] = [];
      for (let i = 0; i < welded.length; i++) {
        const [x, z] = welded[i]!;
        let bestSnap: { x: number; z: number; source: number } | undefined;
        let bestDist = snapDist;
        for (const r of perimeters.rings) {
          for (const pt of r.points) {
            if (pt.source !== undefined) {
              const d = Math.hypot(x - pt.x, z - pt.z);
              if (d < bestDist) {
                bestDist = d;
                bestSnap = { x: pt.x, z: pt.z, source: pt.source };
              }
            }
          }
        }
        if (bestSnap) {
          points.push({ x: bestSnap.x, z: bestSnap.z, source: bestSnap.source });
        } else {
          points.push({ x, z });
        }
      }

      const edges: (ConstructionRegionEdge | undefined)[] = [];
      for (let i = 0; i < points.length; i++) {
        const cur = points[i]!;
        const next = points[(i + 1) % points.length]!;
        let matchedEdge: ConstructionRegionEdge | undefined;
        if (cur.source !== undefined && next.source !== undefined) {
          for (const r of perimeters.rings) {
            for (let j = 0; j < r.points.length; j++) {
              const p1 = r.points[j]!;
              const p2 = r.points[(j + 1) % r.points.length]!;
              if (
                (p1.source === cur.source && p2.source === next.source) ||
                (p1.source === next.source && p2.source === cur.source)
              ) {
                matchedEdge = r.edges[j];
                break;
              }
            }
            if (matchedEdge) break;
          }
        }
        edges.push(matchedEdge);
      }
      rings.push({ points, edges, isHole });
    }
  }
  return rings;
}

function boundsOfArea(area: StructuralCutArea): TerrainStrokeBounds {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  const update = (x: number, z: number) => {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  };

  if (area.sweptPolygon) {
    for (const poly of area.sweptPolygon) {
      for (const ring of poly) {
        for (const [x, z] of ring) update(x, z);
      }
    }
  }
  if (area.outline) {
    for (const [x, z] of area.outline) update(x, z);
  }
  if (area.path) {
    const r = area.radius ?? 0;
    for (const p of area.path) {
      update(p.x - r, p.z - r);
      update(p.x + r, p.z + r);
    }
  }
  if (area.center) {
    const r = area.radius ?? 0;
    update(area.center.x - r, area.center.z - r);
    update(area.center.x + r, area.center.z + r);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minZ = 0;
    maxX = 0;
    maxZ = 0;
  }
  return { minX, minZ, maxX, maxZ };
}

/**
 * Executes a generic structural cut / excavation / addition / hole operation on terrain.
 *
 * Follows the unified operational cycle:
 * 1. Find affected faces inside `request.area.outline` or `request.area.sweptPolygon`.
 * 2. If `profile.kind === "hole"`, directly removes the faces and leaves the boundary intact.
 * 3. For `concave`, `convex`, or `regenerate`, rebuilds the mesh within the boundary:
 *    - `concave`: calculates depression profile (excavating crater/cavity) along center point or path
 *    - `convex`: calculates elevation profile (depositing earth mound or mountain ridge) along center point or path
 *    - `regenerate`: fills seamlessly connecting to surrounding terrain and optional `connectTo` structure
 */
export function executeTerrainCut(
  runtime: TerrainRegenerateRuntime,
  request: StructuralCutRequest,
): StructuralCutOutcome {
  const rawOutline = request.area.outline ?? request.area.sweptPolygon?.[0]?.[0] ?? [];
  const outline = rawOutline.length >= 3 ? rawOutline : [];

  const closedOutlineRing: [number, number][] = outline.map(([x, z]) => [x, z]);
  if (
    closedOutlineRing.length > 0 &&
    (closedOutlineRing[0]![0] !== closedOutlineRing[closedOutlineRing.length - 1]![0] ||
      closedOutlineRing[0]![1] !== closedOutlineRing[closedOutlineRing.length - 1]![1])
  ) {
    closedOutlineRing.push([closedOutlineRing[0]![0], closedOutlineRing[0]![1]]);
  }

  const outlineMultiPolygon: MultiPolygon =
    request.area.sweptPolygon && request.area.sweptPolygon.length > 0
      ? request.area.sweptPolygon
      : closedOutlineRing.length >= 4
        ? [[closedOutlineRing]]
        : [];

  if (outlineMultiPolygon.length === 0 && outline.length < 3) {
    return { builtFaces: 0, removedFaces: 0, refusedFaces: 0, success: false, message: "Área de corte inválida." };
  }

  const effectiveFaceSide = request.faceSide ?? DEFAULT_FACE_SIDE;
  const extent = boundsOfArea(request.area);

  // Ask runtime what surfaces are covered by outline / footprint
  const coveredOutline = outline.length >= 3 ? outline : outlineMultiPolygon[0]?.[0] ?? [];
  const covered: readonly ConstructionCoveredRegion[] =
    (request.coveredRegions as readonly ConstructionCoveredRegion[] | undefined) ??
    (coveredOutline.length >= 3 &&
    typeof (runtime as unknown as { getFootprintCoverage?: (outline: readonly (readonly [number, number])[]) => readonly ConstructionCoveredRegion[] }).getFootprintCoverage === "function"
      ? (runtime as unknown as { getFootprintCoverage: (outline: readonly (readonly [number, number])[]) => readonly ConstructionCoveredRegion[] }).getFootprintCoverage(coveredOutline)
      : []);

  const standing = terrainStandingAround(runtime, covered, extent, effectiveFaceSide * 2);

  const isTerrainMatch = (st: string, target: string): boolean => {
    if (st === target) return true;
    if (st.startsWith("terrain") && target.startsWith("terrain")) return true;
    return false;
  };

  const coveredKeys = new Set(covered.map((c) => c.surfaceKey.join(" ")));

  const affected = standing.filter(
    (topology) =>
      isTerrainMatch(topology.surfaceType, request.targetSurfaceType) &&
      (coveredKeys.has(topology.surfaceKey.join(" ")) || faceIntersectsArea(topology, request.area, coveredOutline)),
  );
  const affectedKeys = new Set(affected.map((t) => t.surfaceKey.join(" ")));
  const retained = standing.filter((t) => !affectedKeys.has(t.surfaceKey.join(" ")));

  // If hole profile: simply delete affected faces
  if (request.profile.kind === "hole") {
    if (affected.length === 0) {
      return { builtFaces: 0, removedFaces: 0, refusedFaces: 0, success: false, message: "Nada a furar aqui." };
    }
    let removed = 0;
    for (const f of affected) {
      try {
        runtime.applyRegionEdit([{ kind: "delete-region", surfaceKey: f.surfaceKey }], "local", request.causeId);
        removed++;
      } catch {}
    }
    return {
      builtFaces: 0,
      removedFaces: removed,
      refusedFaces: 0,
      success: removed > 0,
      message: `${removed} faces removidas (furo).`,
    };
  }

  const affectedPolygons: Polygon[] = affected
    .map(topologyToPolygon)
    .filter((p) => p.length > 0);
  const affectedMerged: MultiPolygon =
    affectedPolygons.length > 0
      ? polygonClipping.union(affectedPolygons[0]!, ...affectedPolygons.slice(1))
      : [];

  let targetPolygon: MultiPolygon;

  if (affectedMerged.length === 0) {
    if (request.profile.kind === "convex") {
      targetPolygon = outlineMultiPolygon;
    } else {
      return { builtFaces: 0, removedFaces: 0, refusedFaces: 0, success: false, message: "Nada a cortar aqui." };
    }
  } else {
    if (request.profile.kind === "convex") {
      try {
        targetPolygon = polygonClipping.union(affectedMerged, outlineMultiPolygon);
      } catch {
        targetPolygon = affectedMerged;
      }
    } else {
      targetPolygon = affectedMerged;
    }
  }

  let perimeters = perimeterConstraints(retained, 0);

  // If regenerating to connect to another structure (e.g. road), its loops are
  // subtracted from targetPolygon itself -- not appended afterward as an
  // unrelated hole -- so the boundary polygon-clipping settles on already
  // excludes the road's footprint. See loopsToPolygons.
  if (request.profile.kind === "regenerate" && request.profile.connectTo) {
    const { paintedNodes, paintedLoops } = paintedNodesOf(
      runtime as unknown as Parameters<typeof paintedNodesOf>[0],
      request.profile.connectTo.surfaceType,
    );
    if (paintedLoops.length > 0) {
      const nodePosMap = new Map<ConstructionNodeId, { x: number; z: number }>();
      for (const n of paintedNodes) nodePosMap.set(n.id, { x: n.position.x, z: n.position.z });
      const connectHoles = constraintsFromRings(
        paintedLoops,
        (nodeId) => nodePosMap.get(nodeId),
        perimeters.sources.length,
      );
      perimeters = {
        rings: [...perimeters.rings, ...connectHoles.rings],
        sources: [...perimeters.sources, ...connectHoles.sources],
      };

      const roadPolygons = loopsToPolygons(paintedLoops, (nodeId) => nodePosMap.get(nodeId));
      if (roadPolygons.length > 0) {
        try {
          targetPolygon = polygonClipping.difference(targetPolygon, roadPolygons[0]!, ...roadPolygons.slice(1));
        } catch {
          // Malformed road loop (self-touching, degenerate): fall back to the
          // pre-subtraction boundary rather than losing the fill outright.
        }
      }
    }
  }

  const targetRings = buildConstraintRings(targetPolygon, effectiveFaceSide, perimeters);
  const boundaryRings = targetRings.filter((r) => !r.isHole && r.points.length >= 3);
  const holeRings = targetRings.filter((r) => r.isHole && r.points.length >= 3);

  if (boundaryRings.length === 0) {
    return { builtFaces: 0, removedFaces: 0, refusedFaces: 0, success: false, message: "Nenhum contorno válido gerado." };
  }

  const affectedNodes = affected.flatMap((t) => t.nodes);
  const center3D =
    request.area.center ??
    centroidOf(affectedNodes.length > 0 ? affectedNodes : coveredOutline.map(([x, z]) => ({ position: { x, y: 0, z } })));
  const center = { x: center3D.x, z: center3D.z };
  const extentRadius = Math.max((extent.maxX - extent.minX) / 2, (extent.maxZ - extent.minZ) / 2, effectiveFaceSide);
  const radius = request.area.radius ?? extentRadius;

  const standingNodes = standing.flatMap((topology) => topology.nodes.map((node) => node.position));
  const localReach = effectiveFaceSide * 2.0;
  const wideReach = Math.max(effectiveFaceSide * 3, radius);
  const localKept = heightFieldOf(standingNodes, localReach);
  const wideKept = heightFieldOf(standingNodes, wideReach);

  const strokePath = request.area.path;
  const centerOrPath = strokePath && strokePath.length > 0 ? strokePath : center;

  const sampleBase = (point: { readonly x: number; readonly z: number }): number => {
    let base = localKept.at(point);
    if (base === undefined) {
      base = wideKept.at(point);
    }
    if (base === undefined) {
      if (strokePath && strokePath.length > 0) {
        const { pathY } = distanceAndElevationOnPath(point.x, point.z, strokePath);
        base = pathY;
      }
      if (base === undefined) {
        base = center3D.y;
      }
      if (request.noiseAt) {
        base += request.noiseAt(point);
      }
    }
    return base;
  };

  // Determine ONE unified normal direction from the brush stroke center:
  // Uses a wide baseline (1.5x face side) to ignore micro-noise and capture the overall slope.
  const eps = Math.max(1.0, effectiveFaceSide * 1.5);
  const hXPlus = sampleBase({ x: center.x + eps, z: center.z });
  const hXMinus = sampleBase({ x: center.x - eps, z: center.z });
  const hZPlus = sampleBase({ x: center.x, z: center.z + eps });
  const hZMinus = sampleBase({ x: center.x, z: center.z - eps });

  const gx = (hXPlus - hXMinus) / (2 * eps);
  const gz = (hZPlus - hZMinus) / (2 * eps);
  const gradLen = Math.hypot(-gx, 1, -gz);
  const brushNormal: { readonly x: number; readonly y: number; readonly z: number } =
    gradLen > 1e-6 ? { x: -gx / gradLen, y: 1 / gradLen, z: -gz / gradLen } : { x: 0, y: 1, z: 0 };

  const heightAt = (point: { readonly x: number; readonly z: number }): number => {
    const base = sampleBase(point);
    return calculateProfileHeight(point, base, request.profile, centerOrPath, radius);
  };

  const positionAt = (point: { readonly x: number; readonly z: number }): ConstructionPosition => {
    const base = sampleBase(point);
    const disp = calculateProfileDisplacement(point, request.profile, centerOrPath, radius, brushNormal);
    return {
      x: point.x + disp.dx,
      y: base + disp.dy,
      z: point.z + disp.dz,
    };
  };

  const filled = fillTerrain(runtime, {
    what: request.profile.kind === "concave" ? "escavação" : request.profile.kind === "convex" ? "adição" : "regeneração",
    mint: `${request.tableId}:cut-${request.causeId}`,
    tableId: request.tableId,
    causeId: request.causeId,
    seed: request.seed ?? 1,
    faceSide: effectiveFaceSide,
    relaxStrength: request.irregularity ?? 0.7,
    surfaceType:
      affected.length > 0
        ? affected[0]!.surfaceType
        : (retained.length > 0 ? retained[0]!.surfaceType : request.targetSurfaceType),
    boundary: boundaryRings,
    holes: holeRings,
    sources: perimeters.sources,
    replaceSurfaceKeys: affected.length > 0 ? affected.map((f) => f.surfaceKey) : undefined,
    topologySeeds: retained.map((topology) => ({ seed: topology.surfaceKey, surfaceType: topology.surfaceType })),
    heightAt,
    positionAt,
  });

  return {
    builtFaces: filled.built,
    removedFaces: affected.length,
    refusedFaces: filled.refused,
    success: filled.built > 0,
    message: `${filled.built} faces geradas (${affected.length} substituídas).`,
  };
}
