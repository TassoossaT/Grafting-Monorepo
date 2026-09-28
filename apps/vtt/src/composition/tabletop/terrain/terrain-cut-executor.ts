import type {
  ConstructionCoveredRegion,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
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
  hasTrait,
  insideRingXZ,
  groundSurfaceOf,
} from "../../../features/edit-construction/index.ts";

import {
  perimeterConstraints,
  type ConstraintRing,
  type ConstraintTable,
} from "./terrain-constraints.ts";
import { buildConstraintRings } from "./constraint-rings.ts";
import { meetStructures, NO_STRUCTURES, type StructureMeeting } from "./structure-contact.ts";

export { buildConstraintRings } from "./constraint-rings.ts";
import { DEFAULT_FACE_SIDE, fillTerrain } from "./terrain-fill.ts";
import { timePhase } from "../commit-timing.ts";
import {
  heightFieldOf,
  terrainStandingAround,
  type TerrainCutRuntime,
  type TerrainStrokeBounds,
} from "./terrain-neighborhood.ts";
import { planarUnion, planarDifference } from "../../../features/edit-construction/index.ts";
import type { PlanarArea, PlanarPolygon } from "@/features/edit-construction";

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


function insideSwept(point: ConstructionPosition, swept: PlanarArea): boolean {
  const inRing = (ring: readonly (readonly [number, number])[]): boolean => insideRingXZ(ring, point);
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
  outline?: readonly (readonly [number, number])[],
): boolean {
  if (area.sweptPolygon && area.sweptPolygon.length > 0) {
    for (const node of topology.nodes) {
      if (insideSwept(node.position, area.sweptPolygon)) return true;
    }
    return insideSwept(centroidOf(topology.nodes), area.sweptPolygon);
  }
  if (outline && outline.length > 0) {
    for (const node of topology.nodes) {
      if (insideRingXZ(outline, node.position)) return true;
    }
    return insideRingXZ(outline, centroidOf(topology.nodes));
  }
  if (area.outline && area.outline.length > 0) {
    for (const node of topology.nodes) {
      if (insideRingXZ(area.outline, node.position)) return true;
    }
    return insideRingXZ(area.outline, centroidOf(topology.nodes));
  }
  return false;
}

/**
 * How many rings of neighbouring faces a regenerate may take in before it
 * gives up trying to find room, and the ceiling on what it may hold at once.
 *
 * Both are here to bound the cost, not to express a rule: the loop stops as
 * soon as the ground it is about to lay is wide enough to lay in, which on
 * ordinary ground is after one ring or none at all.
 */
const MOST_RINGS_WORTH_ABSORBING = 1;
const MOST_FACES_WORTH_ABSORBING = 48;

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
 * One face's boundary as a plan-view ring: closed, in walk order.
 *
 * Walk order, not node order. A topology's `nodes` array is a set with an
 * order, not a ring; reading a polygon out of it produces a bowtie for any
 * face whose nodes were not stored in the order its boundary happens to visit
 * them. The oriented edges *are* the walk.
 */
function loopToRing(
  loop: readonly ConstructionRegionEdge[],
  positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>,
): [number, number][] | undefined {
  const ring: [number, number][] = [];
  for (const edge of loop) {
    const position = positionOf.get(edge.startNodeId);
    if (position === undefined) return undefined;
    ring.push([position.x, position.z]);
  }
  if (ring.length < 3) return undefined;
  ring.push([ring[0]![0], ring[0]![1]]);
  return ring;
}

function loopToPolygon(
  loop: readonly ConstructionRegionEdge[],
  positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>,
): PlanarPolygon {
  const ring = loopToRing(loop, positionOf);
  return ring ? [ring] : [];
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
function widthOf(polygon: PlanarArea): number {
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



function topologyToPolygon(topology: ConstructionRegionTopology): PlanarPolygon {
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

  const outlineMultiPolygon: PlanarArea =
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
  const footprintCovered: readonly ConstructionCoveredRegion[] =
    coveredOutline.length >= 3 &&
    typeof (runtime as unknown as { getFootprintCoverage?: (outline: readonly (readonly [number, number])[]) => readonly ConstructionCoveredRegion[] }).getFootprintCoverage === "function"
      ? (runtime as unknown as { getFootprintCoverage: (outline: readonly (readonly [number, number])[]) => readonly ConstructionCoveredRegion[] }).getFootprintCoverage(coveredOutline)
      : [];
  const requestedCovered: readonly ConstructionCoveredRegion[] =
    (request.coveredRegions as readonly ConstructionCoveredRegion[] | undefined) ?? [];
  const coveredMap = new Map<string, ConstructionCoveredRegion>();
  for (const c of [...requestedCovered, ...footprintCovered]) {
    coveredMap.set(c.surfaceKey.join(" "), c);
  }
  const covered = [...coveredMap.values()];

  // **The neighbourhood has to contain the ground being replaced.**
  //
  // The area names where the work is, and for a stroke that is the same place
  // as the ground it covers. For a repair it need not be: a path regenerates
  // its whole connected component, so the ground orphaned by one stroke can
  // stand a long way from that stroke's own footprint. A seeded topology query
  // drops any seed that does not reach the bounds it was given, so an extent
  // taken from the area alone would silently discard exactly the faces this
  // call exists to replace.
  const coveredExtent = { ...extent };
  for (const region of covered) {
    const topology =
      typeof runtime.getRegionTopology === "function"
        ? runtime.getRegionTopology(region.surfaceKey as ConstructionSurfaceKey)
        : undefined;
    for (const node of topology?.nodes ?? []) {
      coveredExtent.minX = Math.min(coveredExtent.minX, node.position.x);
      coveredExtent.minZ = Math.min(coveredExtent.minZ, node.position.z);
      coveredExtent.maxX = Math.max(coveredExtent.maxX, node.position.x);
      coveredExtent.maxZ = Math.max(coveredExtent.maxZ, node.position.z);
    }
  }
  if (request.vacatedArea) {
    for (const piece of request.vacatedArea) {
      for (const ring of piece) {
        for (const [x, z] of ring) {
          coveredExtent.minX = Math.min(coveredExtent.minX, x);
          coveredExtent.minZ = Math.min(coveredExtent.minZ, z);
          coveredExtent.maxX = Math.max(coveredExtent.maxX, x);
          coveredExtent.maxZ = Math.max(coveredExtent.maxZ, z);
        }
      }
    }
  }

  // A regenerate has to be able to absorb a ring or two of neighbours (see the
  // growth loop below), so it reaches further out than a stroke needs to.
  const standingReach =
    request.profile.kind === "regenerate" ? effectiveFaceSide * 5 : effectiveFaceSide * 2;
  const standing = timePhase("vizinhança do terreno", () => terrainStandingAround(runtime, covered, coveredExtent, standingReach));

  const targetSurfaceType = hasTrait(request.targetSurfaceType, "ground")
    ? request.targetSurfaceType
    : "terrain";

  const coveredKeys = new Set(covered.map((c) => c.surfaceKey.join(" ")));

  // The target is ground by construction above, so every ground face matches it.
  const terrainStanding = standing.filter((topology) => hasTrait(topology.surfaceType, "ground"));
  let affected = terrainStanding.filter(
    (topology) =>
      coveredKeys.has(topology.surfaceKey.join(" ")) ||
      faceIntersectsArea(topology, request.area, coveredOutline),
  );
  let affectedKeys = new Set(affected.map((t) => t.surfaceKey.join(" ")));
  let retained = terrainStanding.filter((t) => !affectedKeys.has(t.surfaceKey.join(" ")));

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

  // **The structures standing in this ground** -- every one that cuts it
  // (`structure-contact.ts`). Read before anything is decided about the
  // shape, because what they occupy is what makes the shape: the ground being
  // laid is the affected faces *minus* where they rest, and how much ground
  // has to be taken in for that remainder to be layable depends on it.
  let structures: StructureMeeting = NO_STRUCTURES;
  if (request.profile.kind === "regenerate" && request.profile.connectTo) {
    // Scoped to the work area. Unscoped, this reads every road on the table
    // and constrains a one-metre repair with the whole network's contour.
    const reach = Math.max(standingReach, DEFAULT_FACE_SIDE * 2);
    let minX = extent.minX, maxX = extent.maxX, minZ = extent.minZ, maxZ = extent.maxZ;
    const include = (x: number, z: number) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    };
    for (const face of affected) for (const node of face.nodes) include(node.position.x, node.position.z);
    for (const piece of request.vacatedArea ?? []) for (const ring of piece) for (const [x, z] of ring) include(x, z);
    structures = meetStructures(runtime, { minX: minX - reach, minZ: minZ - reach, maxX: maxX + reach, maxZ: maxZ + reach }, targetSurfaceType, terrainStanding);
  }
  const connectArea = structures.area;

  /** The affected faces as one polygon, with `connectArea` taken out of it. */
  const groundFor = (faces: readonly ConstructionRegionTopology[]): PlanarArea => {
    // A face an edit dragged out of place -- rimmed by a node the structure
    // carried away -- never counts by its shape: that runs from where it lay to
    // where the node went, over ground nobody touched, and laying ground there
    // leaves a trail behind the structure. Where it lay comes in as vacated.
    const stale = new Set((request.staleRegions ?? []).map((key) => key.join(" ")));
    const polygons = faces.filter((face) => !stale.has(face.surfaceKey.join(" "))).map(topologyToPolygon).filter((p) => p.length > 0);
    const allPolygons =
      request.vacatedArea && request.vacatedArea.length > 0
        ? [...polygons, ...request.vacatedArea]
        : polygons;
    if (allPolygons.length === 0) return [];
    let merged: PlanarArea;
    try {
      merged = planarUnion(runtime, allPolygons[0]!, ...allPolygons.slice(1));
    } catch {
      return [];
    }
    if (request.profile.kind === "convex") {
      try {
        merged = planarUnion(runtime, merged, outlineMultiPolygon);
      } catch {
        // Keep the un-unioned shape rather than losing the stroke.
      }
    }
    if (connectArea.length === 0) return merged;
    try {
      return planarDifference(runtime, merged, connectArea);
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
  let targetPolygon = timePhase(`chão a regerar (${affected.length} faces)`, () => groundFor(affected));
  if (connectArea.length > 0) {
    for (let ring = 0; ring < MOST_RINGS_WORTH_ABSORBING; ring += 1) {
      if (affected.length === 0) break;
      if (widthOf(targetPolygon) >= effectiveFaceSide * NARROW_ENOUGH_TO_GROW) break;

      // Only a shared side adds width to the repair. A corner contact must
      // not pull an otherwise untouched terrain face into regeneration.
      const touched = affected.flatMap((t) => [...t.outerLoops, ...t.holes].flat());
      const absorbed = timePhase("vizinhas por aresta", () => retained.filter(
        (t) => hasTrait(t.surfaceType, "ground") &&
          [...t.outerLoops, ...t.holes].some((loop) => loop.some((edge) => touched.some((other) =>
            (edge.startNodeId === other.startNodeId && edge.endNodeId === other.endNodeId) ||
            (edge.startNodeId === other.endNodeId && edge.endNodeId === other.startNodeId)))),
      ));
      if (absorbed.length === 0) break;

      affected = [...affected, ...absorbed];
      affectedKeys = new Set(affected.map((t) => t.surfaceKey.join(" ")));
      retained = terrainStanding.filter((t) => !affectedKeys.has(t.surfaceKey.join(" ")));
      targetPolygon = timePhase(`chão a regerar com vizinhas (${affected.length} faces)`, () => groundFor(affected));
    }
  }

  // Do not discard pieces: discarding pieces deletes terrain without regenerating it,
  // creating holes and causing the terrain to recede from roads.

  if (targetPolygon.length === 0) {
    if (request.profile.kind === "convex" && affected.length === 0) {
      targetPolygon = outlineMultiPolygon;
    } else {
      return { builtFaces: 0, removedFaces: 0, refusedFaces: 0, success: false, message: "Nada a cortar aqui." };
    }
  }

  // One numbering across the retained rim and the connected structure, because
  // the generator answers with one `source` index per corner.
  const retainedPerimeters = timePhase(`perímetro do terreno retido (${retained.length} faces)`, () => perimeterConstraints(retained, 0));
  const connectTable = structures.constraints(retainedPerimeters.sources.length);
  const perimeters: ConstraintTable = {
    rings: [...retainedPerimeters.rings, ...connectTable.rings],
    sources: [...retainedPerimeters.sources, ...connectTable.sources],
  };
  const extraHoleRings: ConstraintRing[] = [];

  const targetRings = timePhase("anéis de restrição", () => buildConstraintRings(targetPolygon, effectiveFaceSide, perimeters, structures.liesOnSide));
  const boundaryRings = targetRings.filter((r) => !r.isHole && r.points.length >= 3);
  const holeRings = [...targetRings.filter((r) => r.isHole && r.points.length >= 3), ...extraHoleRings];

  if (boundaryRings.length === 0) {
    return { builtFaces: 0, removedFaces: 0, refusedFaces: 0, success: false, message: "Nenhum contorno válido gerado." };
  }

  const affectedNodes = affected.flatMap((t) => t.nodes);
  const strokePathNodes = request.area.path?.map((p) => ({ position: { x: p.x, y: p.y ?? 0, z: p.z } })) ?? [];
  const outlineNodes = request.area.outline?.map(([x, z]) => ({ position: { x, y: 0, z } })) ?? [];
  const fallbackNodes = strokePathNodes.length > 0 ? strokePathNodes : outlineNodes;
  const center3D =
    request.area.center ??
    centroidOf(affectedNodes.length > 0 ? affectedNodes : fallbackNodes);
  const center = { x: center3D.x, z: center3D.z };
  const extentRadius = Math.max((coveredExtent.maxX - coveredExtent.minX) / 2, (coveredExtent.maxZ - coveredExtent.minZ) / 2, effectiveFaceSide);
  const radius = request.area.radius ?? extentRadius;

  // **The ground's own heights, never a structure's.** New ground lies where
  // the ground lay; it meets a structure only at the nodes it shares with it
  // -- its corners on the structure's sides -- instead of being drawn up
  // toward it all round, into a bank that is left standing in the air when
  // the structure moves on.
  const standingNodes = terrainStanding.flatMap((topology) => topology.nodes).filter((node) => !structures.holds(node.id)).map((node) => node.position);
  const localReach = effectiveFaceSide * 2.0;
  const wideReach = Math.max(effectiveFaceSide * 3, radius);
  const localKept = heightFieldOf(standingNodes, localReach);
  const wideKept = heightFieldOf(standingNodes, wideReach);
  // Over a face of the ground, the height that face is drawn at -- never a
  // blend of nodes metres away, which on coarse ground over a hill sinks the
  // new ground below the old, and its seam with a structure through its side.
  // A face an edit dragged out of shape is no drawing of the ground at all.
  const staleShapes = new Set((request.staleRegions ?? []).map((key) => key.join(" ")));
  const structureNodes = new Set(terrainStanding.flatMap((topology) => topology.nodes).filter((node) => structures.holds(node.id)).map((node) => node.id));
  const drawnGround = groundSurfaceOf(terrainStanding.filter((topology) => !staleShapes.has(topology.surfaceKey.join(" "))), structureNodes);

  const strokePath = request.area.path;
  const centerOrPath = strokePath && strokePath.length > 0 ? strokePath : center;

  const sampleBase = (point: { readonly x: number; readonly z: number }): number => {
    const meeting = structures.heightAt(point);
    if (meeting !== undefined) return meeting;
    let base = drawnGround(point) ?? localKept.at(point);
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

  const filled = timePhase("preenchimento", () => fillTerrain(runtime, {
    what: request.profile.kind === "concave" ? "escavação" : request.profile.kind === "convex" ? "adição" : "regeneração",
    // The faces this fill means to replace, so the log can hold that against
    // the faces actually cleared. Left unset, the two never disagreed on paper
    // however far apart they ran -- the divergence the pair exists to catch
    // read `0 vs N` on every single commit, so nobody could see it.
    //
    // It counts `affected`, not the covered regions the caller named: what is
    // asked to be replaced is exactly `replaceSurfaceKeys` below, and
    // `affected` is wider than `covered` by design -- faces the area crosses,
    // and edge neighbours absorbed to give the repair room. Comparing the
    // narrower number would report a divergence on every widened repair.
    regenerated: affected.length,
    mint: `${request.tableId}:cut-${request.causeId}`,
    tableId: request.tableId,
    causeId: request.causeId,
    seed: request.seed ?? 1,
    faceSide: effectiveFaceSide,
    relaxStrength: request.irregularity ?? 0.7,
    surfaceType:
      affected.length > 0 && hasTrait(affected[0]!.surfaceType, "ground")
        ? affected[0]!.surfaceType
        : (retained.length > 0 && hasTrait(retained[0]!.surfaceType, "ground") ? retained[0]!.surfaceType : targetSurfaceType),
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
      ...structures.seeds,
    ],
    avoidArea: connectArea,
    heightAt,
    positionAt,
  }));


  return {
    builtFaces: filled.built,
    removedFaces: affected.length,
    refusedFaces: filled.refused,
    success: filled.built > 0,
    message: `${filled.built} faces geradas (${affected.length} substituídas).`,
  };
}
