import { RECTANGLE_OPENING_SHAPE, type OpeningShape, type OpeningSide } from "./tool-types.ts";

/**
 * An opening's outline inside its bounding box, in world meters: `x` along
 * the wall from the box's left edge, `y` up from its bottom edge. Pure, so
 * the tool, its preview and the tests all draw the same polygon.
 *
 * A rounded side is the arc of a circle through that side's midpoint whose
 * chord ends sit on the two neighbouring sides. Each side then bounds a
 * convex region of the box, and the outline is their intersection -- convex,
 * so it can never cross itself, and every arc keeps its apex on the box
 * edge, so the pins' bounding box is always the opening's own rectangle.
 */

export type OutlinePoint = readonly [number, number];

export const OPENING_SHAPE_PROP = "openingShape";

const SIDES: readonly OpeningSide[] = ["top", "right", "bottom", "left"];
const MAX_ARC_STEP = Math.PI / 24;
const ELLIPSE_SEGMENTS = 48;
const EPS = 1e-9;

const RECTANGLE_SHAPE = RECTANGLE_OPENING_SHAPE;

export function isRectangleShape(shape: OpeningShape | undefined): boolean {
  return shape === undefined || (!shape.ellipse && SIDES.every((side) => !(shape.radii[side] > 0)));
}

/** The side's length and the box extent across it. */
function sideSpan(side: OpeningSide, width: number, height: number): { readonly length: number; readonly across: number } {
  return side === "top" || side === "bottom" ? { length: width, across: height } : { length: height, across: width };
}

/**
 * How far a side's arc rises from its chord, and the radius that rise
 * means. A radius under half the side is raised to half (a semicircle); the
 * rise is capped at half the box across the side, so opposite arcs never
 * meet and every apex stays on the box.
 */
export function sideArc(radius: number, length: number, across: number): { readonly rise: number; readonly radius: number } | undefined {
  if (!(radius > 0) || !(length > EPS) || !(across > EPS)) return undefined;
  const half = length / 2;
  const r = Math.max(radius, half);
  let rise = r - Math.sqrt(Math.max(0, r * r - half * half));
  const maxRise = across / 2;
  if (rise <= maxRise) return rise > EPS ? { rise, radius: r } : undefined;
  rise = maxRise;
  return { rise, radius: (rise * rise + half * half) / (2 * rise) };
}

/** The largest radius a side still changes: beyond it the arc is flatter than a millimetre. */
export function maxUsefulRadius(length: number): number {
  const half = length / 2;
  return (0.001 * 0.001 + half * half) / (2 * 0.001);
}

/** The box's corners counter-clockwise from bottom-left, with the side that leaves each corner. */
function boxCorners(width: number, height: number): readonly { readonly at: OutlinePoint; readonly side: OpeningSide; readonly normal: OutlinePoint }[] {
  return [
    { at: [0, 0], side: "bottom", normal: [0, -1] },
    { at: [width, 0], side: "right", normal: [1, 0] },
    { at: [width, height], side: "top", normal: [0, 1] },
    { at: [0, height], side: "left", normal: [-1, 0] },
  ];
}

function arcSideRegion(width: number, height: number, side: OpeningSide, arc: { readonly rise: number; readonly radius: number }): OutlinePoint[] {
  const corners = boxCorners(width, height);
  const out: OutlinePoint[] = [];
  corners.forEach((corner, index) => {
    if (corner.side !== side) {
      // The corner that closes the rounded side is cut off with it.
      if (corners[(index + corners.length - 1) % corners.length]!.side !== side) out.push(corner.at);
      return;
    }
    const [px, py] = corner.at;
    const [qx, qy] = corners[(index + 1) % corners.length]!.at;
    const [nx, ny] = corner.normal;
    const length = Math.hypot(qx - px, qy - py);
    const dx = (qx - px) / length;
    const dy = (qy - py) / length;
    const cx = (px + qx) / 2 - nx * arc.radius;
    const cy = (py + qy) / 2 - ny * arc.radius;
    const alpha = Math.asin(Math.min(1, length / 2 / arc.radius));
    const segments = 2 * Math.max(1, Math.ceil(alpha / MAX_ARC_STEP));
    for (let step = 0; step <= segments; step += 1) {
      const t = -alpha + (2 * alpha * step) / segments;
      out.push([cx + arc.radius * (nx * Math.cos(t) + dx * Math.sin(t)), cy + arc.radius * (ny * Math.cos(t) + dy * Math.sin(t))]);
    }
  });
  return out;
}

const cross = (a: OutlinePoint, b: OutlinePoint, p: OutlinePoint): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

/** Sutherland-Hodgman: `subject` clipped to the convex, counter-clockwise `clip`. */
export function clipToConvex(subject: readonly OutlinePoint[], clip: readonly OutlinePoint[]): OutlinePoint[] {
  let out: OutlinePoint[] = [...subject];
  for (let index = 0; index < clip.length && out.length > 0; index += 1) {
    const a = clip[index]!;
    const b = clip[(index + 1) % clip.length]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < EPS) continue;
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k += 1) {
      const p = input[k]!;
      const q = input[(k + 1) % input.length]!;
      const dp = cross(a, b, p);
      const dq = cross(a, b, q);
      if (dp >= -EPS) out.push(p);
      if ((dp >= -EPS) !== (dq >= -EPS)) {
        const t = dp / (dp - dq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

/** Drops repeated points and points on a straight line between their neighbours. */
export function simplifyLoop(loop: readonly OutlinePoint[], tolerance = 1e-7): OutlinePoint[] {
  let out = loop.filter((point, index) => {
    const next = loop[(index + 1) % loop.length]!;
    return Math.hypot(next[0] - point[0], next[1] - point[1]) > tolerance;
  });
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let index = 0; index < out.length; index += 1) {
      const prev = out[(index + out.length - 1) % out.length]!;
      const point = out[index]!;
      const next = out[(index + 1) % out.length]!;
      const span = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
      if (span > 0 && Math.abs(cross(prev, next, point)) / span <= tolerance) {
        out = out.filter((_, k) => k !== index);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Rotated to start at the lowest, then leftmost, point -- a rectangle starts at its bottom-left corner. */
function startBottomLeft(loop: readonly OutlinePoint[]): OutlinePoint[] {
  let first = 0;
  loop.forEach((point, index) => {
    const best = loop[first]!;
    if (point[1] < best[1] - 1e-9 || (Math.abs(point[1] - best[1]) <= 1e-9 && point[0] < best[0])) first = index;
  });
  return [...loop.slice(first), ...loop.slice(0, first)];
}

/** The outline of a `width` x `height` box with `shape`, counter-clockwise from its bottom-left. */
export function openingOutline(shape: OpeningShape | undefined, width: number, height: number): OutlinePoint[] {
  if (shape?.ellipse) {
    return startBottomLeft(
      Array.from({ length: ELLIPSE_SEGMENTS }, (_, index) => {
        const t = -Math.PI / 2 + (2 * Math.PI * index) / ELLIPSE_SEGMENTS;
        return [(width / 2) * (1 + Math.cos(t)), (height / 2) * (1 + Math.sin(t))] as const;
      }),
    );
  }
  let outline: OutlinePoint[] = boxCorners(width, height).map((corner) => corner.at);
  for (const side of SIDES) {
    const { length, across } = sideSpan(side, width, height);
    const arc = sideArc(shape?.radii[side] ?? 0, length, across);
    if (arc !== undefined) outline = clipToConvex(outline, arcSideRegion(width, height, side, arc));
  }
  return startBottomLeft(simplifyLoop(outline));
}

/** The shape stored in a region's property bag; a missing or malformed entry is a rectangle. */
export function shapeFromProps(props: Readonly<Record<string, unknown>> | undefined): OpeningShape {
  const raw = props?.[OPENING_SHAPE_PROP];
  if (raw === null || typeof raw !== "object") return RECTANGLE_SHAPE;
  const entry = raw as { readonly ellipse?: unknown; readonly radii?: Record<string, unknown> };
  const radius = (side: OpeningSide) => {
    const value = entry.radii?.[side];
    return typeof value === "number" && value > 0 ? value : 0;
  };
  return { ellipse: entry.ellipse === true, radii: { top: radius("top"), right: radius("right"), bottom: radius("bottom"), left: radius("left") } };
}

/** The property bag an opening with `shape` stores; `null` for a rectangle, which stores nothing. */
export function propsForShape(shape: OpeningShape | undefined): Record<string, unknown> | null {
  if (shape === undefined || isRectangleShape(shape)) return null;
  return { [OPENING_SHAPE_PROP]: { ellipse: shape.ellipse, radii: { ...shape.radii } } };
}

export function sameShape(a: OpeningShape | undefined, b: OpeningShape | undefined): boolean {
  const left = a ?? RECTANGLE_SHAPE;
  const right = b ?? RECTANGLE_SHAPE;
  if (isRectangleShape(left) && isRectangleShape(right)) return true;
  if (left.ellipse || right.ellipse) return left.ellipse === right.ellipse;
  return SIDES.every((side) => Math.abs((left.radii[side] ?? 0) - (right.radii[side] ?? 0)) < 1e-9);
}
