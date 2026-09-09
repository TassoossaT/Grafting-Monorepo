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
import {
  heightFieldOf,
  terrainStandingAround,
  type TerrainCutRuntime,
  type TerrainStrokeBounds,
} from "./terrain-neighborhood.ts";
import { paintedFalloutOf, paintedTopologiesOf } from "../interference/painted-topologies.ts";

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

/**
 * How many rings of neighbouring faces a regenerate may take in before it
 * gives up trying to find room, and the ceiling on what it may hold at once.
 *
 * Both are here to bound the cost, not to express a rule: the loop stops as
 * soon as the ground it is about to lay is wide enough to lay in, which on
 * ordinary ground is after one ring or none at all.
 */
const MOST_RINGS_WORTH_ABSORBING = 3;
const MOST_FACES_WORTH_ABSORBING = 512;

/**
 * How much of a face has to fit across the ground being laid before it counts
 * as layable, as a fraction of the face size.
 *
 * Calibrated against what {@link widthOf} actually reports rather than against
 * intuition: it answers the strip's true width but only half the side of a
 * square, so asking for a whole face here would demand a region two faces
 * across and grow into ground nothing was wrong with. Three quarters is the
 * point where the corridor a road leaves behind -- about half a face wide --
 * asks for one ring of neighbours and, having got it, stops.
 */
const NARROW_ENOUGH_TO_GROW = 0.75;

/**
 * One face's boundary as `polygon-clipping` wants it: closed, in walk order.
 *
 * Walk order, not node order. A topology's `nodes` array is a set with an
 * order, not a ring; reading a polygon out of it produces a bowtie for any
 * face whose nodes were not stored in the order its boundary happens to visit
 * them. The oriented edges *are* the walk.
 */
function loopToPolygon(
  loop: readonly ConstructionRegionEdge[],
  positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>,
): Polygon {
  const ring: [number, number][] = [];
  for (const edge of loop) {
    const position = positionOf.get(edge.startNodeId);
    if (position === undefined) return [];
    ring.push([position.x, position.z]);
  }
  if (ring.length < 3) return [];
  ring.push([ring[0]![0], ring[0]![1]]);
  return [ring];
}

/**
 * Roughly how wide a shape is, in the only sense that matters here: whether a
 * face of a given size fits inside it.
 *
 * `2 * area / perimeter` is the width of a long strip and half the side of a
 * square, so it under-reports a chunky shape and reports a seam honestly --
 * which is the direction to be wrong in when the question is "is this too
 * narrow to lay ground in".
 */
function widthOf(polygon: MultiPolygon): number {
  let area = 0;
  let perimeter = 0;
  for (const piece of polygon) {
    for (const ring of piece) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        const [ax, az] = ring[index]!;
        const [bx, bz] = ring[index + 1]!;
        area += ax * bz - bx * az;
        perimeter += Math.hypot(bx - ax, bz - az);
      }
    }
  }
  if (perimeter <= 1e-9) return 0;
  return (2 * Math.abs(area / 2)) / perimeter;
}

function topologyToPolygon(topology: ConstructionRegionTopology): Polygon {
  const positions = new Map<ConstructionNodeId, { x: number; z: number }>();
  for (const node of topology.nodes) positions.set(node.id, { x: node.position.x, z: node.position.z });

  // The face's own walk, when it has one. Falling back to node order is only
  // right for a face whose nodes happen to be stored in ring order, which a
  // quad from the generator is and a face the graph rebuilt need not be.
  const loop = topology.outerLoops[0];
  if (loop !== undefined && loop.length >= 3) {
    const walked = loopToPolygon(loop, positions);
    if (walked.length > 0) return walked;
  }

  const nodes = topology.nodes;
  if (nodes.length < 3) return [];
  const ring: [number, number][] = nodes.map((n) => [n.position.x, n.position.z]);
  ring.push([nodes[0]!.position.x, nodes[0]!.position.z]);
  return [ring];
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
  runtime: TerrainCutRuntime,
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

  // A regenerate has to be able to absorb a ring or two of neighbours (see the
  // growth loop below), so it reaches further out than a stroke needs to.
  const standingReach =
    request.profile.kind === "regenerate" ? effectiveFaceSide * 5 : effectiveFaceSide * 2;
  const standing = terrainStandingAround(runtime, covered, extent, standingReach);

  const isTerrainMatch = (st: string, target: string): boolean => {
    if (st === target) return true;
    if (st.startsWith("terrain") && target.startsWith("terrain")) return true;
    return false;
  };

  const coveredKeys = new Set(covered.map((c) => c.surfaceKey.join(" ")));

  const terrainStanding = standing.filter((topology) =>
    isTerrainMatch(topology.surfaceType, request.targetSurfaceType),
  );
  let affected = terrainStanding.filter(
    (topology) =>
      coveredKeys.has(topology.surfaceKey.join(" ")) ||
      faceIntersectsArea(topology, request.area, coveredOutline),
  );
  let affectedKeys = new Set(affected.map((t) => t.surfaceKey.join(" ")));
  let retained = standing.filter((t) => !affectedKeys.has(t.surfaceKey.join(" ")));

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

  // **The structure standing in this ground, when there is one -- a road.**
  //
  // Read before anything is decided about the shape, because what it occupies
  // is what makes the shape: the ground being laid is the affected faces
  // *minus* this, and how much ground has to be taken in for that remainder to
  // be layable depends on it.
  let connectArea: MultiPolygon = [];
  let connectLoops: readonly (readonly ConstructionRegionEdge[])[] = [];
  const connectPositions = new Map<ConstructionNodeId, { x: number; z: number }>();
  let connectSeeds: { readonly seed: readonly string[]; readonly surfaceType: string }[] = [];
  if (request.profile.kind === "regenerate" && request.profile.connectTo) {
    // Scoped to the work area. Unscoped, this reads every road on the table
    // and constrains a one-metre repair with the whole network's contour.
    const connectReach = Math.max(standingReach, DEFAULT_FACE_SIDE * 2);
    const connectTopologies = paintedTopologiesOf(
      runtime as unknown as Parameters<typeof paintedTopologiesOf>[0],
      request.profile.connectTo.surfaceType,
      {
        minX: extent.minX - connectReach,
        minZ: extent.minZ - connectReach,
        maxX: extent.maxX + connectReach,
        maxZ: extent.maxZ + connectReach,
      },
    );
    const { paintedNodes, paintedLoops } = paintedFalloutOf(connectTopologies);
    for (const n of paintedNodes) connectPositions.set(n.id, { x: n.position.x, z: n.position.z });

    // **The area it occupies is a union of its faces, never its perimeter
    // rings.** `outwardPerimeterRings` answers with every free-boundary ring
    // of the set undifferentiated -- the cloud's outer contour and any ring
    // around a gap *inside* it, with nothing saying which is which. Subtracting
    // each of those as a solid polygon carves the gaps out of the terrain too,
    // and a gap inside a road that also gets no ground is a hole in the road.
    // Unioning the faces themselves produces the same outline with its holes
    // correctly holes.
    const facePolygons = connectTopologies
      .flatMap((topology) => topology.outerLoops.map((loop) => loopToPolygon(loop, connectPositions)))
      .filter((polygon) => polygon.length > 0);
    if (facePolygons.length > 0) {
      try {
        connectArea = polygonClipping.union(facePolygons[0]!, ...facePolygons.slice(1));
      } catch {
        connectArea = [];
      }
    }

    // The loops stay, separately, for identity: they are what the subtraction's
    // bare-float output is matched back against, so the ground comes back
    // meeting the road at its actual nodes and edges rather than at coincident
    // positions. They are numbered later, once, alongside the retained rim --
    // the generator answers with a single index per corner and knows nothing
    // of which ring it came from.
    connectLoops = paintedLoops;
    connectSeeds = connectTopologies.map((topology) => ({
      seed: topology.surfaceKey,
      surfaceType: topology.surfaceType,
    }));
  }

  /** The affected faces as one polygon, with `connectArea` taken out of it. */
  const groundFor = (faces: readonly ConstructionRegionTopology[]): MultiPolygon => {
    const polygons = faces.map(topologyToPolygon).filter((p) => p.length > 0);
    if (polygons.length === 0) return [];
    let merged: MultiPolygon;
    try {
      merged = polygonClipping.union(polygons[0]!, ...polygons.slice(1));
    } catch {
      return [];
    }
    if (request.profile.kind === "convex") {
      try {
        merged = polygonClipping.union(merged, outlineMultiPolygon);
      } catch {
        // Keep the un-unioned shape rather than losing the stroke.
      }
    }
    if (connectArea.length === 0) return merged;
    try {
      return polygonClipping.difference(merged, connectArea);
    } catch {
      return merged;
    }
  };

  // **Growing until there is room to lay a face.**
  //
  // A road covers nearly the full width of the faces it runs over, so
  // subtracting it from exactly those faces leaves a ribbon a fraction of a
  // face wide and tens of faces long. The generator cannot lay a 2-unit cell in
  // a 1-unit strip, so it subdivides until it can -- which is how a repair that
  // refused nothing and clashed with nothing still came back with two hundred
  // faces at a fifth of the size asked for, in seven disconnected pieces.
  //
  // The remedy is the one the sculpt brush gets for free by covering whole
  // faces: take in enough ground that the remainder is a region rather than a
  // seam. Neighbours are absorbed by *shared node*, one ring at a time, and
  // only while the result is still too narrow to lay in -- so ordinary strokes
  // and cuts that barely clip a face never pay for it.
  let targetPolygon = groundFor(affected);
  if (connectArea.length > 0) {
    for (let ring = 0; ring < MOST_RINGS_WORTH_ABSORBING; ring += 1) {
      if (affected.length === 0) break;
      if (widthOf(targetPolygon) >= effectiveFaceSide * NARROW_ENOUGH_TO_GROW) break;
      if (affected.length >= MOST_FACES_WORTH_ABSORBING) break;

      const touched = new Set(affected.flatMap((t) => t.nodes.map((n) => n.id)));
      const absorbed = retained.filter(
        (t) => isTerrainMatch(t.surfaceType, request.targetSurfaceType) && t.nodes.some((n) => touched.has(n.id)),
      );
      if (absorbed.length === 0) break;

      affected = [...affected, ...absorbed];
      affectedKeys = new Set(affected.map((t) => t.surfaceKey.join(" ")));
      retained = standing.filter((t) => !affectedKeys.has(t.surfaceKey.join(" ")));
      targetPolygon = groundFor(affected);
    }
  }

  if (targetPolygon.length === 0) {
    if (request.profile.kind === "convex" && affected.length === 0) {
      targetPolygon = outlineMultiPolygon;
    } else {
      return { builtFaces: 0, removedFaces: 0, refusedFaces: 0, success: false, message: "Nada a cortar aqui." };
    }
  }

  // One numbering across the retained rim and the connected structure, because
  // the generator answers with one `source` index per corner.
  const retainedPerimeters = perimeterConstraints(retained, 0);
  const connectTable = constraintsFromRings(
    connectLoops,
    (nodeId) => connectPositions.get(nodeId),
    retainedPerimeters.sources.length,
  );
  const perimeters: ConstraintTable = {
    rings: [...retainedPerimeters.rings, ...connectTable.rings],
    sources: [...retainedPerimeters.sources, ...connectTable.sources],
  };
  const extraHoleRings: ConstraintRing[] = [];

  const targetRings = buildConstraintRings(targetPolygon, effectiveFaceSide, perimeters);
  const boundaryRings = targetRings.filter((r) => !r.isHole && r.points.length >= 3);
  const holeRings = [...targetRings.filter((r) => r.isHole && r.points.length >= 3), ...extraHoleRings];

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
    // The road belongs here as much as the retained terrain does. These seeds
    // are what `fillTerrain` reads back to learn which edges already have a
    // face on them and which way that face walks; a road left out of them is a
    // road whose contour edges look free, and every cell laid along the bank
    // is refused for walking one the wrong way.
    topologySeeds: [
      ...retained.map((topology) => ({ seed: topology.surfaceKey, surfaceType: topology.surfaceType })),
      ...connectSeeds,
    ],
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
