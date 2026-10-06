import type {
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
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
import { commitGround, indexedFaces, type GroundCommitRuntime } from "./ground-commit.ts";
import { DEFAULT_FACE_SIDE, closedPatch, heightRangeOf, regrowFaceSide, surfaceComponents, walkSurface } from "./ground-surface.ts";
import { meetStructures, type StructureContactRuntime } from "./structure-contact.ts";
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
export interface TerrainRegrowRuntime extends StructureContactRuntime, GroundCommitRuntime {
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
  regenerateTerrainSurface(request: ConstructionTerrainRegenerateRequest): ConstructionTerrainRegeneration | undefined;
}

/**
 * How far past a structure's own outline the ground is laid again: wide
 * enough that the rim falls on ground no earlier repair of the same structure
 * touched, so moving it back and forth does not grow the face count.
 */
export const STROKE_MARGIN = 2 * DEFAULT_FACE_SIDE;

/** How much of a face's normal has to point up for a structure to rest on it. */
const RESTABLE_UP = 0.2;

/** How much of a ground face's outward normal points up: 1 level, 0 upright, below 0 a ceiling. */
function upwardShare(face: ConstructionRegionTopology): number {
  const at = new Map(face.nodes.map((node) => [node.id, node.position]));
  const ring = (face.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((p): p is ConstructionPosition => p !== undefined);
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  // The tabletop winds ground with its right-hand normal pointing down.
  return -ny / (Math.hypot(nx, ny, nz) || 1);
}

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
  // One stroke round each place: where it stood and where it stands are two
  // when it moved far, and the ground it passed over between is left alone.
  const strokes = [
    ...(footprint ? [boxOf(footprint, STROKE_MARGIN)] : []),
    ...vacated.map((piece) => boxOf(piece[0] ?? [], STROKE_MARGIN)),
    ...(footprint === undefined && vacated.length === 0 ? [stroke] : []),
    ...(removedStructure.length > 0 ? [boxOf(removedStructure.flatMap((face) => face.nodes.map((node) => [node.position.x, node.position.z] as const)), STROKE_MARGIN)] : []),
  ].filter((box): box is NonNullable<typeof box> => box !== undefined);
  const nearby = timePhase("terreno em volta", () => runtime.getRegionTopologiesInBounds({
    minX: stroke.minX - STROKE_MARGIN, minZ: stroke.minZ - STROKE_MARGIN, maxX: stroke.maxX + STROKE_MARGIN, maxZ: stroke.maxZ + STROKE_MARGIN,
  }));
  const stale = new Set((fallout.draggedSurfaceKeys ?? []).map((key) => key.join("\u0000")));
  const ground = nearby.filter((face) => isGroundType(face.surfaceType) && face.outerLoops.length === 1 && face.holes.length === 0);
  const faceSide = regrowFaceSide(consumed.length > 0 ? consumed : ground);
  // Down to where the contact law reaches under it, no further: ground deeper
  // than that passes under the structure untouched.
  const band = { low: lowest - GROUND_CONTACT_CLEARANCE - GROUND_SIDE_REST_ROOM, high: highest + BAND_OVER_FACES * faceSide };
  const inBand = (face: ConstructionRegionTopology) => {
    const { low, high } = heightRangeOf(face);
    return high >= band.low && low <= band.high;
  };
  // Structures rest on ground facing up. A tunnel's wall and its ceiling over
  // a floor are none of the floor's business, however near in height.
  const restable = (face: ConstructionRegionTopology) => upwardShare(face) >= RESTABLE_UP;
  const inStroke = (face: ConstructionRegionTopology) => {
    const c = centreOf(face);
    return strokes.some((box) => c.x >= box.minX && c.x <= box.maxX && c.z >= box.minZ && c.z <= box.maxZ);
  };

  // **The layer**: walked from what the change consumed, over shared edges.
  const painted = new Set(fallout.paintedNodes.map((node) => node.id));
  // **The rim of what was vacated**, at whatever height it runs: the faces
  // with a side nobody else holds inside where a structure stood. A floor
  // half sunk in a hill leaves a rim climbing the hill, over its band; a
  // cave's ceiling over that floor holds no such side, so it never comes in.
  const uses = new Map<string, number>();
  for (const face of nearby) for (const use of [...face.outerLoops, ...face.holes].flat()) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
  const vacatedBox = boxOf(vacated.flatMap((piece) => piece[0] ?? []), faceSide);
  const insideVacated = (p: ConstructionPosition) => vacatedBox !== undefined && p.x >= vacatedBox.minX && p.x <= vacatedBox.maxX && p.z >= vacatedBox.minZ && p.z <= vacatedBox.maxZ;
  const rimOfVacated = new Set(ground.filter((face) => face.outerLoops.flat().some((use) => {
    if (uses.get(use.edgeId) !== 1) return false;
    const at = new Map(face.nodes.map((node) => [node.id, node.position]));
    const a = at.get(use.startNodeId), b = at.get(use.endNodeId);
    return a !== undefined && b !== undefined && insideVacated(a) && insideVacated(b);
  })).map((face) => face.surfaceKey.join("\u0000")));
  const onRimOfVacated = (face: ConstructionRegionTopology) => rimOfVacated.has(face.surfaceKey.join("\u0000"));
  const seeds = [
    ...consumed.filter((face) => inBand(face) && restable(face)),
    ...ground.filter((face) => inBand(face) && restable(face) && face.nodes.some((node) => painted.has(node.id))),
    ...ground.filter(onRimOfVacated),
  ];
  const walked = walkSurface(ground, seeds, (face) => stale.has(face.surfaceKey.join("\u0000")) || onRimOfVacated(face) || (inBand(face) && restable(face) && (inStroke(face) || seeds.includes(face))));
  // A disk the engine can lay: no corner pinched, no island of ground left inside.
  // A face an edit dragged out of shape is laid again but never read as the
  // surface: it runs from where it lay to where the structure went. So it is
  // ringed by faces that are, and its ground comes back over the hole it leaves.
  const staleNodes = new Set(walked.filter((face) => stale.has(face.surfaceKey.join("\u0000"))).flatMap((face) => face.nodes.map((node) => node.id)));
  const ringed = [...walked, ...ground.filter((face) => inBand(face) && restable(face) && face.nodes.some((node) => staleNodes.has(node.id)))];
  const closable = ground.filter((face) => (inBand(face) && restable(face)) || onRimOfVacated(face) || stale.has(face.surfaceKey.join("\u0000")));
  const closed = closedPatch(ringed, closable);
  // Every structure resting on it rests wholly inside it: its contact a hole
  // the patch rings round, never a side running on past the patch's rim.
  const patch = closedPatch([...closed, ...groundRoundContact(runtime, closed, closable, faceSide, groundTypeOf(consumed, closed))], closable);
  if (patch.length === 0) return 0;
  const patchKeys = new Set(patch.map((face) => face.surfaceKey.join("\u0000")));
  const around = nearby.filter((face) => !patchKeys.has(face.surfaceKey.join("\u0000")));
  // The ground the structures rest on, read from this layer alone.
  const layer = ground.filter((face) => inBand(face) && !stale.has(face.surfaceKey.join("\u0000")));
  const groundType = groundTypeOf(consumed, patch);

  let built = 0;
  surfaceComponents(patch).forEach((piece, pieceIndex) => {
    built += regrowPiece(runtime, {
      piece, around, layer, groundType, faceSide, stale,
      operationId: `${causeId}:regrow-${pieceIndex}`, tableId,
      seed: hashOf(fallout.consumedSurfaceKeys),
    });
  });
  return built;
}

function groundTypeOf(consumed: readonly ConstructionRegionTopology[], patch: readonly ConstructionRegionTopology[]): string {
  return hasTrait(consumed[0]?.surfaceType ?? "", "ground") ? consumed[0]!.surfaceType : patch[0]?.surfaceType ?? "terrain";
}

/** The ground of `closable` lying within a face of where a structure rests on `patch`'s layer. */
function groundRoundContact(
  runtime: TerrainRegrowRuntime,
  patch: readonly ConstructionRegionTopology[],
  closable: readonly ConstructionRegionTopology[],
  faceSide: number,
  groundType: string,
): ConstructionRegionTopology[] {
  if (patch.length === 0) return [];
  const box = boxOf(patch.flatMap((face) => face.nodes.map((node) => [node.position.x, node.position.z] as const)), faceSide)!;
  const meeting = meetStructures(runtime, box, groundType, closable);
  const reaches = meeting.area.flatMap((piece) => {
    const reach = boxOf(piece[0] ?? [], faceSide);
    return reach ? [reach] : [];
  });
  return closable.filter((face) => face.nodes.some((node) => reaches.some((r) => node.position.x >= r.minX && node.position.x <= r.maxX && node.position.z >= r.minZ && node.position.z <= r.maxZ)));
}

interface PieceRequest {
  readonly piece: readonly ConstructionRegionTopology[];
  readonly around: readonly ConstructionRegionTopology[];
  readonly layer: readonly ConstructionRegionTopology[];
  readonly groundType: string;
  readonly faceSide: number;
  /** Keys of the faces an edit dragged out of shape: replaced, never read as the surface. */
  readonly stale: ReadonlySet<string>;
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
  const groundAt = groundSurfaceOf(request.layer, new Set(table.sources));
  const live = runtime.getSnapshot().map.nodePositions;
  // The structures' own corners and sides, to name what the contact's corners are.
  const corners = table.sources.flatMap((id) => {
    const at = live.get(id)?.position;
    return at ? [{ id, at }] : [];
  });
  const sidesOfStructures = table.rings.flatMap((ring) => ring.edges.flatMap((edge) => {
    const a = edge && live.get(edge.startNodeId)?.position, b = edge && live.get(edge.endNodeId)?.position;
    return edge && a && b ? [{ edge, a, b }] : [];
  }));
  const sideThrough = (point: { readonly x: number; readonly z: number }) => sidesOfStructures.find((side) => nearestOnSegment(point, side.a, side.b).distance < 1e-6)?.edge;

  // The contact's rings as they are -- never resampled, never snapped: each
  // corner the structure's node it stands on, or a point on the side it lies
  // on, which the ground then splits there.
  const given: { readonly node?: ConstructionNodeId; readonly position: ConstructionPosition; readonly side?: ConstructionRegionEdge }[] = [];
  const segmentSide = new Map<string, ConstructionRegionEdge>();
  const holes = meeting.area.flatMap((piece) => {
    const closed = piece[0] ?? [];
    const ring = closed.length > 1 && closed[0]![0] === closed.at(-1)![0] && closed[0]![1] === closed.at(-1)![1] ? closed.slice(0, -1) : closed;
    if (ring.length < 3) return [];
    const ids = ring.map(([x, z]) => {
      const point = { x, z };
      const node = corners.find((corner) => Math.hypot(corner.at.x - x, corner.at.z - z) < 1e-6);
      const side = node === undefined ? sideThrough(point) : undefined;
      const position = node?.at ?? { x, y: meeting.heightAt(point) ?? groundAt(point) ?? 0, z };
      given.push({ node: node?.id, position, side });
      return given.length - 1;
    });
    ids.forEach((id, index) => {
      const next = ids[(index + 1) % ids.length]!;
      const a = given[id]!.position, b = given[next]!.position;
      const edge = sidesOfStructures.find((side) => nearestOnSegment(a, side.a, side.b).distance < 1e-6 && nearestOnSegment(b, side.a, side.b).distance < 1e-6)?.edge;
      if (edge !== undefined) segmentSide.set(`${id}:${next}`, edge);
    });
    return [ids.map((id) => ({ position: [given[id]!.position.x, given[id]!.position.y, given[id]!.position.z] as const, id }))];
  });

  // The surface as it lies, less what an edit dragged out of shape.
  const surface = piece.filter((face) => !request.stale.has(face.surfaceKey.join("\u0000")));
  if (surface.length === 0) return 0;
  const indexed = indexedFaces(surface);
  const laid = timePhase(`terreno na superfície (${piece.length} faces)`, () => runtime.regenerateTerrainSurface({
    patch: { vertices: indexed.vertices, faces: indexed.faces },
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
