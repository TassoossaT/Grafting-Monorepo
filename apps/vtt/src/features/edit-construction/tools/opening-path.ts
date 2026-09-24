import { sideArc, type OutlinePoint } from "./opening-outline.ts";
import type { OpeningShape, OpeningSide } from "./tool-types.ts";

/**
 * An opening's outline as a closed path of straight and cubic segments: the
 * same shape `openingOutline` draws, but every rounded side is a few cubics
 * instead of a polyline, so a pinned opening needs one node per segment end
 * and nothing in between. Pure; `x` along the wall, `y` up, world meters.
 */

export interface OutlineSegment {
  readonly from: OutlinePoint;
  readonly to: OutlinePoint;
  /** The cubic's two off-curve control points; absent for a straight segment. */
  readonly controls?: readonly [OutlinePoint, OutlinePoint];
}

export type OutlinePath = readonly OutlineSegment[];

/** How far (world meters) a cubic may stray from the circle it stands for. */
export const ARC_TOLERANCE = 0.002;

const EPS = 1e-9;
const ERROR_SAMPLES = 16;
const MAX_ARC_CUBICS = 16;
const ROOT_SAMPLES = 32;

type Point = OutlinePoint;

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const gap = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The worst radial error of the standard cubic for a unit-circle arc of `sweep` radians. */
function unitArcError(sweep: number): number {
  const k = (4 / 3) * Math.tan(sweep / 4);
  const segment: OutlineSegment = {
    from: [1, 0],
    to: [Math.cos(sweep), Math.sin(sweep)],
    controls: [[1, k], [Math.cos(sweep) + k * Math.sin(sweep), Math.sin(sweep) - k * Math.cos(sweep)]],
  };
  let worst = 0;
  for (let step = 1; step < ERROR_SAMPLES; step += 1) {
    const [x, y] = pointAt(segment, step / ERROR_SAMPLES);
    worst = Math.max(worst, Math.abs(Math.hypot(x, y) - 1));
  }
  return worst;
}

/**
 * The arc of the axis-aligned ellipse at `center` from angle `start` through
 * `sweep` (counter-clockwise), as the fewest cubics that stay within
 * {@link ARC_TOLERANCE} of it. Its ends are exactly `from` and `to` when given.
 */
function ellipseArc(center: Point, rx: number, ry: number, start: number, sweep: number, from?: Point, to?: Point): OutlineSegment[] {
  const at = (angle: number): Point => [center[0] + rx * Math.cos(angle), center[1] + ry * Math.sin(angle)];
  const tangent = (angle: number): Point => [-rx * Math.sin(angle), ry * Math.cos(angle)];
  const scale = Math.max(rx, ry);
  let count = 1;
  while (count < MAX_ARC_CUBICS && unitArcError(sweep / count) * scale > ARC_TOLERANCE) count += 1;
  const step = sweep / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: OutlineSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    const a0 = start + step * index;
    const a1 = a0 + step;
    const p0 = index === 0 && from !== undefined ? from : at(a0);
    const p3 = index === count - 1 && to !== undefined ? to : at(a1);
    const t0 = tangent(a0);
    const t1 = tangent(a1);
    out.push({ from: p0, to: p3, controls: [[p0[0] + k * t0[0], p0[1] + k * t0[1]], [p3[0] - k * t1[0], p3[1] - k * t1[1]]] });
  }
  return out;
}

interface SideCircle {
  readonly center: Point;
  readonly radius: number;
  readonly rise: number;
}

/** The box sides counter-clockwise from the bottom; side `i` ends at corner `i`. */
const SIDE_ORDER: readonly OpeningSide[] = ["bottom", "right", "top", "left"];

function sideCircle(side: OpeningSide, width: number, height: number, radius: number): SideCircle | undefined {
  const horizontal = side === "top" || side === "bottom";
  const arc = sideArc(radius, horizontal ? width : height, horizontal ? height : width);
  if (arc === undefined) return undefined;
  const r = arc.radius;
  const center: Point =
    side === "bottom" ? [width / 2, r] : side === "top" ? [width / 2, height - r] : side === "right" ? [width - r, height / 2] : [r, height / 2];
  return { center, radius: r, rise: arc.rise };
}

const OUTWARD: Record<OpeningSide, Point> = { bottom: [0, -1], right: [1, 0], top: [0, 1], left: [-1, 0] };

function circleCrossing(a: SideCircle, b: SideCircle, near: Point): Point {
  const [x0, y0] = a.center;
  const [x1, y1] = b.center;
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < EPS) return near;
  const along = (a.radius * a.radius - b.radius * b.radius + d * d) / (2 * d);
  const across = Math.sqrt(Math.max(0, a.radius * a.radius - along * along));
  const mx = x0 + ((x1 - x0) * along) / d;
  const my = y0 + ((y1 - y0) * along) / d;
  const ox = (-(y1 - y0) * across) / d;
  const oy = ((x1 - x0) * across) / d;
  const first: Point = [mx + ox, my + oy];
  const second: Point = [mx - ox, my - oy];
  return gap(first, near) <= gap(second, near) ? first : second;
}

/** The outline of a `width` x `height` box with `shape` as a closed path, counter-clockwise from its lowest, leftmost point. */
export function openingPath(shape: OpeningShape | undefined, width: number, height: number): OutlineSegment[] {
  if (shape?.ellipse) {
    const center: Point = [width / 2, height / 2];
    return [0, 1, 2, 3].flatMap((quarter) => ellipseArc(center, width / 2, height / 2, -Math.PI / 2 + (quarter * Math.PI) / 2, Math.PI / 2));
  }
  const circles = SIDE_ORDER.map((side) => sideCircle(side, width, height, shape?.radii[side] ?? 0));
  const corners: Point[] = [[width, 0], [width, height], [0, height], [0, 0]];
  const vertices = SIDE_ORDER.map((side, index) => {
    const next = (index + 1) % SIDE_ORDER.length;
    const corner = corners[index]!;
    const here = circles[index];
    const there = circles[next];
    if (here !== undefined && there !== undefined) return circleCrossing(here, there, corner);
    if (here !== undefined) {
      const [nx, ny] = OUTWARD[side];
      return [corner[0] - nx * here.rise, corner[1] - ny * here.rise] as const;
    }
    if (there !== undefined) {
      const [nx, ny] = OUTWARD[SIDE_ORDER[next]!];
      return [corner[0] - nx * there.rise, corner[1] - ny * there.rise] as const;
    }
    return corner;
  });
  const out: OutlineSegment[] = [];
  SIDE_ORDER.forEach((_, index) => {
    const from = vertices[(index + SIDE_ORDER.length - 1) % SIDE_ORDER.length]!;
    const to = vertices[index]!;
    if (gap(from, to) < EPS) return;
    const circle = circles[index];
    if (circle === undefined) {
      out.push({ from, to });
      return;
    }
    const a0 = Math.atan2(from[1] - circle.center[1], from[0] - circle.center[0]);
    let sweep = Math.atan2(to[1] - circle.center[1], to[0] - circle.center[0]) - a0;
    while (sweep <= 0) sweep += 2 * Math.PI;
    // The apex is the side's midpoint, on the box. Cut there unless the arc is
    // symmetric about it, so no cubic can bulge past the box by its own error.
    const side = SIDE_ORDER[index]!;
    const [nx, ny] = OUTWARD[side];
    let toApex = Math.atan2(ny, nx) - a0;
    while (toApex < 0) toApex += 2 * Math.PI;
    if (toApex > EPS && toApex < sweep - EPS && Math.abs(toApex - sweep / 2) > 1e-9) {
      const apex: Point = [width / 2 + (nx * width) / 2, height / 2 + (ny * height) / 2];
      out.push(...ellipseArc(circle.center, circle.radius, circle.radius, a0, toApex, from, apex));
      out.push(...ellipseArc(circle.center, circle.radius, circle.radius, a0 + toApex, sweep - toApex, apex, to));
    } else {
      out.push(...ellipseArc(circle.center, circle.radius, circle.radius, a0, sweep, from, to));
    }
  });
  return startAtLowest(out);
}

/** The point at `t` along `segment`. */
export function pointAt(segment: OutlineSegment, t: number): Point {
  if (segment.controls === undefined) return lerp(segment.from, segment.to, t);
  const [c1, c2] = segment.controls;
  const s = 1 - t;
  const w0 = s * s * s, w1 = 3 * s * s * t, w2 = 3 * s * t * t, w3 = t * t * t;
  return [
    w0 * segment.from[0] + w1 * c1[0] + w2 * c2[0] + w3 * segment.to[0],
    w0 * segment.from[1] + w1 * c1[1] + w2 * c2[1] + w3 * segment.to[1],
  ];
}

/** `segment` cut in two at `t` (De Casteljau for a cubic). */
export function splitSegment(segment: OutlineSegment, t: number): readonly [OutlineSegment, OutlineSegment] {
  if (segment.controls === undefined) {
    const mid = lerp(segment.from, segment.to, t);
    return [{ from: segment.from, to: mid }, { from: mid, to: segment.to }];
  }
  const [c1, c2] = segment.controls;
  const a = lerp(segment.from, c1, t), b = lerp(c1, c2, t), c = lerp(c2, segment.to, t);
  const d = lerp(a, b, t), e = lerp(b, c, t);
  const mid = lerp(d, e, t);
  return [{ from: segment.from, to: mid, controls: [a, d] }, { from: mid, to: segment.to, controls: [e, c] }];
}

/** Every point of `path` mapped by `map`, which must be affine so a cubic stays that same cubic. */
export function mapPath(path: OutlinePath, map: (point: Point) => Point): OutlineSegment[] {
  return path.map((segment) =>
    segment.controls === undefined
      ? { from: map(segment.from), to: map(segment.to) }
      : { from: map(segment.from), to: map(segment.to), controls: [map(segment.controls[0]), map(segment.controls[1])] },
  );
}

/** `path` walked the other way. */
export function reversePath(path: OutlinePath): OutlineSegment[] {
  return [...path].reverse().map((segment) =>
    segment.controls === undefined
      ? { from: segment.to, to: segment.from }
      : { from: segment.to, to: segment.from, controls: [segment.controls[1], segment.controls[0]] },
  );
}

/** The parameters in `(0, 1)` where a cubic's axis coordinate equals `value`. */
function cubicRoots(segment: OutlineSegment, axis: 0 | 1, value: number): number[] {
  const f = (t: number) => pointAt(segment, t)[axis] - value;
  const roots: number[] = [];
  let t0 = 0;
  let f0 = f(0);
  for (let step = 1; step <= ROOT_SAMPLES; step += 1) {
    const t1 = step / ROOT_SAMPLES;
    const f1 = f(t1);
    if (f1 === 0 && t1 < 1) roots.push(t1);
    else if (f0 * f1 < 0) {
      let lo = t0, hi = t1, flo = f0;
      for (let k = 0; k < 60 && hi - lo > 1e-14; k += 1) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if (flo * fm <= 0) hi = mid;
        else {
          lo = mid;
          flo = fm;
        }
      }
      roots.push((lo + hi) / 2);
    }
    t0 = t1;
    f0 = f1;
  }
  return roots;
}

function crossings(segment: OutlineSegment, value: number): number[] {
  if (segment.controls !== undefined) return cubicRoots(segment, 0, value);
  const dx = segment.to[0] - segment.from[0];
  if (Math.abs(dx) < EPS) return [];
  const t = (value - segment.from[0]) / dx;
  return t > 0 && t < 1 ? [t] : [];
}

function splitAt(segment: OutlineSegment, ts: readonly number[]): OutlineSegment[] {
  const sorted = [...new Set(ts)].filter((t) => t > 1e-9 && t < 1 - 1e-9).sort((a, b) => a - b);
  const out: OutlineSegment[] = [];
  let rest = segment;
  let done = 0;
  for (const t of sorted) {
    const [head, tail] = splitSegment(rest, (t - done) / (1 - done));
    out.push(head);
    rest = tail;
    done = t;
  }
  out.push(rest);
  return out;
}

const isStraight = (segment: OutlineSegment): boolean => segment.controls === undefined;

/** Drops zero-length segments and welds consecutive collinear straight ones. */
function tidy(path: readonly OutlineSegment[]): OutlineSegment[] {
  const kept = path.filter((segment) => !isStraight(segment) || gap(segment.from, segment.to) > EPS);
  const out: OutlineSegment[] = [];
  for (const segment of kept) {
    const last = out[out.length - 1];
    if (last !== undefined && isStraight(last) && isStraight(segment)) {
      const ax = last.to[0] - last.from[0], ay = last.to[1] - last.from[1];
      const bx = segment.to[0] - segment.from[0], by = segment.to[1] - segment.from[1];
      if (Math.abs(ax * by - ay * bx) <= EPS * Math.hypot(ax, ay) * Math.hypot(bx, by) + EPS * EPS && ax * bx + ay * by > 0) {
        out[out.length - 1] = { from: last.from, to: segment.to };
        continue;
      }
    }
    out.push(segment);
  }
  if (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (isStraight(first) && isStraight(last)) {
      const ax = last.to[0] - last.from[0], ay = last.to[1] - last.from[1];
      const bx = first.to[0] - first.from[0], by = first.to[1] - first.from[1];
      if (Math.abs(ax * by - ay * bx) <= EPS * Math.hypot(ax, ay) * Math.hypot(bx, by) + EPS * EPS && ax * bx + ay * by > 0) {
        out.splice(out.length - 1, 1);
        out[0] = { from: last.from, to: first.to };
      }
    }
  }
  return out;
}

/**
 * The part of the convex, closed `path` between `x = x0` and `x = x1`: its
 * segments cut where they cross either line (cubics split, never
 * resampled), closed along the lines themselves by straight segments.
 */
export function clipPathToStrip(path: OutlinePath, x0: number, x1: number): OutlineSegment[] {
  const kept: OutlineSegment[] = [];
  for (const segment of path) {
    for (const part of splitAt(segment, [...crossings(segment, x0), ...crossings(segment, x1)])) {
      const [x] = pointAt(part, 0.5);
      if (x >= x0 - EPS && x <= x1 + EPS) kept.push(part);
    }
  }
  const out: OutlineSegment[] = [];
  kept.forEach((segment, index) => {
    out.push(segment);
    const next = kept[(index + 1) % kept.length]!;
    if (gap(segment.to, next.from) > EPS) out.push({ from: segment.to, to: next.from });
  });
  return tidy(out);
}

/** `path` rotated to start at its lowest, then leftmost, segment start. */
export function startAtLowest(path: readonly OutlineSegment[]): OutlineSegment[] {
  let first = 0;
  path.forEach((segment, index) => {
    const best = path[first]!.from;
    const [x, y] = segment.from;
    if (y < best[1] - 1e-9 || (Math.abs(y - best[1]) <= 1e-9 && x < best[0])) first = index;
  });
  return [...path.slice(first), ...path.slice(0, first)];
}

/** Where a segment reaches its extremes along either axis, ends included. */
export function segmentExtremes(segment: OutlineSegment): Point[] {
  const points: Point[] = [segment.from, segment.to];
  if (segment.controls === undefined) return points;
  const [c1, c2] = segment.controls;
  for (const axis of [0, 1] as const) {
    const p0 = segment.from[axis], p1 = c1[axis], p2 = c2[axis], p3 = segment.to[axis];
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    const ts: number[] = [];
    if (Math.abs(a) < 1e-14) {
      if (Math.abs(b) > 1e-14) ts.push(-c / b);
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const root = Math.sqrt(disc);
        ts.push((-b + root) / (2 * a), (-b - root) / (2 * a));
      }
    }
    for (const t of ts) if (t > 0 && t < 1) points.push(pointAt(segment, t));
  }
  return points;
}
