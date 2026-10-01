import { hasTrait, nearestOnSegment } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology } from "../../../../ports/index.ts";
import { pointerAtHeight } from "./pointer-ray.ts";
import { rulerOf } from "./ruler.ts";
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
}

/**
 * How near a side, on the screen, a press counts as building next to it: the
 * shape is then laid out along that side. Only which way it is laid out --
 * where it starts, against the side or a corner of it, is the ruler's.
 */
const SIDE_PIXELS = 60;
/** The same reach in metres, while the screen's scale is not known. */
const SIDE_FALLBACK = 0.6;
/** The camera's heading is taken in steps of this much, so shapes drawn apart from each other still line up. */
const HEADING_STEP = Math.PI / 12;

const frameAlong = (origin: ConstructionPosition, dx: number, dz: number): BuildFrame => {
  const length = Math.hypot(dx, dz) || 1;
  const u = { x: dx / length, z: dz / length };
  return { origin, u, v: { x: -u.z, z: u.x } };
};

/** The straight side of any built structure nearest `sample` within reach -- the one under the pointer first. */
function sideNear(ctx: ToolContext, sample: PointerSample): { readonly a: ConstructionPosition; readonly b: ConstructionPosition; readonly at: ConstructionPosition; readonly distance: number } | undefined {
  const built = ctx.runtime.getAllRegionTopologies().filter((topology) => !hasTrait(topology.surfaceType, "ground"));
  const under = sample.surfaceRef === undefined ? undefined : built.find((topology) => surfaceRefFromNodeSet(topology.surfaceKey) === sample.surfaceRef);
  const reach = rulerOf(ctx).reach(SIDE_PIXELS, SIDE_FALLBACK);
  let best: { a: ConstructionPosition; b: ConstructionPosition; at: ConstructionPosition; distance: number } | undefined;
  for (const topology of under ? [under] : built) {
    const positions = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const use of topology.outerLoops.flat()) {
      if (use.geometry.kind === "arc") continue;
      const a = positions.get(use.startNodeId)!, b = positions.get(use.endNodeId)!;
      // A hip or a rake climbs: only a level side is one to build along.
      if (Math.abs(a.y - b.y) > 1e-4) continue;
      const point = sample.ray ? pointerAtHeight(sample, (a.y + b.y) / 2) : sample.point;
      if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-4) continue;
      const nearest = nearestOnSegment(point, a, b);
      const at = { x: nearest.x, y: a.y + (b.y - a.y) * nearest.t, z: nearest.z };
      const distance = nearest.distance;
      if ((!under && distance > reach) || (best && best.distance <= distance)) continue;
      best = { a, b, at, distance };
    }
  }
  return best;
}

/** The frame a shape begun at `sample` is built in. */
export function buildFrameAt(ctx: ToolContext, sample: PointerSample): BuildFrame {
  const side = sideNear(ctx, sample);
  // Next to a side: laid out along it. Where it starts -- on the side, or at its corner -- is the ruler's catch, not this frame's.
  if (side) return frameAlong(side.a, side.b.x - side.a.x, side.b.z - side.a.z);
  const look = sample.forward ?? sample.ray?.direction;
  if (!look || Math.hypot(look.x, look.z) < 1e-6) return frameAlong({ x: 0, y: 0, z: 0 }, 1, 0);
  const heading = Math.round(Math.atan2(look.z, look.x) / HEADING_STEP) * HEADING_STEP;
  return frameAlong({ x: 0, y: 0, z: 0 }, Math.cos(heading), Math.sin(heading));
}

/** `p` ruled along the frame's own directions -- on a corner, a side, or in line with one -- when the ruler's snap is on; unchanged otherwise. */
export function snappedInFrame(ctx: ToolContext, frame: BuildFrame, p: ConstructionPosition): ConstructionPosition {
  return rulerOf(ctx).point(p, { axes: [frame.u, frame.v] });
}

/** Where the pointer is on the level `y` a shape is drawn at -- see {@link pointerAtHeight}. */
export function pointerOnLevel(sample: PointerSample, y: number): ConstructionPosition {
  return sample.ray ? pointerAtHeight(sample, y) : { ...sample.point, y };
}

/** Where a shape begun at `sample`, on the level `y`, starts: ruled along the frame -- on a side it was drawn next to, at a corner, or in line with one. */
export function frameStart(ctx: ToolContext, frame: BuildFrame, sample: PointerSample, y: number = sample.point.y): ConstructionPosition {
  return snappedInFrame(ctx, frame, pointerOnLevel(sample, y));
}

/**
 * The rectangle from `a` to the pointer's `b`, its sides along the frame:
 * the pointer gives the far corner, ruled along the frame like every other
 * point -- so a far side that comes near a built side lying the same way lands
 * on it, flush with what stands and never a sliver over or short of it, by the
 * same catch as anything else. `undefined` when it has no area.
 */
export function frameRectangle(ctx: ToolContext, frame: BuildFrame, a: ConstructionPosition, b: ConstructionPosition, elevation: number): readonly ConstructionPosition[] | undefined {
  const far = snappedInFrame(ctx, frame, b);
  const dx = far.x - a.x, dz = far.z - a.z;
  const along = dx * frame.u.x + dz * frame.u.z, across = dx * frame.v.x + dz * frame.v.z;
  if (Math.abs(along) < 1e-5 || Math.abs(across) < 1e-5) return undefined;
  const at = (s: number, t: number) => ({ x: a.x + frame.u.x * s + frame.v.x * t, y: elevation, z: a.z + frame.u.z * s + frame.v.z * t });
  return [at(0, 0), at(along, 0), at(along, across), at(0, across)];
}
