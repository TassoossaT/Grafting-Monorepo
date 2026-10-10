import type {
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceOrigin,
  ConstructionVolumeShape,
} from "@/ports";

import { hasTrait } from "../../../features/edit-construction/index.ts";
import { commitGround, indexedFaces, type LaidGround } from "./ground-commit.ts";
import { grownInward, walkSurface } from "./ground-surface.ts";
import { timePhase } from "../commit-timing.ts";
import type { ToolContext } from "../tools/core/tool-context.ts";

/**
 * Carving into the ground and filling it in, in three dimensions, as an edit
 * of the ground's own mesh -- no layer beside it, nothing kept but the graph.
 *
 * A stroke names a shape: a capsule along its path. The terrain faces within
 * its reach are laid again by the engine (`editTerrainVolume`): their mesh,
 * with the ground round them, says where solid is; the shape is carved out
 * of it or filled into it; the new surface is stitched to the ring of nodes
 * round those faces and laid with the irregular grid's own cells over the
 * surface. What comes back goes into the graph as ground of the same type,
 * sharing the ring's very nodes and edges, so it is one mesh with the rest:
 * the next stroke, carving or not, edits it the same way.
 *
 * A layer laid or taken off and a level (`raise`, `lower`, columns) never
 * change what is solid, only where the surface lies: they go to the engine's
 * layer (`layerTerrainSurface`), which moves the faces' own surface and lays
 * it again with the plane's grid -- no grid read, no stitch. Only a bore or
 * an arch goes through the volume.
 */

/** Whether a shape only moves the surface: a layer or a level, never a bore or an arch. */
const movesSurface = (shape: ConstructionVolumeShape) => isLayer(shape) || shape.column !== undefined;


/** Whether a shape moves the surface along it by a profile: a layer, a smooth, noise. */
const isLayer = (shape: ConstructionVolumeShape) => shape.effect === "raise" || shape.effect === "lower" || shape.effect === "smooth" || shape.effect === "noise";

/** How far off the stroke's own height, past its depth and the slope, a layer still reaches the ground. */
const LAYER_HEIGHT_SLACK = 1;
/** How far past a layer's radius, in faces, the faces laid again reach: it changes nothing past it. */
const LAYER_MARGIN_FACES = 0.25;
/** How far past a shape's reach, in faces, the faces laid again reach. */
const PATCH_MARGIN_FACES = 2;
/** How far past the faces laid again, in faces, the ground asked where solid is reaches. */
const CONTEXT_MARGIN_FACES = 4;
/**
 * How far past the faces a layer lays again, in faces, the ground round them
 * is read: the layer meets only the faces beside its patch. Read as far as a
 * volume edit's, a small stroke read most of the map and handed it all to the
 * engine.
 */
const LAYER_CONTEXT_MARGIN_FACES = 1;

/** How thin a shape is at its thinnest, the scale its blend is taken from: the engine's `Shape::thickness`, but a layer by its height too. */
function thicknessOf(shape: ConstructionVolumeShape): number {
  // A layer blends into nothing: its own height is the scale it changes the ground at.
  if (shape.effect === "raise" || shape.effect === "lower") return Math.min(shape.radius, Math.abs(shape.height ?? shape.radius));
  // A smooth and noise move the surface by little: the brush's own width is their scale.
  if (shape.effect === "smooth" || shape.effect === "noise") return shape.radius;
  if (shape.column) return Math.min(shape.radius, Math.max(1e-3, (shape.column.high - shape.column.low) / 2));
  return shape.radius * Math.min(1, Math.max(1e-3, shape.squash ?? 1));
}

/** How far the shapes blend into the ground round them. */
const blendOf = (shapes: readonly ConstructionVolumeShape[]) => Math.min(...shapes.map(thicknessOf)) * 0.35;

/** Distance from `point` to `path`, heights scaled by `yScale`. */
function distanceToPath(point: ConstructionPosition, path: ConstructionVolumeShape["path"], yScale = 1): number {
  const px = point.x, py = point.y * yScale, pz = point.z;
  if (path.length === 1) return Math.hypot(px - path[0]![0], py - path[0]![1] * yScale, pz - path[0]![2]);
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay0, az] = path[i]!, [bx, by0, bz] = path[i + 1]!;
    const ay = ay0 * yScale, by = by0 * yScale;
    const dx = bx - ax, dy = by - ay, dz = bz - az, l = dx * dx + dy * dy + dz * dz;
    const t = l > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l)) : 0;
    best = Math.min(best, Math.hypot(px - ax - dx * t, py - ay - dy * t, pz - az - dz * t));
  }
  return best;
}

/** Distance in plan from `point` to `path`, and the path's height at the nearest point. */
function planToPath(point: ConstructionPosition, path: ConstructionVolumeShape["path"]): { readonly across: number; readonly y: number } {
  if (path.length === 1) return { across: Math.hypot(point.x - path[0]![0], point.z - path[0]![2]), y: path[0]![1] };
  let best = { across: Infinity, y: 0 };
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay, az] = path[i]!, [bx, by, bz] = path[i + 1]!;
    const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
    const t = l > 0 ? Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.z - az) * dz) / l)) : 0;
    const across = Math.hypot(point.x - ax - dx * t, point.z - az - dz * t);
    if (across < best.across) best = { across, y: ay + (by - ay) * t };
  }
  return best;
}

/** Where `point` stands against a path pushed along `way`: how far from the path square to the way, and how far along it. */
function againstWay(point: ConstructionPosition, path: ConstructionVolumeShape["path"], way: readonly [number, number, number]): { readonly across: number; readonly along: number } {
  let best = { across: Infinity, along: 0 };
  const spans = path.length === 1 ? [[path[0]!, path[0]!] as const] : path.slice(1).map((b, i) => [path[i]!, b] as const);
  for (const [[ax, ay, az], [bx, by, bz]] of spans) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, l = dx * dx + dy * dy + dz * dz;
    const t = l > 0 ? Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy + (point.z - az) * dz) / l)) : 0;
    const ox = point.x - ax - dx * t, oy = point.y - ay - dy * t, oz = point.z - az - dz * t;
    const along = ox * way[0] + oy * way[1] + oz * way[2];
    const across = Math.hypot(ox - way[0] * along, oy - way[1] * along, oz - way[2] * along);
    if (across < best.across) best = { across, along };
  }
  return best;
}

/** Signed distance to a shape, negative inside -- the engine's own (`Shape::distance`). */
export function shapeDistance(point: ConstructionPosition, shape: ConstructionVolumeShape): number {
  // A brush pushed out of a wall reaches across the wall as far as its
  // radius, and in front of it or behind only as far as its depth and its
  // radius carry it.
  if (isLayer(shape) && shape.direction) {
    const { across, along } = againstWay(point, shape.path, shape.direction);
    return Math.max(across - shape.radius, Math.abs(along) - Math.abs(shape.height ?? 0) - shape.radius - LAYER_HEIGHT_SLACK);
  }
  // A layer reaches across the ground as far as its radius, and up or down
  // only as far as its depth and the ground's own slope there carry it: the
  // ground under an arch a stroke was laid over is another layer, metres down.
  if (isLayer(shape)) {
    const { across, y } = planToPath(point, shape.path);
    return Math.max(across - shape.radius, Math.abs(point.y - y) - Math.abs(shape.height ?? shape.radius) - across - LAYER_HEIGHT_SLACK);
  }
  if (shape.column) {
    const across = distanceToPath(point, shape.path, 0) - shape.radius;
    const up = Math.max(shape.column.low - point.y, point.y - shape.column.high);
    return Math.hypot(Math.max(across, 0), Math.max(up, 0)) + Math.min(Math.max(across, up), 0);
  }
  const squash = Math.max(1e-3, shape.squash ?? 1);
  return (distanceToPath(point, shape.path, 1 / squash) - shape.radius) * Math.min(1, squash);
}

/** A face's own ring of node ids, in its walk order; `undefined` for a face with holes, which this edit leaves alone. */
function ringOf(topology: ConstructionRegionTopology): readonly ConstructionNodeId[] | undefined {
  if (topology.holes.length > 0 || topology.outerLoops.length !== 1) return undefined;
  return topology.outerLoops[0]!.map((use) => use.startNodeId);
}

/** How far down a face may turn and still be ground a layer rests on, as the share of its area that faces down in plan. */
const FACING_DOWN_SHARE = 0.2;

/**
 * How large a face has to be, as a share of a face's size squared, to be
 * taken for a sheet facing down. A smaller one is a sliver folded at the
 * ground's foot -- a corner run down to the table and back -- and is laid
 * again with the ground round it: left out, every stroke beside it laid
 * ground over it in plan, and the graph refused each one.
 */
const SLIVER_SHARE = 0.05;

/** The point of triangle `a b c` nearest `p` (Ericson, *Real-Time Collision Detection*, 5.1.5). */
function nearestOnTriangle(p: ConstructionPosition, a: ConstructionPosition, b: ConstructionPosition, c: ConstructionPosition): ConstructionPosition {
  const sub = (u: ConstructionPosition, v: ConstructionPosition) => ({ x: u.x - v.x, y: u.y - v.y, z: u.z - v.z });
  const dot = (u: ConstructionPosition, v: ConstructionPosition) => u.x * v.x + u.y * v.y + u.z * v.z;
  const at = (s: number, t: number) => ({ x: a.x + ab.x * s + ac.x * t, y: a.y + ab.y * s + ac.y * t, z: a.z + ab.z * s + ac.z * t });
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return { x: b.x + (c.x - b.x) * w, y: b.y + (c.y - b.y) * w, z: b.z + (c.z - b.z) * w };
  }
  const denominator = 1 / (va + vb + vc);
  return at(vb * denominator, vc * denominator);
}

/** The point of a face nearest `p`, its ring fanned from its first corner: a face taller than a brush is near it in its middle, though none of its corners is. */
function nearestOnFace(p: ConstructionPosition, topology: ConstructionRegionTopology): ConstructionPosition | undefined {
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const ring = (topology.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((q): q is ConstructionPosition => q !== undefined);
  let best: ConstructionPosition | undefined, bestDistance = Infinity;
  for (let k = 1; k + 1 < ring.length; k++) {
    const q = nearestOnTriangle(p, ring[0]!, ring[k]!, ring[k + 1]!);
    const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    if (d < bestDistance) {
      bestDistance = d;
      best = q;
    }
  }
  return best;
}

/** How far along `way` from `origin` the ray first meets triangle `a b c`; `undefined` where it misses (Moller-Trumbore). */
function rayHit(origin: ConstructionPosition, way: readonly [number, number, number], a: ConstructionPosition, b: ConstructionPosition, c: ConstructionPosition): number | undefined {
  const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const p = { x: way[1] * e2.z - way[2] * e2.y, y: way[2] * e2.x - way[0] * e2.z, z: way[0] * e2.y - way[1] * e2.x };
  const det = e1.x * p.x + e1.y * p.y + e1.z * p.z;
  if (Math.abs(det) < 1e-12) return undefined;
  const s = { x: origin.x - a.x, y: origin.y - a.y, z: origin.z - a.z };
  const u = (s.x * p.x + s.y * p.y + s.z * p.z) / det;
  if (u < 0 || u > 1) return undefined;
  const q = { x: s.y * e1.z - s.z * e1.y, y: s.z * e1.x - s.x * e1.z, z: s.x * e1.y - s.y * e1.x };
  const v = (way[0] * q.x + way[1] * q.y + way[2] * q.z) / det;
  if (v < 0 || u + v > 1) return undefined;
  return (e2.x * q.x + e2.y * q.y + e2.z * q.z) / det;
}

/** A face's corners in its walk order, and the box round them: read once a face, however often a stroke asks. */
interface FaceGeometry {
  readonly corners: readonly ConstructionPosition[];
  readonly low: ConstructionPosition;
  readonly high: ConstructionPosition;
}

const geometries = new WeakMap<ConstructionRegionTopology, FaceGeometry>();

function geometryOf(topology: ConstructionRegionTopology): FaceGeometry {
  const known = geometries.get(topology);
  if (known) return known;
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const corners = (topology.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((p): p is ConstructionPosition => p !== undefined);
  const low = { x: Math.min(...corners.map((p) => p.x)), y: Math.min(...corners.map((p) => p.y)), z: Math.min(...corners.map((p) => p.z)) };
  const high = { x: Math.max(...corners.map((p) => p.x)), y: Math.max(...corners.map((p) => p.y)), z: Math.max(...corners.map((p) => p.z)) };
  const geometry = { corners, low, high };
  geometries.set(topology, geometry);
  return geometry;
}

/** A face's corners in its walk order. */
const cornersOf = (topology: ConstructionRegionTopology): readonly ConstructionPosition[] => geometryOf(topology).corners;

/** The way a layer pushes: its brush's own, or up. */
const wayOfShape = (shape: ConstructionVolumeShape): readonly [number, number, number] => shape.direction ?? [0, 1, 0];

/** How far in front of a face, as a share of a face, another may lie without hiding it: the same surface, barely creased. */
const HIDING_GAP_SHARE = 0.05;

/** How far past the brush's own level, as a share of its radius, a face still hides one behind it. */
const HIDING_SHARE = 0.25;

/**
 * Whether another face of `faces` stands between `topology` and the brush
 * along its way -- the ground under a ledge a stroke on the ledge's top is
 * laid on, the far side of a fold -- short of the brush's own level there:
 * a brush moves only the surface it sees, as a sculptor's does. A tunnel's
 * ceiling, past the level of a stroke on its floor, hides nothing.
 */
function hiddenFrom(topology: ConstructionRegionTopology, faces: readonly ConstructionRegionTopology[], shape: ConstructionVolumeShape, faceSide: number): boolean {
  const way = wayOfShape(shape);
  const corners = cornersOf(topology);
  if (corners.length < 3) return false;
  const centre = corners.reduce((sum, p) => ({ x: sum.x + p.x / corners.length, y: sum.y + p.y / corners.length, z: sum.z + p.z / corners.length }), { x: 0, y: 0, z: 0 });
  const along = (p: ConstructionPosition | readonly [number, number, number]) => ("x" in p ? p.x * way[0] + p.y * way[1] + p.z * way[2] : p[0] * way[0] + p[1] * way[1] + p[2] * way[2]);
  // The brush's level: its path's, the highest along its way, and a little past.
  const level = Math.max(...shape.path.map(along)) + shape.radius * HIDING_SHARE;
  const reach = level - along(centre);
  if (reach <= 0) return false;
  // The stretch of the ray that counts, boxed: a face off it is never asked.
  const end = { x: centre.x + way[0] * reach, y: centre.y + way[1] * reach, z: centre.z + way[2] * reach };
  const low = { x: Math.min(centre.x, end.x), y: Math.min(centre.y, end.y), z: Math.min(centre.z, end.z) };
  const high = { x: Math.max(centre.x, end.x), y: Math.max(centre.y, end.y), z: Math.max(centre.z, end.z) };
  const own = new Set(topology.nodes.map((node) => node.id));
  return faces.some((face) => {
    // A face beside it is the same surface creased, never another sheet over it.
    if (face === topology || face.nodes.some((node) => own.has(node.id))) return false;
    const box = geometryOf(face);
    if (box.high.x < low.x || box.low.x > high.x || box.high.y < low.y || box.low.y > high.y || box.high.z < low.z || box.low.z > high.z) return false;
    const ring = box.corners;
    for (let k = 1; k + 1 < ring.length; k++) {
      const t = rayHit(centre, way, ring[0]!, ring[k]!, ring[k + 1]!);
      if (t !== undefined && t > faceSide * HIDING_GAP_SHARE && t < reach) return true;
    }
    return false;
  });
}

/** A face's way out of the solid, its area long: the ground faces up counter-clockwise in plan. */
function outwardArea(topology: ConstructionRegionTopology): ConstructionPosition {
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const ring = (topology.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((p): p is ConstructionPosition => p !== undefined);
  let x = 0, y = 0, z = 0;
  ring.forEach((a, index) => {
    const b = ring[(index + 1) % ring.length]!;
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  });
  return { x: -x / 2, y: -y / 2, z: -z / 2 };
}

/**
 * Whether a face turns from the way a brush pushes -- the far side of a
 * wall, an arch's underside, ground edge-on to it -- and is no part of what
 * it moves: as a layer leaves out a face turned down, by the same share. The
 * engine lays the rest as ground facing the brush's way, in plan along it.
 */
function facesAway(topology: ConstructionRegionTopology, shapes: readonly ConstructionVolumeShape[], faceSide: number): boolean {
  const ways = shapes.flatMap((shape) => (isLayer(shape) && shape.direction ? [shape.direction] : []));
  if (ways.length === 0) return false;
  const out = outwardArea(topology), size = Math.hypot(out.x, out.y, out.z);
  if (size < SLIVER_SHARE * faceSide * faceSide) return false;
  return ways.every(([x, y, z]) => out.x * x + out.y * y + out.z * z <= FACING_DOWN_SHARE * size);
}

/**
 * The way a brush drawn at `point` pushes: out of the ground's faces round
 * it, within `reach`, each by its area -- the faces facing the way `facing`
 * says only, never the far side of a wall. `undefined` with no face there.
 */
export function brushWay(
  runtime: { getRegionTopologiesInBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): readonly ConstructionRegionTopology[] },
  point: ConstructionPosition,
  reach: number,
  facing: ConstructionPosition,
): ConstructionPosition | undefined {
  let x = 0, y = 0, z = 0;
  for (const face of runtime.getRegionTopologiesInBounds({ minX: point.x - reach, minZ: point.z - reach, maxX: point.x + reach, maxZ: point.z + reach })) {
    if (!hasTrait(face.surfaceType, "ground")) continue;
    const nearest = nearestOnFace(point, face);
    const near = nearest !== undefined && Math.hypot(nearest.x - point.x, nearest.y - point.y, nearest.z - point.z) <= reach;
    const out = outwardArea(face);
    if (!near || out.x * facing.x + out.y * facing.y + out.z * facing.z <= 0) continue;
    x += out.x;
    y += out.y;
    z += out.z;
  }
  const length = Math.hypot(x, y, z);
  return length > 1e-9 ? { x: x / length, y: y / length, z: z / length } : undefined;
}

/** Whether a face turns down, its underside up: the ground faces up counter-clockwise in plan. */
function facesDown(topology: ConstructionRegionTopology, faceSide: number): boolean {
  const ring = ringOf(topology);
  if (!ring) return false;
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  let planArea = 0, normal = { x: 0, y: 0, z: 0 };
  ring.forEach((id, index) => {
    const a = at.get(id)!, b = at.get(ring[(index + 1) % ring.length]!)!;
    planArea += a.x * b.z - b.x * a.z;
    normal = { x: normal.x + (a.y - b.y) * (a.z + b.z), y: normal.y + (a.z - b.z) * (a.x + b.x), z: normal.z + (a.x - b.x) * (a.y + b.y) };
  });
  const size = Math.hypot(normal.x, normal.y, normal.z);
  return size >= 2 * SLIVER_SHARE * faceSide * faceSide && planArea < -FACING_DOWN_SHARE * size;
}

/** The face size of the ground being laid again: the median side of its faces. */
function faceSideOf(faces: readonly ConstructionRegionTopology[]): number {
  const sides = faces.flatMap((face) => face.outerLoops.flat().map((use) => {
    const a = face.nodes.find((n) => n.id === use.startNodeId)!.position, b = face.nodes.find((n) => n.id === use.endNodeId)!.position;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  })).sort((a, b) => a - b);
  return Math.max(0.75, Math.min(6, sides[sides.length >> 1] ?? 2));
}

/**
 * Carves `shapes` into the ground or fills them in, in order, as one
 * transaction. With `table`, new ground may rest on the bare table -- a fill
 * where no ground stands at all lays it there. No faces where no ground is in
 * reach and nothing may rest on the table; throws where nothing could be
 * laid, the ground then left as it was.
 */
export function commitTerrainVolumeEdit(
  ctx: ToolContext,
  shapes: readonly ConstructionVolumeShape[],
  options: {
    readonly faceSide?: number;
    readonly seed: number;
    readonly table?: number;
    readonly surfaceType?: string;
    /** The face size to lay where no ground stands to take it from. */
    readonly emptyFaceSide?: number;
  },
): { readonly faces: number } {
  if (shapes.length === 0) throw new Error("nada a cavar ou erguer");
  const blend = blendOf(shapes);
  const xs = shapes.flatMap((shape) => shape.path.map((p) => p[0])), zs = shapes.flatMap((shape) => shape.path.map((p) => p[2]));
  const widest = Math.max(...shapes.map((shape) => shape.radius));
  const guess = options.faceSide ?? 2;
  const margin = blend + PATCH_MARGIN_FACES * guess;
  const outer = widest + margin + (shapes.every(movesSurface) ? LAYER_CONTEXT_MARGIN_FACES : CONTEXT_MARGIN_FACES) * guess;
  const standing = ctx.runtime.getRegionTopologiesInBounds({
    minX: Math.min(...xs) - outer, minZ: Math.min(...zs) - outer, maxX: Math.max(...xs) + outer, maxZ: Math.max(...zs) + outer,
  });
  const nearby = standing.filter((topology) => hasTrait(topology.surfaceType, "ground") && ringOf(topology) !== undefined);
  // Structures standing in the ground: the sides of it they hold are kept.
  const structures = standing.filter((topology) => !hasTrait(topology.surfaceType, "ground") && ringOf(topology) !== undefined);
  // The faces the shapes change, and round them, over the surface, as far as
  // the shapes reach in three dimensions: a cave's ceiling over a layer laid
  // on its floor is neither changed nor reached, and never laid again. A
  // layer or a level changes only what it covers, so it reaches a face
  // further; a bore or an arch is given more room to blend.
  const reachOf = (shape: ConstructionVolumeShape) =>
    blend + (isLayer(shape) ? LAYER_MARGIN_FACES : shape.column ? 1 : PATCH_MARGIN_FACES) * guess;
  // A layer or a level rests on ground facing up, or a wall: never on the
  // underside of an arch over it, which would fold the faces laid again.
  const layer = shapes.every(movesSurface);
  // Turned from the brush: down under a layer, away from a brush on a wall.
  const turnedAway = (topology: ConstructionRegionTopology) =>
    layer && (shapes.some((shape) => shape.direction) ? facesAway(topology, shapes, guess) : facesDown(topology, guess));
  const within = (topology: ConstructionRegionTopology, extra: (shape: ConstructionVolumeShape) => number) =>
    !turnedAway(topology) &&
    (topology.nodes.some((node) => shapes.some((shape) => shapeDistance(node.position, shape) < extra(shape))) ||
      // A brush on a wall reaches a face taller than it in its middle, though no corner of it.
      shapes.some((shape) => shape.direction !== undefined && shape.path.some(([x, y, z]) => {
        const nearest = nearestOnFace({ x, y, z }, topology);
        return nearest !== undefined && shapeDistance(nearest, shape) < extra(shape);
      })));
  // Grown from the ground under the stroke itself -- the face nearest each
  // point of every path -- never from whatever lies near in three dimensions:
  // through a thin roof, a tunnel's ceiling lies a metre under the hill a
  // stroke is laid on, and is no part of it.
  const under = (point: readonly [number, number, number]) => {
    let best: ConstructionRegionTopology | undefined, bestDistance = Infinity;
    // The face the point lies on, by its nearest point: a face taller than
    // the brush -- a cliff's flank -- has no corner near a point in its middle.
    for (const topology of nearby) {
      const nearest = nearestOnFace({ x: point[0], y: point[1], z: point[2] }, topology);
      const d = nearest ? Math.hypot(nearest.x - point[0], nearest.y - point[1], nearest.z - point[2]) : Infinity;
      if (d < bestDistance) {
        bestDistance = d;
        best = topology;
      }
    }
    return best;
  };
  // And from every face a bore or an arch takes in or blends into, wherever
  // it lies: earth filled against the tip of an arch reaching over from
  // elsewhere joins it there, though no walk over the surface gets there.
  const touched = layer ? [] : nearby.filter((topology) => within(topology, () => blend));
  const core = [...new Set([...shapes.flatMap((shape) => shape.path.map(under)), ...touched])].filter(
    (topology): topology is ConstructionRegionTopology => topology !== undefined && within(topology, reachOf),
  );
  // A layer moves only the surface its brush sees: never ground behind
  // other ground along its way. Asked once a face.
  const seen = new Map<ConstructionRegionTopology, boolean>();
  const inSight = (topology: ConstructionRegionTopology) => {
    if (!layer) return true;
    if (!seen.has(topology)) seen.set(topology, !shapes.some((shape) => hiddenFrom(topology, nearby, shape, guess)));
    return seen.get(topology)!;
  };
  const taken = (topology: ConstructionRegionTopology) => within(topology, reachOf) && inSight(topology);
  const walked = walkSurface(nearby, core.filter(inSight).length > 0 ? core.filter(inSight) : nearby.filter(taken), taken);
  if (walked.length === 0 && options.table === undefined) return { faces: 0 };
  const neighbours = indexedFaces(structures);
  const attempt = (given: readonly ConstructionRegionTopology[]) => {
    const patchFaces = largestPiece(given);
    const patchKeys = new Set(patchFaces.map((face) => face.surfaceKey.join("\u0000")));
    // A layer meets only the ground beside its patch -- sharing a corner with
    // it, or within its reach, where a layer run on over the table must not
    // cover it. Handed every face read, the engine took in most of the map.
    const corners = new Set(patchFaces.flatMap((face) => face.nodes.map((node) => node.id)));
    const contextFaces = nearby.filter((topology) => !patchKeys.has(topology.surfaceKey.join("\u0000")) &&
      (!layer || topology.nodes.some((node) => corners.has(node.id) || shapes.some((shape) => planToPath(node.position, shape.path).across < shape.radius + blend + guess))));
    // The ground's own face size; the engine lays finer where the shape is narrow.
    const faceSide = options.faceSide ?? (patchFaces.length > 0 ? faceSideOf(patchFaces) : options.emptyFaceSide ?? 2);
    const patch = indexedFaces(patchFaces);
    const context = indexedFaces(contextFaces);
    const request = {
      patch: { vertices: patch.vertices, faces: patch.faces },
      context: { vertices: context.vertices, faces: context.faces },
      shapes,
      blend,
      faceSide,
      seed: options.seed,
      ...(options.table !== undefined ? { table: options.table } : {}),
      neighbours: { vertices: neighbours.vertices, faces: neighbours.faces },
    };
    const label = `motor: ${layer ? "camada" : "volume"} (${patchFaces.length} faces refeitas, ${contextFaces.length} em volta)`;
    // A layer or a level the surface's own way, never through the volume:
    // the volume laid the patch again whole, folded where it was steep, and
    // the strokes after it were refused on the folds. A bore or an arch
    // through the volume.
    const laid: LaidGround | undefined = timePhase(label, () =>
      (layer ? layerLaid(ctx.runtime.layerTerrainSurface(request), patch.ids, [...context.ids, ...neighbours.ids]) : undefined) ??
      (layer ? undefined : volumeLaid(ctx.runtime.editTerrainVolume(request), patch.ids)));
    // Never laid so the ground is no surface after: two sheets touching at
    // a point refused every stroke over them after.
    if (laid && !staysSurface(laid, patchKeys, nearby)) return undefined;
    return laid ? { laid, patchFaces, contextFaces, faceSide } : undefined;
  };
  // A hole in the patch the edit closes over is laid again with it: tried as
  // walked first, then grown inward from its holes a ring at a time -- a
  // patch no larger than the last one tried is the same refusal, never asked twice.
  // The patch with the islands of ground it closes round taken in first:
  // left out -- small faces folded by an older stroke -- each was a hole the
  // new ground went round in fine cells, a hundred holes laid six times the
  // faces, and every stroke after it over that ground cost more. A layer
  // whose patch folds at its rim, seen along its brush's way, is tried a ring
  // and two rings wider after: the fold inside it, laid flat as the brush
  // sees it. Each next patch is worked out only when the one before it was
  // refused.
  const sightly = (topology: ConstructionRegionTopology) => !turnedAway(topology) && inSight(topology);
  const tries: (() => readonly ConstructionRegionTopology[])[] = [
    () => grownInward(walked, nearby, 1),
    () => walked,
    () => grownInward(walked, nearby, 2),
    ...(layer ? [() => ringWider(walked, nearby, sightly), () => ringWider(ringWider(walked, nearby, sightly), nearby, sightly)] : []),
  ];
  let done: ReturnType<typeof attempt>;
  let last = -1;
  for (const next of tries) {
    const patchFaces = next();
    // A patch no larger than the last one tried is the same refusal, never asked twice.
    if (patchFaces.length === last) continue;
    last = patchFaces.length;
    done = attempt(patchFaces);
    if (done) break;
  }
  // Run on over the table, the layer could only meet the ground beside it
  // in the middle of a sheet -- under a ledge overhanging the table: laid
  // again on the ground alone, the table left bare.
  if (!done && options.table !== undefined && walked.length > 0) return commitTerrainVolumeEdit(ctx, shapes, { ...options, table: undefined });
  if (!done) throw new Error("o núcleo recusou a edição");
  const commit = ({ laid, patchFaces, contextFaces, faceSide }: NonNullable<typeof done>) => {
    const operationId = `${ctx.tableId}:terrain-volume:${ctx.nextSequence()}`;
    let built = 0;
    const { recorded } = ctx.runtime.transact(operationId, "local", () => {
      built = commitGround(ctx.runtime, {
        operationId,
        tableId: ctx.tableId,
        replaced: patchFaces,
        around: contextFaces,
        surfaceType: patchFaces[0]?.surfaceType ?? options.surfaceType ?? "terrain",
        faceSide,
        laid,
      }).built;
    });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    return { faces: built };
  };
  try {
    return commit(done);
  } catch (error) {
    // The graph refused a side of the rim: a face just past the patch walks
    // against what was laid -- a cell folded in plan, left by an older edit.
    // Laid again with the patch one ring wider, that face goes with it.
    if (!REFUSED_SIDE.test(error instanceof Error ? error.message : String(error))) throw error;
    const widened = ringWider(done.patchFaces, nearby, sightly);
    const again = widened.length > done.patchFaces.length ? attempt(widened) : undefined;
    if (!again) throw error;
    return commit(again);
  }
}

/** A refusal by the graph of one side of the rim, which a patch a ring wider can lay past. */
const REFUSED_SIDE = /no room on edge/;

/** `patch` with every face of `ground` that shares a corner with it and `takes` allows. */
/**
 * Whether the ground stays a surface with `laid` in place of the faces of
 * `ground` whose keys are `taken`: no node it holds ends in more fans of
 * faces than it had, and no side is held three times. Laid onto the middle
 * of a sheet -- a ledge's flank seen from above the table it overhangs -- or
 * past its own rim, two sheets would touch at a point, and every stroke over
 * them after was refused.
 */
function staysSurface(laid: LaidGround, taken: ReadonlySet<string>, ground: readonly ConstructionRegionTopology[]): boolean {
  const ringOfFace = (face: ConstructionRegionTopology) => (face.outerLoops[0] ?? []).map((use) => use.startNodeId as string);
  const idOf = (vertex: number) => (laid.nodeOf(vertex) as string | undefined) ?? `new:${vertex}`;
  // New corners on a side of the ground left, in order along it.
  const onSide = new Map<string, string[]>();
  const along = new Map<string, number>();
  for (const { vertex, from, to } of laid.landed ?? []) {
    const [x, y, z] = laid.vertices[vertex]!;
    along.set(`new:${vertex}`, Math.hypot(x, y, z));
    onSide.set(`${from}|${to}`, [...(onSide.get(`${from}|${to}`) ?? []), `new:${vertex}`]);
  }
  const split = (ring: string[]) => ring.flatMap((node, k) => {
    const next = ring[(k + 1) % ring.length]!;
    const forward = onSide.get(`${node}|${next}`), backward = onSide.get(`${next}|${node}`);
    const within = forward ?? (backward ? [...backward].reverse() : []);
    return [node, ...within];
  });
  const fans = (rings: readonly string[][]) => {
    const links = new Map<string, string[][]>();
    const sides = new Map<string, number>();
    for (const ring of rings) ring.forEach((node, k) => {
      const prev = ring[(k + ring.length - 1) % ring.length]!, next = ring[(k + 1) % ring.length]!;
      links.set(node, [...(links.get(node) ?? []), [prev, next]]);
      const side = node < next ? `${node}|${next}` : `${next}|${node}`;
      sides.set(side, (sides.get(side) ?? 0) + 1);
    });
    const count = (node: string) => {
      const list = links.get(node) ?? [];
      const fan = new Array<number>(list.length).fill(-1);
      let n = 0;
      for (let start = 0; start < list.length; start++) {
        if (fan[start] !== -1) continue;
        fan[start] = n;
        const stack = [start];
        while (stack.length > 0) {
          const i = stack.pop()!;
          for (let j = 0; j < list.length; j++) if (fan[j] === -1 && list[j]!.some((u) => list[i]!.includes(u))) { fan[j] = n; stack.push(j); }
        }
        n += 1;
      }
      return n;
    };
    return { count, sides };
  };
  const before = fans(ground.map(ringOfFace));
  const left = ground.filter((face) => !taken.has(face.surfaceKey.join("\u0000"))).map((face) => split(ringOfFace(face)));
  const after = fans([...left, ...laid.faces.map((face) => face.map(idOf))]);
  const held = new Set(laid.faces.flatMap((face) => face.map(idOf)).filter((id) => !id.startsWith("new:")));
  if ([...held].some((node) => after.count(node) > Math.max(1, before.count(node)))) return false;
  return [...after.sides].every(([side, count]) => count <= 2 || (before.sides.get(side) ?? 0) > 2);
}

/**
 * `faces` less any piece of them -- faces sharing sides -- that touches a
 * larger piece at a corner only: taken in a ring wider, it is a second patch
 * pinched onto the first, and the engine lays no such patch.
 */
function largestPiece(faces: readonly ConstructionRegionTopology[]): readonly ConstructionRegionTopology[] {
  const bySide = new Map<string, number[]>();
  faces.forEach((face, index) => {
    const ring = (face.outerLoops[0] ?? []).map((use) => use.startNodeId);
    ring.forEach((a, k) => {
      const b = ring[(k + 1) % ring.length]!;
      const side = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      bySide.set(side, [...(bySide.get(side) ?? []), index]);
    });
  });
  const piece = new Array<number>(faces.length).fill(-1);
  const sizes: number[] = [];
  const beside = new Map<number, number[]>();
  for (const sharing of bySide.values()) for (const f of sharing) beside.set(f, [...(beside.get(f) ?? []), ...sharing.filter((g) => g !== f)]);
  faces.forEach((_, start) => {
    if (piece[start] !== -1) return;
    const id = sizes.length;
    let size = 0;
    const stack = [start];
    piece[start] = id;
    while (stack.length > 0) {
      const f = stack.pop()!;
      size += 1;
      for (const g of beside.get(f) ?? []) if (piece[g] === -1) { piece[g] = id; stack.push(g); }
    }
    sizes.push(size);
  });
  if (sizes.length <= 1) return faces;
  // Pieces apart -- a stroke joining two hills over the table -- are laid
  // together; a piece touching a larger one at a corner only is left out.
  const order = sizes.map((size, id) => [size, id] as const).sort((a, b) => b[0] - a[0]).map(([, id]) => id);
  const keptNodes = new Set<string>();
  const kept = new Set<number>();
  for (const id of order) {
    const nodes = faces.filter((_, index) => piece[index] === id).flatMap((face) => face.nodes.map((node) => node.id as string));
    if (nodes.some((node) => keptNodes.has(node))) continue;
    kept.add(id);
    for (const node of nodes) keptNodes.add(node);
  }
  return faces.filter((_, index) => kept.has(piece[index]!));
}

function ringWider(
  patch: readonly ConstructionRegionTopology[],
  ground: readonly ConstructionRegionTopology[],
  takes: (topology: ConstructionRegionTopology) => boolean,
): ConstructionRegionTopology[] {
  const key = (face: ConstructionRegionTopology) => face.surfaceKey.join("\u0000");
  const members = new Set(patch.map(key));
  const corners = new Set(patch.flatMap((face) => face.nodes.map((node) => node.id)));
  return [...patch, ...ground.filter((face) => !members.has(key(face)) && takes(face) && face.nodes.some((node) => corners.has(node.id)))];
}

/** The ground a layer laid (`layerTerrainSurface`), in the nodes it stands on: the patch's own, and the ground's and structures' round it (`given`, in that order). */
export function layerLaid(edited: ReturnType<ToolContext["runtime"]["layerTerrainSurface"]>, ids: readonly ConstructionNodeId[], given: readonly ConstructionNodeId[]): LaidGround | undefined {
  if (!edited) return undefined;
  const nodeOf = (origin: ConstructionSurfaceOrigin | null | undefined) => (origin === null || origin === undefined ? undefined : origin.kind === "patch" ? ids[origin.index] : given[origin.index]);
  const landed = edited.landed.flatMap((landing) => {
    const from = nodeOf(landing.from), to = nodeOf(landing.to);
    return from !== undefined && to !== undefined ? [{ vertex: landing.vertex, from, to }] : [];
  });
  return { vertices: edited.vertices, faces: edited.faces, nodeOf: (vertex) => nodeOf(edited.origin[vertex]), landed };
}

/** The ground a volume edit laid, in the patch's own nodes. */
function volumeLaid(edited: ReturnType<ToolContext["runtime"]["editTerrainVolume"]>, ids: readonly ConstructionNodeId[]): LaidGround | undefined {
  if (!edited) return undefined;
  return {
    vertices: edited.vertices,
    faces: edited.faces,
    nodeOf: (vertex) => {
      const source = edited.source[vertex];
      return source === null || source === undefined ? undefined : ids[source];
    },
  };
}

/** At least this far between the points a stroke's path keeps, as a fraction of its radius. */
const PATH_STEP = 0.75;

/**
 * How far over the point it starts on a carve's axis runs, as a fraction of
 * its radius: its floor on the ground there, never under it -- sunk, it would
 * dig a trench everywhere the stroke crosses level ground on its way into a
 * hill; on it, the tunnel opens only where the hill rises over its floor.
 */
const CARVE_AXIS_RISE = 1.05;

/** The pointer's path, thinned to a point every so often, the last kept. */
function thinned(points: readonly ConstructionPosition[], step: number): ConstructionPosition[] {
  const kept: ConstructionPosition[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.z - last.z) >= step) kept.push(point);
  }
  const end = points.at(-1);
  if (end && kept.at(-1) !== end && kept.length > 1) kept[kept.length - 1] = end;
  return kept;
}

/**
 * A carve pushed into the ground from where the stroke starts: level at that
 * height, its floor on the ground there, running wherever the stroke runs in
 * plan. A click without a drag is a ball sunk into the ground there.
 */
export function carveShape(points: readonly ConstructionPosition[], radius: number): ConstructionVolumeShape | undefined {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length === 0) return undefined;
  if (path.length === 1) return { effect: "carve", radius, path: [[path[0]!.x, path[0]!.y, path[0]!.z]] };
  const y = path[0]!.y + radius * CARVE_AXIS_RISE;
  return { effect: "carve", radius, path: path.map((p) => [p.x, y, p.z] as const) };
}

/**
 * How far out of the surface clicked a ball of earth stands, as a share of
 * its radius: sunk to its middle, it reaches as far under the surface as
 * over it -- down to the ground under the side of the ball it was set on,
 * and the arch being built ball by ball closes into a wall.
 */
const BALL_OUT = 0.5;

/**
 * Earth filled in from where the stroke starts to where it ends: its feet in
 * the ground at both, arched `rise` over the line between them -- a bridge.
 * A click without a drag is a ball standing out of the surface it was set
 * on, `outward` from it: set on the side of the last ball, it grows the
 * ground on sideways, and balls set one on another bridge a gap.
 */
export function fillShape(points: readonly ConstructionPosition[], radius: number, rise: number, outward?: ConstructionPosition): ConstructionVolumeShape | undefined {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length === 0) return undefined;
  if (path.length === 1) {
    const out = radius * BALL_OUT;
    const [x, y, z] = [path[0]!.x, path[0]!.y, path[0]!.z];
    return { effect: "fill", radius, path: [outward ? [x + outward.x * out, y + outward.y * out, z + outward.z * out] : [x, y, z]] };
  }
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z));
  const total = lengths.at(-1)!;
  const [start, end] = [path[0]!, path.at(-1)!];
  return {
    effect: "fill",
    radius,
    path: path.map((p, i) => {
      const t = total > 0 ? lengths[i]! / total : 0;
      return [p.x, start.y + (end.y - start.y) * t + rise * Math.sin(Math.PI * t), p.z] as const;
    }),
  };
}

/** Where the volume a stroke would carve or fill runs, for its ghost: the very path the commit uses. */
export function volumeStrokePath(mode: "carve" | "fill", points: readonly ConstructionPosition[], radius: number, rise: number): readonly ConstructionPosition[] {
  const shape = mode === "carve" ? carveShape(points, radius) : fillShape(points, radius, rise);
  return shape ? shape.path.map(([x, y, z]) => ({ x, y, z })) : [];
}

/** A terrain editor's brush: how strong, and how its effect fades to its rim. Omitted, all of it, a cosine from the middle. */
export interface TerrainBrush {
  readonly strength?: number;
  readonly falloff?: number;
  readonly falloffType?: "smooth" | "linear" | "spherical" | "tip";
  /** For a raise or a lower: the way it pushes, out of the surface it is drawn on. Omitted: up. */
  readonly direction?: ConstructionPosition;
}

/** A brush as the wire carries it. */
const wired = ({ direction, ...brush }: TerrainBrush) => ({ ...brush, ...(direction ? { direction: [direction.x, direction.y, direction.z] as const } : {}) });

/**
 * A layer of earth laid along a stroke -- or the trench dug along it:
 * `height` deep where the stroke ran, fading by the brush to nothing at its
 * radius, over the ground it lies on -- a hillside, a cave's floor or its
 * wall alike.
 */
export function moundShape(effect: "raise" | "lower", points: readonly ConstructionPosition[], radius: number, height: number, brush: TerrainBrush = {}): ConstructionVolumeShape | undefined {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length === 0) return undefined;
  return { effect, radius, height, path: path.map((p) => [p.x, p.y, p.z] as const), ...wired(brush) };
}

/**
 * Levelling along a stroke at the height it starts on: the column over the
 * stroke's plan filled up to that level and cut down to it, `reach` above
 * and below and no further -- never up to a cave's ceiling -- by the brush's
 * strength, fading by its falloff.
 */
export function levelShapes(points: readonly ConstructionPosition[], radius: number, reach: number, brush: TerrainBrush = {}): readonly ConstructionVolumeShape[] {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length === 0) return [];
  const level = path[0]!.y;
  const flat = path.map((p) => [p.x, level, p.z] as const);
  return [
    { effect: "fill", radius, path: flat, column: { low: level - reach, high: level }, ...wired(brush) },
    { effect: "carve", radius, path: flat, column: { low: level, high: level + reach }, ...wired(brush) },
  ];
}

/** The ground along a stroke drawn toward its mean height round each point, read over `filter` of the radius. */
export function smoothShape(points: readonly ConstructionPosition[], radius: number, filter: number, brush: TerrainBrush = {}): ConstructionVolumeShape | undefined {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length === 0) return undefined;
  return { effect: "smooth", radius, height: 0, filter, path: path.map((p) => [p.x, p.y, p.z] as const), ...wired(brush) };
}

/** Perlin noise `height` high laid on the ground along a stroke, a wave every `scale` metres. */
export function noiseShape(points: readonly ConstructionPosition[], radius: number, height: number, scale: number, seed: number, brush: TerrainBrush = {}): ConstructionVolumeShape | undefined {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length === 0) return undefined;
  return { effect: "noise", radius, height, noiseScale: scale, seed, path: path.map((p) => [p.x, p.y, p.z] as const), ...wired(brush) };
}
