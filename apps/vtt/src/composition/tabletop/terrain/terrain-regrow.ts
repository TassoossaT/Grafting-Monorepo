import type {
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  ConstructionSurfaceOrigin,
  ConstructionTerrainRegenerateRequest,
  ConstructionTerrainRegeneration,
} from "@/ports";
import type { CutFallout, PlanarArea } from "@/features/edit-construction";

// Relative, not `@/...`: the test runner resolves no aliases.
import {
  GROUND_CONTACT_CLEARANCE,
  GROUND_SIDE_REST_ROOM,
  groundSurfaceOf,
  hasTrait,
  isGroundType,
  nearestOnSegment,
} from "../../../features/edit-construction/index.ts";
import { buildConstraintRings } from "./constraint-rings.ts";
import { commitGround, indexedFaces, type GroundCommitRuntime } from "./ground-commit.ts";
import { heightRangeOf, medianFaceSide, surfaceComponents, walkSurface } from "./ground-surface.ts";
import { meetStructures } from "./structure-contact.ts";
import type { TerrainCutRuntime } from "./terrain-neighborhood.ts";
import { DEFAULT_FACE_SIDE } from "./terrain-fill.ts";
import { timePhase } from "../commit-timing.ts";

/**
 * Growing the ground back round a structure that changed, on the ground's own
 * surface (note 0012) -- the hillside, a cave's floor, an earth bridge's deck
 * alike.
 *
 * 1. **The layer.** Only ground within the structure's height band is laid
 *    again: from where the structure rests less the contact reach, to a face
 *    over its top. The ground is walked from the faces the change consumed
 *    over the edges they share, inside the stroke round where the structure
 *    stood and stands -- never by lying over the same plan point, so a cave's
 *    ceiling over a platform is never touched.
 * 2. **The contact.** Where each structure rests on that layer, by the ground
 *    contact law, read from that layer alone (`meetStructures`): those areas
 *    are the holes the ground goes round, their corners the structures' nodes.
 * 3. **The surface.** Each connected piece is laid again on its own surface by
 *    the engine (`regenerateTerrainSurface`), and committed in its place.
 */

/** What growing the ground back needs of the runtime. */
export interface TerrainRegrowRuntime extends TerrainCutRuntime, GroundCommitRuntime {
  regenerateTerrainSurface(request: ConstructionTerrainRegenerateRequest): ConstructionTerrainRegeneration | undefined;
}

/**
 * How far past a structure's own outline the ground is laid again: wide
 * enough that the rim falls on ground no earlier repair of the same structure
 * touched, so moving it back and forth does not grow the face count.
 */
export const STROKE_MARGIN = 2 * DEFAULT_FACE_SIDE;

/** How far over a structure's top, in faces, the layer it stands on may rise. */
const BAND_OVER_FACES = 1.5;

type PlanPoint = readonly [number, number];

function boxOf(points: readonly PlanPoint[], margin: number) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }
  return Number.isFinite(minX) ? { minX: minX - margin, minZ: minZ - margin, maxX: maxX + margin, maxZ: maxZ + margin } : undefined;
}

function centreOf(face: ConstructionRegionTopology): ConstructionPosition {
  const n = Math.max(1, face.nodes.length);
  return face.nodes.reduce((s, node) => ({ x: s.x + node.position.x / n, y: s.y + node.position.y / n, z: s.z + node.position.z / n }), { x: 0, y: 0, z: 0 });
}

/** A stable small integer for a set of keys -- a seed, not a checksum. */
function hashOf(keys: readonly (readonly string[])[]): number {
  let hash = 2166136261;
  for (const key of keys) for (const part of key) for (let i = 0; i < part.length; i += 1) {
    hash ^= part.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.max(1, Math.abs(hash | 0));
}

/**
 * The `"lattice-regenerate"` reaction's executor: the ground grown back round
 * the structure that cut it, on the ground's own surface. Returns the faces built.
 */
export function regrowGround(runtime: TerrainRegrowRuntime, fallout: CutFallout, causeId: string, tableId: string): number {
  const named = fallout.consumedSurfaceKeys
    .map((key) => runtime.getRegionTopology(key))
    .filter((face): face is ConstructionRegionTopology => face !== undefined);
  const consumed = named.filter((face) => isGroundType(face.surfaceType));
  const removedStructure = named.filter((face) => !isGroundType(face.surfaceType));
  const vacated: PlanarArea = fallout.vacatedGround ?? [];
  if (consumed.length === 0 && vacated.length === 0 && removedStructure.length === 0) return 0;

  // **The structure's band**: its nodes where they are and where an edit carried them from.
  const structurePoints: ConstructionPosition[] = [
    ...fallout.paintedNodes.map((node) => node.position),
    ...removedStructure.flatMap((face) => face.nodes.map((node) => node.position)),
    ...(fallout.carriedFrom ? [...fallout.carriedFrom.values()] : []),
  ];
  const consumedHeights = consumed.map(heightRangeOf);
  const lowest = structurePoints.length > 0 ? Math.min(...structurePoints.map((p) => p.y)) : Math.min(...consumedHeights.map((h) => h.low));
  const highest = structurePoints.length > 0 ? Math.max(...structurePoints.map((p) => p.y)) : Math.max(...consumedHeights.map((h) => h.high));
  if (!Number.isFinite(lowest) || !Number.isFinite(highest)) return 0;

  // **The stroke**: round where it stood and where it stands, in plan.
  const footprint = fallout.footprintOutline !== undefined && fallout.footprintOutline.length >= 3 ? fallout.footprintOutline : undefined;
  const planPoints: PlanPoint[] = [
    ...(footprint ?? []),
    ...vacated.flatMap((piece) => piece[0] ?? []),
    ...(footprint === undefined ? consumed.flatMap((face) => face.nodes.map((node) => [node.position.x, node.position.z] as const)) : []),
    ...removedStructure.flatMap((face) => face.nodes.map((node) => [node.position.x, node.position.z] as const)),
  ];
  const stroke = boxOf(planPoints, footprint !== undefined || vacated.length > 0 ? STROKE_MARGIN : 0);
  if (stroke === undefined) return 0;
  const nearby = timePhase("terreno em volta", () => runtime.getRegionTopologiesInBounds({
    minX: stroke.minX - STROKE_MARGIN, minZ: stroke.minZ - STROKE_MARGIN, maxX: stroke.maxX + STROKE_MARGIN, maxZ: stroke.maxZ + STROKE_MARGIN,
  }));
  const stale = new Set((fallout.draggedSurfaceKeys ?? []).map((key) => key.join("\u0000")));
  const ground = nearby.filter((face) => isGroundType(face.surfaceType) && face.outerLoops.length === 1 && face.holes.length === 0);
  const faceSide = medianFaceSide(consumed.length > 0 ? consumed : ground);
  const band = { low: lowest - GROUND_CONTACT_CLEARANCE - GROUND_SIDE_REST_ROOM - faceSide, high: highest + BAND_OVER_FACES * faceSide };
  const inBand = (face: ConstructionRegionTopology) => {
    const { low, high } = heightRangeOf(face);
    return high >= band.low && low <= band.high;
  };
  const inStroke = (face: ConstructionRegionTopology) => {
    const c = centreOf(face);
    return c.x >= stroke.minX && c.x <= stroke.maxX && c.z >= stroke.minZ && c.z <= stroke.maxZ;
  };

  // **The layer**: walked from what the change consumed, over shared edges.
  const painted = new Set(fallout.paintedNodes.map((node) => node.id));
  const seeds = [
    ...consumed.filter(inBand),
    ...ground.filter((face) => inBand(face) && face.nodes.some((node) => painted.has(node.id))),
  ];
  const patch = walkSurface(ground, seeds, (face) => stale.has(face.surfaceKey.join("\u0000")) || (inBand(face) && (inStroke(face) || seeds.includes(face))));
  if (patch.length === 0) return 0;
  const patchKeys = new Set(patch.map((face) => face.surfaceKey.join("\u0000")));
  const around = nearby.filter((face) => !patchKeys.has(face.surfaceKey.join("\u0000")));
  // The ground the structures rest on, read from this layer alone.
  const layer = ground.filter((face) => inBand(face) && !stale.has(face.surfaceKey.join("\u0000")));
  const groundType = hasTrait(consumed[0]?.surfaceType ?? "", "ground") ? consumed[0]!.surfaceType : patch[0]!.surfaceType;

  let built = 0;
  surfaceComponents(patch).forEach((piece, pieceIndex) => {
    built += regrowPiece(runtime, {
      piece, around, layer, groundType, faceSide, carriedFrom: fallout.carriedFrom,
      operationId: `${causeId}:regrow-${pieceIndex}`, tableId,
      seed: hashOf(fallout.consumedSurfaceKeys),
    });
  });
  return built;
}

interface PieceRequest {
  readonly piece: readonly ConstructionRegionTopology[];
  readonly around: readonly ConstructionRegionTopology[];
  readonly layer: readonly ConstructionRegionTopology[];
  readonly groundType: string;
  readonly faceSide: number;
  readonly carriedFrom: ReadonlyMap<ConstructionNodeId, ConstructionPosition> | undefined;
  readonly operationId: string;
  readonly tableId: string;
  readonly seed: number;
}

/** One connected piece of the layer laid again round the structures standing in it. */
function regrowPiece(runtime: TerrainRegrowRuntime, request: PieceRequest): number {
  const { piece, faceSide } = request;
  const points = piece.flatMap((face) => face.nodes.map((node) => [node.position.x, node.position.z] as const));
  const box = boxOf(points, faceSide)!;

  // Where the structures rest on this layer: the holes the ground goes round.
  const meeting = meetStructures(runtime, box, request.groundType, request.layer);
  const table = meeting.constraints([]);
  const rings = meeting.area.length > 0 ? buildConstraintRings(meeting.area, faceSide, table, meeting.liesOnSide) : [];
  const groundAt = groundSurfaceOf(request.layer, new Set(table.sources));
  const live = runtime.getSnapshot().map.nodePositions;

  // One table of given points: the node each is, or where it lies and on which side.
  const given: { readonly node?: ConstructionNodeId; readonly position: ConstructionPosition; readonly side?: ConstructionRegionEdge }[] = [];
  const segmentSide = new Map<string, ConstructionRegionEdge>();
  const holes = rings.filter((ring) => !ring.isHole && ring.points.length >= 3).map((ring) => {
    const ids = ring.points.map((point, index) => {
      const node = point.source !== undefined ? table.sources[point.source] : undefined;
      const at = node !== undefined ? live.get(node)?.position : undefined;
      const position = at ?? { x: point.x, y: meeting.heightAt(point) ?? groundAt(point) ?? 0, z: point.z };
      // A corner of the ring partway along a structure's side splits that side.
      const side = node === undefined
        ? [ring.edges[index], ring.edges[(index - 1 + ring.points.length) % ring.points.length]].find((edge) => {
          const a = edge && live.get(edge.startNodeId)?.position, b = edge && live.get(edge.endNodeId)?.position;
          return a !== undefined && b !== undefined && nearestOnSegment(point, a, b).distance < 1e-3;
        })
        : undefined;
      given.push({ node, position, side });
      return given.length - 1;
    });
    ids.forEach((id, index) => {
      const edge = ring.edges[index];
      if (edge !== undefined) segmentSide.set(`${id}:${ids[(index + 1) % ids.length]}`, edge);
    });
    return ids.map((id) => ({ position: [given[id]!.position.x, given[id]!.position.y, given[id]!.position.z] as const, id }));
  });

  // The piece as it lay: a node an edit carried away is read where it was.
  const indexed = indexedFaces(piece);
  const vertices = indexed.vertices.map((v, i) => {
    const was = request.carriedFrom?.get(indexed.ids[i]!);
    return was ? ([was.x, was.y, was.z] as const) : v;
  });
  const laid = timePhase(`terreno na superfície (${piece.length} faces)`, () => runtime.regenerateTerrainSurface({
    patch: { vertices, faces: indexed.faces },
    holes,
    faceSide,
    seed: request.seed,
  }));
  if (!laid) throw new Error("o núcleo recusou refazer o terreno na superfície");

  const nodeOfOrigin = (origin: ConstructionSurfaceOrigin): ConstructionNodeId | undefined =>
    origin.kind === "patch" ? indexed.ids[origin.index] : given[origin.index]?.node;
  const landed: { vertex: number; from: ConstructionNodeId; to: ConstructionNodeId }[] = [];
  laid.landed.forEach((landing) => {
    const side = landing.from.kind === "given" && landing.to.kind === "given" ? segmentSide.get(`${landing.from.index}:${landing.to.index}`) : undefined;
    const from = side?.startNodeId ?? nodeOfOrigin(landing.from), to = side?.endNodeId ?? nodeOfOrigin(landing.to);
    if (from !== undefined && to !== undefined) landed.push({ vertex: landing.vertex, from, to });
  });
  laid.origin.forEach((origin, vertex) => {
    const side = origin?.kind === "given" ? given[origin.index]?.side : undefined;
    if (side !== undefined) landed.push({ vertex, from: side.startNodeId, to: side.endNodeId });
  });

  return commitGround(runtime, {
    operationId: request.operationId,
    tableId: request.tableId,
    replaced: piece,
    around: request.around,
    surfaceType: piece[0]!.surfaceType,
    faceSide,
    laid: {
      vertices: laid.vertices,
      faces: laid.faces,
      nodeOf: (vertex) => {
        const origin = laid.origin[vertex];
        return origin ? nodeOfOrigin(origin) : undefined;
      },
      landed,
    },
  }).built;
}
