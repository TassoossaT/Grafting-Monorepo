import type {
  ConstructionGroundBed,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionTerrainRegeneration,
  ConstructionTerrainVolumeEditRequest,
  ConstructionTopologyBoundsQuery,
} from "@/ports";
import type { CutFallout } from "@/features/edit-construction";

// Relative, not `@/...`: the test runner resolves no aliases.
import { GROUND_CONTACT_CLEARANCE, hasTrait, isGroundType } from "../../../features/edit-construction/index.ts";
import { commitGround, indexedFaces, type GroundCommitRuntime } from "./ground-commit.ts";
import { closedPatch, regrowFaceSide, surfaceComponents } from "./ground-surface.ts";
import { layerLaid } from "./terrain-volume-edit.ts";
import { timePhase } from "../commit-timing.ts";

/**
 * The ground brought to rest under the structures standing on it (note 0012):
 * never cut for them.
 *
 * Where a structure -- a road, a floor, a ramp -- stands on the ground or
 * sunk in it, the ground is moved: up to just under the structure's faces
 * where it lay a little under them, down to them where it rose through them,
 * and eased back to where it was over a shoulder round them. That is the
 * brush's own levelling, along the structure, at its heights -- the ground's
 * layer engine (`layerTerrainSurface`) with the structures as its beds. Where
 * a structure stands far off the ground -- a bridge over a valley, a floor
 * over a cliff -- nothing moves. The ground stays one surface: no hole, no
 * side shared with a structure, nothing stitched. A structure taken away
 * leaves the ground shaped as it was shaped, as earthworks do.
 */

/** What resting the ground needs of the runtime. */
export interface TerrainConformRuntime extends GroundCommitRuntime {
  getRegionTopologiesInBounds(bounds: ConstructionTopologyBoundsQuery): readonly ConstructionRegionTopology[];
  layerTerrainSurface(request: ConstructionTerrainVolumeEditRequest): ConstructionTerrainRegeneration | undefined;
}

/** How far under a structure's faces the ground comes to rest. */
export const GROUND_REST_SINK = 0.08;
/** How far over its rest the ground may rise through a structure and still be cut down to it: past it, the structure runs into the hill. */
const RISES_THROUGH_MOST = 6;
/** How far past a structure's rim the ground still lies at rest, in faces: a cell along its side reaches no further, and never rises through it. */
const MARGIN_FACES = 1;
/** The shoulder's width for every metre the ground is moved there: a bank no steeper than about 1 in 1. */
const SHOULDER_SLOPE = 1.5;
/** The coarsest face ground is laid with (`regrowFaceSide`'s ceiling, at most). */
const COARSEST_FACE = 6;
/** The narrowest a shoulder is. */
const NARROWEST_SHOULDER = 1;
/** How far a corner has to move for its face to be laid again. */
const MOVES_AT_LEAST = 0.02;

/** How much of a face's normal has to point up for it to be ground a structure rests on. */
const RESTABLE_UP = 0.2;

const keyOf = (face: ConstructionRegionTopology) => face.surfaceKey.join("\u0000");

/** A face's corners in walk order. */
function ringOf(face: ConstructionRegionTopology): ConstructionPosition[] {
  const at = new Map(face.nodes.map((node) => [node.id, node.position]));
  return (face.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((p): p is ConstructionPosition => p !== undefined);
}

/** How much of a ground face's outward normal points up: 1 level, 0 upright, below 0 a ceiling. */
function upwardShare(face: ConstructionRegionTopology): number {
  const ring = ringOf(face);
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

interface Box { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number }

function boxOf(points: readonly { readonly x: number; readonly z: number }[], margin: number): Box | undefined {
  if (points.length === 0) return undefined;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { minX: minX - margin, minZ: minZ - margin, maxX: maxX + margin, maxZ: maxZ + margin };
}

/** One structure's faces as a bed, and the plan triangles and rim it is asked with -- the engine's own `Bed`, read the same way. */
interface BedReading {
  readonly bed: ConstructionGroundBed;
  /** Its extent in plan, past which only its rim is ever asked. */
  readonly box: Box;
  readonly triangles: readonly (readonly [ConstructionPosition, ConstructionPosition, ConstructionPosition])[];
  readonly rim: readonly (readonly [ConstructionPosition, ConstructionPosition])[];
}

type PlanPoint = { readonly x: number; readonly z: number };
const planCross = (a: PlanPoint, b: PlanPoint, c: PlanPoint) => (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);

function smoothstep(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** One as far as `reach`, easing to nothing a third past it: the engine's `fading`. */
const fading = (moved: number, reach: number) => (reach <= 0 ? 0 : 1 - smoothstep((moved - reach) / (reach / 3)));

/**
 * `ring` cut into triangles in plan, each ear the one closing the shortest
 * diagonal -- the engine's `short_ears`: a road is one long face, and an ear
 * clipped anywhere else lays a triangle from one end of it to the other.
 */
function shortEars(ring: readonly ConstructionPosition[]): [ConstructionPosition, ConstructionPosition, ConstructionPosition][] {
  if (ring.length < 3) return [];
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    area += p.x * q.z - q.x * p.z;
  }
  const left = area >= 0 ? [...ring] : [...ring].reverse();
  const out: [ConstructionPosition, ConstructionPosition, ConstructionPosition][] = [];
  while (left.length > 3) {
    const n = left.length;
    let ear = -1, shortest = Infinity;
    for (let k = 0; k < n; k += 1) {
      const a = left[(k + n - 1) % n]!, b = left[k]!, c = left[(k + 1) % n]!;
      if (planCross(a, b, c) <= 1e-12) continue;
      const diagonal = Math.hypot(a.x - c.x, a.z - c.z);
      if (diagonal >= shortest) continue;
      const blocked = left.some((p, j) => j !== (k + n - 1) % n && j !== k && j !== (k + 1) % n &&
        planCross(a, b, p) >= 0 && planCross(b, c, p) >= 0 && planCross(c, a, p) >= 0);
      if (blocked) continue;
      ear = k;
      shortest = diagonal;
    }
    if (ear < 0) {
      for (let k = 1; k + 1 < left.length; k += 1) out.push([left[0]!, left[k]!, left[k + 1]!]);
      return out;
    }
    out.push([left[(ear + n - 1) % n]!, left[ear]!, left[(ear + 1) % n]!]);
    left.splice(ear, 1);
  }
  out.push([left[0]!, left[1]!, left[2]!]);
  return out;
}

/** A structure's faces read as a bed: upright ones -- a wall's -- left out, standing on a line. */
function bedOf(faces: readonly ConstructionRegionTopology[], margin: number): BedReading | undefined {
  const triangles: [ConstructionPosition, ConstructionPosition, ConstructionPosition][] = [];
  const uses = new Map<string, { readonly a: ConstructionPosition; readonly b: ConstructionPosition; count: number }>();
  for (const face of faces) {
    const at = new Map(face.nodes.map((node) => [node.id, node.position]));
    const ring = (face.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((p): p is ConstructionPosition => p !== undefined);
    for (const [p, q, r] of shortEars(ring)) {
      const full = Math.hypot(
        (q.y - p.y) * (r.z - p.z) - (q.z - p.z) * (r.y - p.y),
        (q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z),
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x),
      );
      if (full > 1e-12 && Math.abs(planCross(p, q, r)) > 0.2 * full) triangles.push([p, q, r]);
    }
    // The faces' own sides: a fan's diagonals are shared twice and never rim.
    for (const use of face.outerLoops.flat()) {
      const a = at.get(use.startNodeId), b = at.get(use.endNodeId);
      if (!a || !b) continue;
      const entry = uses.get(use.edgeId);
      if (entry) entry.count += 1;
      else uses.set(use.edgeId, { a, b, count: 1 });
    }
  }
  if (triangles.length === 0) return undefined;
  const rim = [...uses.values()].filter((use) => use.count === 1).map((use) => [use.a, use.b] as const);
  const indexed = indexedFaces(faces);
  return {
    box: boxOf(triangles.flat(), 0)!,
    bed: {
      faces: { vertices: indexed.vertices, faces: indexed.faces },
      sink: GROUND_REST_SINK,
      below: GROUND_CONTACT_CLEARANCE,
      above: RISES_THROUGH_MOST,
      margin,
      slope: SHOULDER_SLOPE,
      shoulder: NARROWEST_SHOULDER,
    },
    triangles,
    rim,
  };
}

/** How far the bed reaches past its rim at most. */
const reachOf = ({ bed }: BedReading) => bed.margin + Math.max(bed.shoulder, (Math.max(bed.below, bed.above) * 4 / 3) * bed.slope);

/** How far `point` moves to rest under `reading`, and how much of that it takes -- the engine's `BedIndex::pull`. */
function pullOf(reading: BedReading, point: ConstructionPosition): { readonly d: number; readonly weight: number; readonly rim?: ConstructionPosition } | undefined {
  const { bed, box } = reading;
  const reach = reachOf(reading);
  if (point.x < box.minX - reach || point.x > box.maxX + reach || point.z < box.minZ - reach || point.z > box.maxZ + reach) return undefined;
  const fade = (d: number) => (d >= 0 ? fading(d, bed.below) : fading(-d, bed.above));
  let best: { d: number; weight: number } | undefined;
  for (const [p, q, r] of reading.triangles) {
    const area = planCross(p, q, r);
    const u = planCross(point, q, r) / area, v = planCross(p, point, r) / area, w = planCross(p, q, point) / area;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
    const d = p.y * u + q.y * v + r.y * w - bed.sink - point.y;
    const weight = fade(d);
    if (!best || weight > best.weight || (weight === best.weight && Math.abs(d) < Math.abs(best.d))) best = { d, weight };
  }
  if (best) return best;
  let nearest: { off: number; at: ConstructionPosition } | undefined;
  for (const [a, b] of reading.rim) {
    const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
    const t = length > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length)) : 0;
    const off = Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t);
    if (!nearest || off < nearest.off) nearest = { off, at: { x: a.x + dx * t, y: a.y + (b.y - a.y) * t, z: a.z + dz * t } };
  }
  if (!nearest || nearest.off > reach) return undefined;
  const d = nearest.at.y - bed.sink - point.y;
  const width = Math.max(bed.shoulder, Math.abs(d) * bed.slope);
  return { d, weight: (1 - smoothstep(Math.max(0, nearest.off - bed.margin) / width)) * fade(d), rim: nearest.at };
}

/** How far off both heights another sheet of ground has to lie to stand between them: the engine's own. */
const BETWEEN_SLACK = 0.1;

/** Whether a sheet of the ground lies strictly between heights `a` and `b` over a point -- with `facing`, only one facing that way: `1` up, `-1` down. */
type Between = (point: { readonly x: number; readonly z: number }, a: number, b: number, facing?: number) => boolean;

/** The ground as it stood, in plan -- the engine's `Sheets`. */
function sheetsOf(faces: readonly ConstructionRegionTopology[]): Between {
  const cell = 4;
  const buckets = new Map<string, (readonly [ConstructionPosition, ConstructionPosition, ConstructionPosition])[]>();
  for (const face of faces) {
    const ring = ringOf(face);
    for (let k = 1; k + 1 < ring.length; k += 1) {
      const triangle = [ring[0]!, ring[k]!, ring[k + 1]!] as const;
      const xs = triangle.map((p) => Math.floor(p.x / cell)), zs = triangle.map((p) => Math.floor(p.z / cell));
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1) {
        for (let z = Math.min(...zs); z <= Math.max(...zs); z += 1) {
          const key = `${x}:${z}`;
          const list = buckets.get(key);
          if (list) list.push(triangle);
          else buckets.set(key, [triangle]);
        }
      }
    }
  }
  // The sign of a face's area in plan where it faces up: the ground's own, which mostly does.
  let total = 0;
  for (const list of buckets.values()) for (const [p, q, r] of list) total += planCross(p, q, r);
  const up = total >= 0 ? 1 : -1;
  return (point, a, b, facing) => {
    const low = Math.min(a, b) + BETWEEN_SLACK, high = Math.max(a, b) - BETWEEN_SLACK;
    if (low >= high) return false;
    return (buckets.get(`${Math.floor(point.x / cell)}:${Math.floor(point.z / cell)}`) ?? []).some(([p, q, r]) => {
      const area = planCross(p, q, r);
      if (Math.abs(area) < 1e-12 || (facing !== undefined && Math.sign(area * up) !== facing)) return false;
      const u = planCross(point, q, r) / area, v = planCross(p, point, r) / area, w = planCross(p, q, point) / area;
      if (u < -1e-9 || v < -1e-9 || w < -1e-9) return false;
      const y = p.y * u + q.y * v + r.y * w;
      return y > low && y < high;
    });
  };
}

/**
 * How far `point` moves under every bed -- the engine's `bedded`: eased in
 * from the highest down, so the lowest has its way, and never through another
 * sheet of the ground (`between`) -- a floor under a tunnel's ceiling never
 * pulls the hill over it down.
 */
function movementOf(beds: readonly BedReading[], point: ConstructionPosition, between: Between): number {
  const pulls = beds.flatMap((reading) => {
    const pull = pullOf(reading, point);
    if (!pull || pull.weight <= 0) return [];
    const target = point.y + pull.d;
    // On the shoulder, never where a sheet facing down -- a ceiling, a deck's underside -- parts the structure's rim from it.
    if (between(point, point.y, target) || (pull.rim && between(pull.rim, target, point.y, -1))) return [];
    return [{ target, weight: pull.weight }];
  }).sort((a, b) => b.target - a.target);
  return pulls.reduce((y, { target, weight }) => y + (target - y) * Math.min(1, weight), point.y) - point.y;
}

/**
 * Brings the ground round a changed structure to rest under every structure
 * standing there. `fallout` says where the change was: the structure's
 * footprint and nodes, where it stood before, and what it cut. Returns how
 * many faces it laid.
 */
export function conformGround(runtime: TerrainConformRuntime, fallout: CutFallout, causeId: string, tableId: string): number {
  // Where the change was: where the structure stands, and where it stood.
  const places = [
    ...(fallout.footprintOutline ?? []).map(([x, z]) => ({ x, z })),
    ...fallout.paintedNodes.map((node) => node.position),
    ...(fallout.vacatedGround ?? []).flatMap((piece) => (piece[0] ?? []).map(([x, z]) => ({ x, z }))),
    ...(fallout.carriedFrom ? [...fallout.carriedFrom.values()] : []),
  ];
  if (places.length === 0) return 0;
  // As far as a bed's shoulder reaches past the change, and the structures
  // as far again: a bed reaching into that ground is asked too.
  const reachOut = MARGIN_FACES * COARSEST_FACE + Math.max(NARROWEST_SHOULDER, (RISES_THROUGH_MOST * 4 / 3) * SHOULDER_SLOPE);
  const near = boxOf(places, reachOut)!;
  const standing = timePhase("terreno em volta", () => runtime.getRegionTopologiesInBounds({
    minX: near.minX - reachOut, minZ: near.minZ - reachOut, maxX: near.maxX + reachOut, maxZ: near.maxZ + reachOut,
  }));
  const ground = standing.filter((face) => isGroundType(face.surfaceType) && face.outerLoops.length === 1 && face.holes.length === 0);
  const nearChange = (face: ConstructionRegionTopology) =>
    face.nodes.some((node) => node.position.x >= near.minX && node.position.x <= near.maxX && node.position.z >= near.minZ && node.position.z <= near.maxZ);
  if (ground.length === 0) return 0;
  const faceSide = regrowFaceSide(ground);
  const margin = MARGIN_FACES * faceSide;

  // Every structure standing there is a bed, each connected piece its own:
  // the ground comes to rest under all of them, the changed one's neighbours
  // too, so resting it again leaves them resting.
  const structures = standing.filter((face) => !hasTrait(face.surfaceType, "ground") && face.outerLoops.length >= 1);
  const beds = surfaceComponents(structures).flatMap((piece) => {
    const reading = bedOf(piece, margin);
    return reading ? [reading] : [];
  });
  if (beds.length === 0) return 0;

  // The faces a bed moves: a corner of them moves, and they face up.
  const between = sheetsOf(standing.filter((face) => isGroundType(face.surfaceType)));
  const moving = new Map<string, number>();
  const moves = (point: ConstructionPosition) => {
    const key = `${point.x}:${point.y}:${point.z}`;
    let d = moving.get(key);
    if (d === undefined) {
      d = movementOf(beds, point, between);
      moving.set(key, d);
    }
    return Math.abs(d) >= MOVES_AT_LEAST;
  };
  const restable = ground.filter((face) => upwardShare(face) >= RESTABLE_UP);
  const reached = timePhase("o que assenta", () => restable.filter((face) => nearChange(face) && face.nodes.some((node) => moves(node.position))));
  if (reached.length === 0) return 0;
  const patch = closedPatch(withoutSpikes(reached, restable), restable);

  let built = 0;
  const bounds = boxOf(patch.flatMap((face) => face.nodes.map((node) => node.position)), faceSide)!;
  const patchKeys = new Set(patch.map(keyOf));
  surfaceComponents(patch).forEach((piece, index) => {
    // Read again after the first piece: the ground round this one is now what the pieces before it laid.
    const now = index === 0 ? standing : runtime.getRegionTopologiesInBounds(bounds);
    const around = now.filter((face) => isGroundType(face.surfaceType) && !patchKeys.has(keyOf(face)));
    const neighbours = now.filter((face) => !isGroundType(face.surfaceType) && face.outerLoops.length >= 1);
    const indexedPatch = indexedFaces(piece);
    const context = indexedFaces(around);
    const others = indexedFaces(neighbours);
    const surfaceType = piece[0]!.surfaceType;
    const laid = timePhase(`motor: assentar o chão (${piece.length} faces)`, () => layerLaid(runtime.layerTerrainSurface({
      patch: { vertices: indexedPatch.vertices, faces: indexedPatch.faces },
      context: { vertices: context.vertices, faces: context.faces },
      neighbours: { vertices: others.vertices, faces: others.faces },
      shapes: [],
      faceSide,
      seed: seedOf(piece),
      beds: beds.map((reading) => reading.bed),
    }), indexedPatch.ids, [...context.ids, ...others.ids]));
    if (!laid) throw new Error("o núcleo recusou assentar o chão sob a estrutura");
    built += commitGround(runtime, {
      operationId: `${causeId}:rest-${index}`,
      tableId,
      replaced: piece,
      around: [...around, ...neighbours],
      surfaceType,
      faceSide,
      laid,
    }).built;
  });
  return built;
}

/** How sharp a turn of the patch's rim may be, in radians, before the ground round it is taken in. */
const SHARPEST_RIM_TURN = 0.3;

/**
 * `patch` with the ground round every spike of its rim taken in: where the
 * rim runs out to a corner and straight back -- a cell left folded thin
 * against it -- the engine reads a ring touching itself, and leaves a hole
 * there. Taken in, the thin cell is laid again whole. So is every face
 * wedged into a notch of the rim.
 */
function withoutSpikes(patch: readonly ConstructionRegionTopology[], ground: readonly ConstructionRegionTopology[]): ConstructionRegionTopology[] {
  const members = new Map(patch.map((face) => [keyOf(face), face] as const));
  const facesAtNode = new Map<string, ConstructionRegionTopology[]>();
  for (const face of ground) for (const node of face.nodes) facesAtNode.set(node.id, [...(facesAtNode.get(node.id) ?? []), face]);
  for (let round = 0; round < 4; round += 1) {
    const uses = new Map<string, number>();
    for (const face of members.values()) for (const use of face.outerLoops.flat()) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
    // Every rim side, by the corners at its ends.
    const sidesAt = new Map<string, ConstructionPosition[]>();
    const position = new Map<string, ConstructionPosition>();
    for (const face of members.values()) {
      for (const node of face.nodes) position.set(node.id, node.position);
      for (const use of face.outerLoops.flat()) {
        if (uses.get(use.edgeId) !== 1) continue;
        const a = face.nodes.find((n) => n.id === use.startNodeId)?.position, b = face.nodes.find((n) => n.id === use.endNodeId)?.position;
        if (!a || !b) continue;
        sidesAt.set(use.startNodeId, [...(sidesAt.get(use.startNodeId) ?? []), b]);
        sidesAt.set(use.endNodeId, [...(sidesAt.get(use.endNodeId) ?? []), a]);
      }
    }
    const spikes = [...sidesAt].filter(([id, ends]) => {
      const at = position.get(id)!;
      for (let i = 0; i < ends.length; i += 1) {
        for (let j = i + 1; j < ends.length; j += 1) {
          const u = { x: ends[i]!.x - at.x, z: ends[i]!.z - at.z }, v = { x: ends[j]!.x - at.x, z: ends[j]!.z - at.z };
          const angle = Math.abs(Math.atan2(u.x * v.z - u.z * v.x, u.x * v.x + u.z * v.z));
          if (angle < SHARPEST_RIM_TURN) return true;
        }
      }
      return false;
    });
    const before = members.size;
    for (const [id] of spikes) for (const face of facesAtNode.get(id) ?? []) members.set(keyOf(face), face);
    // And every face wedged into the rim -- holding two of its sides or more:
    // a notch the engine would bridge across, its new cell on top of that face.
    for (const face of ground) {
      if (members.has(keyOf(face))) continue;
      const held = face.outerLoops.flat().filter((use) => uses.get(use.edgeId) === 1).length;
      if (held >= 2) members.set(keyOf(face), face);
    }
    if (members.size === before) break;
  }
  return [...members.values()];
}

/** A seed the same faces always lay with. */
function seedOf(faces: readonly ConstructionRegionTopology[]): number {
  let hash = 2166136261;
  for (const key of faces.map(keyOf).sort()) {
    for (let i = 0; i < key.length; i += 1) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  }
  return (hash >>> 0) % 2147483647 || 1;
}
