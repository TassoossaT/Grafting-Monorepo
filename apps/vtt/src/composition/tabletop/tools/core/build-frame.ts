import { hasTrait } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology } from "../../../../ports/index.ts";
import { pointerAtHeight } from "./pointer-ray.ts";
import type { PointerSample, ToolContext } from "./tool-context.ts";

/**
 * The directions something is built along -- never the world's fixed x and
 * z. Built on or next to a structure, it follows that structure's side, so
 * a turned platform is built on in its own turned directions; anywhere else
 * it follows the way the camera looks. Any tool that lays out square shapes
 * asks for one; what a frame is and where it comes from lives only here.
 */
export interface BuildFrame {
  /** Where the frame's grid is anchored: a corner of the structure it follows, or the world's origin. */
  readonly origin: ConstructionPosition;
  /** The frame's first direction in plan, unit length; `v` is square to it. */
  readonly u: { readonly x: number; readonly z: number };
  readonly v: { readonly x: number; readonly z: number };
  /** A point of a structure's side or corner `start` was drawn to, when it was near one -- the shape starts there, against it. */
  readonly start?: ConstructionPosition;
}

/** How near a side, in plan, a press counts as building next to it -- and lands on it. */
const SIDE_REACH = 0.6;
/** How near a corner a press starts at that corner exactly. */
const CORNER_REACH = 0.35;
/** The camera's heading is taken in steps of this much, so shapes drawn apart from each other still line up. */
const HEADING_STEP = Math.PI / 12;
const WORLD_UNIT = 1;

const frameAlong = (origin: ConstructionPosition, dx: number, dz: number, start?: ConstructionPosition): BuildFrame => {
  const length = Math.hypot(dx, dz) || 1;
  const u = { x: dx / length, z: dz / length };
  return { origin, u, v: { x: -u.z, z: u.x }, ...(start ? { start } : {}) };
};

/** The straight side of any built structure nearest `sample` within reach -- the one under the pointer first. */
function sideNear(ctx: ToolContext, sample: PointerSample): { readonly a: ConstructionPosition; readonly b: ConstructionPosition; readonly at: ConstructionPosition; readonly distance: number } | undefined {
  const built = ctx.runtime.getAllRegionTopologies().filter((topology) => !hasTrait(topology.surfaceType, "ground"));
  const under = sample.surfaceRef === undefined ? undefined : built.find((topology) => surfaceRefFromNodeSet(topology.surfaceKey) === sample.surfaceRef);
  let best: { a: ConstructionPosition; b: ConstructionPosition; at: ConstructionPosition; distance: number } | undefined;
  for (const topology of under ? [under] : built) {
    const positions = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const use of topology.outerLoops.flat()) {
      if (use.geometry.kind === "arc") continue;
      const a = positions.get(use.startNodeId)!, b = positions.get(use.endNodeId)!;
      const point = sample.ray ? pointerAtHeight(sample, (a.y + b.y) / 2) : sample.point;
      const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-9) continue;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq));
      const at = { x: a.x + dx * t, y: a.y + (b.y - a.y) * t, z: a.z + dz * t };
      const distance = Math.hypot(point.x - at.x, point.z - at.z);
      if ((!under && distance > SIDE_REACH) || (best && best.distance <= distance)) continue;
      best = { a, b, at, distance };
    }
  }
  return best;
}

/** The frame a shape begun at `sample` is built in. */
export function buildFrameAt(ctx: ToolContext, sample: PointerSample): BuildFrame {
  const side = sideNear(ctx, sample);
  if (side) {
    // Next to a side: start on it -- at its corner when that is near -- so the new shape is flush with it.
    const corner = [side.a, side.b].find((p) => Math.hypot(p.x - side.at.x, p.z - side.at.z) <= CORNER_REACH);
    const start = side.distance <= SIDE_REACH ? corner ?? side.at : undefined;
    return frameAlong(side.a, side.b.x - side.a.x, side.b.z - side.a.z, start);
  }
  const look = sample.forward ?? sample.ray?.direction;
  if (!look || Math.hypot(look.x, look.z) < 1e-6) return frameAlong({ x: 0, y: 0, z: 0 }, 1, 0);
  const heading = Math.round(Math.atan2(look.z, look.x) / HEADING_STEP) * HEADING_STEP;
  return frameAlong({ x: 0, y: 0, z: 0 }, Math.cos(heading), Math.sin(heading));
}

/** `p` on the frame's grid, when the table snaps to one; unchanged otherwise. */
export function snappedInFrame(ctx: ToolContext, frame: BuildFrame, p: ConstructionPosition): ConstructionPosition {
  if (!ctx.snapToGrid) return p;
  const unit = ctx.gridUnit ?? WORLD_UNIT;
  const dx = p.x - frame.origin.x, dz = p.z - frame.origin.z;
  const along = Math.round((dx * frame.u.x + dz * frame.u.z) / unit) * unit;
  const across = Math.round((dx * frame.v.x + dz * frame.v.z) / unit) * unit;
  return { x: frame.origin.x + frame.u.x * along + frame.v.x * across, y: p.y, z: frame.origin.z + frame.u.z * along + frame.v.z * across };
}

/**
 * Where the pointer is on the level `y` a shape is drawn at -- its ray
 * crossing that level, not whatever surface the ray happened to hit first:
 * the ground below a raised floor, or the top of one standing in front.
 */
export function pointerOnLevel(sample: PointerSample, y: number): ConstructionPosition {
  return sample.ray ? pointerAtHeight(sample, y) : { ...sample.point, y };
}

/** Where a shape begun at `sample`, on the level `y`, starts: on the side it was drawn next to, else on the frame's grid. */
export function frameStart(ctx: ToolContext, frame: BuildFrame, sample: PointerSample, y: number = sample.point.y): ConstructionPosition {
  return frame.start ?? snappedInFrame(ctx, frame, pointerOnLevel(sample, y));
}

/** How near a built side, lying square across the frame, a shape's own side comes to before it lands on it. */
const LIMIT_REACH = 0.45;
/** How far from square to the frame a built side may lie and still be one to land on. */
const PARALLEL = 0.02;

/**
 * Where the built sides near the box from `a` to `b` lie, as distances from
 * `a` along each of the frame's directions: a side square across `u` is a
 * limit for how far the shape reaches along `u`, and likewise for `v`.
 */
function limitsNear(ctx: ToolContext, frame: BuildFrame, a: ConstructionPosition, b: ConstructionPosition): { readonly along: readonly number[]; readonly across: readonly number[] } {
  const along: number[] = [], across: number[] = [];
  const minX = Math.min(a.x, b.x) - 1, maxX = Math.max(a.x, b.x) + 1, minZ = Math.min(a.z, b.z) - 1, maxZ = Math.max(a.z, b.z) + 1;
  for (const topology of ctx.runtime.getAllRegionTopologies()) {
    if (hasTrait(topology.surfaceType, "ground")) continue;
    const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const use of [...topology.outerLoops, ...topology.holes].flat()) {
      if (use.geometry.kind === "arc") continue;
      const p = at.get(use.startNodeId)!, q = at.get(use.endNodeId)!;
      if (Math.max(p.x, q.x) < minX || Math.min(p.x, q.x) > maxX || Math.max(p.z, q.z) < minZ || Math.min(p.z, q.z) > maxZ) continue;
      const length = Math.hypot(q.x - p.x, q.z - p.z);
      if (length < 1e-6) continue;
      const d = { x: (q.x - p.x) / length, z: (q.z - p.z) / length };
      const offset = { x: p.x - a.x, z: p.z - a.z };
      // Square across u -- it runs along v -- so it limits how far along u; and the other way round.
      if (Math.abs(d.x * frame.u.x + d.z * frame.u.z) < PARALLEL) along.push(offset.x * frame.u.x + offset.z * frame.u.z);
      if (Math.abs(d.x * frame.v.x + d.z * frame.v.z) < PARALLEL) across.push(offset.x * frame.v.x + offset.z * frame.v.z);
    }
  }
  return { along, across };
}

/** `length` landed on the nearest limit within reach, else on the grid when the table snaps. */
function landed(ctx: ToolContext, length: number, limits: readonly number[]): number {
  let best: number | undefined;
  for (const limit of limits) if (Math.abs(limit - length) <= LIMIT_REACH && Math.abs(limit) > 1e-6 && (best === undefined || Math.abs(limit - length) < Math.abs(best - length))) best = limit;
  if (best !== undefined) return best;
  const unit = ctx.gridUnit ?? WORLD_UNIT;
  return ctx.snapToGrid ? Math.round(length / unit) * unit : length;
}

/**
 * The rectangle from `a` to the pointer's `b`, its sides along the frame:
 * the pointer gives the far corner. A far side that comes near a built side
 * lying the same way lands on it -- the shape is flush with what stands,
 * never a sliver over or short of it -- else its size along each direction
 * is whole grid steps when the table snaps. `undefined` when it has no area.
 */
export function frameRectangle(ctx: ToolContext, frame: BuildFrame, a: ConstructionPosition, b: ConstructionPosition, elevation: number): readonly ConstructionPosition[] | undefined {
  const dx = b.x - a.x, dz = b.z - a.z;
  const limits = limitsNear(ctx, frame, a, b);
  const along = landed(ctx, dx * frame.u.x + dz * frame.u.z, limits.along), across = landed(ctx, dx * frame.v.x + dz * frame.v.z, limits.across);
  if (Math.abs(along) < 1e-5 || Math.abs(across) < 1e-5) return undefined;
  const at = (s: number, t: number) => ({ x: a.x + frame.u.x * s + frame.v.x * t, y: elevation, z: a.z + frame.u.z * s + frame.v.z * t });
  return [at(0, 0), at(along, 0), at(along, across), at(0, across)];
}
