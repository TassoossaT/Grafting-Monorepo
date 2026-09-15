import type { ConstructionEdgeGeometry, ConstructionPosition } from "@/ports";

/**
 * The one place any `ConstructionEdgeGeometry` (line, arc, or bezier) is
 * turned into "where is this edge at parameter/travel X" -- angle math,
 * cubic evaluation, and arc-length walking, each written once.
 *
 * Before this module existed, `stroke-fitting.ts` (fitting a stroke),
 * `panel-rail.ts` (reading an upright panel back to place an opening), and
 * `platform-contour-merge.ts` (welding a stroke onto a platform's own
 * contour) each carried their own copy of `angleAround`/sweep-angle math,
 * with their own sign conventions to keep in sync by hand. Only one of the
 * three ever grew a Bezier case, which is exactly the trap centralizing
 * this closes: a caller reaching for "how far along this edge is this
 * point" now gets every geometry kind for free, instead of silently falling
 * back to treating a curved edge as its own straight chord.
 */

const TAU = Math.PI * 2;

function wrapPositive(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

/** Angle of `(x, z)` around `center`, in the graph's own XZ convention (`atan2(z, x)`). */
export function angleAround(center: readonly [number, number], x: number, z: number): number {
  return Math.atan2(z - center[1], x - center[0]);
}

/**
 * The signed angle actually swept walking from angle `from` to angle `to`
 * in the direction `clockwise` says, magnitude always in `[0, 2*PI)`.
 * Positive/counter-clockwise unless `clockwise` is set.
 */
export function arcSweep(from: number, to: number, clockwise: boolean): number {
  return clockwise ? -wrapPositive(from - to) : wrapPositive(to - from);
}

/** XZ position on the cubic Bezier `start -> handle1 -> handle2 -> end` at parameter `t`. */
export function bezierPointXz(
  start: ConstructionPosition,
  handle1: readonly [number, number],
  handle2: readonly [number, number],
  end: ConstructionPosition,
  t: number,
): readonly [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * start.x + b * handle1[0] + c * handle2[0] + d * end.x, a * start.z + b * handle1[1] + c * handle2[1] + d * end.z];
}

/**
 * `geometry` walked from `start` to `end`, at parameter `t` in `[0, 1]` --
 * the one place every edge kind is evaluated for a flat overlay/preview
 * polyline. Height is linear between the two endpoints for every kind: none
 * of them carries its own vertical shape independent of its ends (that is
 * exactly what the mesh's own ribbon/upright sampling is for).
 */
export function positionAlongEdge(
  geometry: ConstructionEdgeGeometry,
  start: ConstructionPosition,
  end: ConstructionPosition,
  t: number,
): ConstructionPosition {
  const y = start.y + (end.y - start.y) * t;
  if (geometry.kind === "line") {
    return { x: start.x + (end.x - start.x) * t, y, z: start.z + (end.z - start.z) * t };
  }
  if (geometry.kind === "arc") {
    const { center, clockwise } = geometry;
    const radius = Math.hypot(start.x - center[0], start.z - center[1]);
    const startAngle = angleAround(center, start.x, start.z);
    const endAngle = angleAround(center, end.x, end.z);
    const rawSweep = arcSweep(startAngle, endAngle, clockwise);
    const sweep = Math.abs(rawSweep) < 1e-9 ? (clockwise ? -TAU : TAU) : rawSweep;
    const angle = startAngle + sweep * t;
    return { x: center[0] + radius * Math.cos(angle), y, z: center[1] + radius * Math.sin(angle) };
  }
  const [x, z] = bezierPointXz(start, geometry.handle1, geometry.handle2, end, t);
  return { x, y, z };
}

/** An edge's own flattened XZ frame: how far along it a point is, and where a given distance sits. */
export interface EdgeFrame {
  /** Total run in world units. */
  readonly length: number;
  /** Distance along the edge (clamped to `[0, length]`) closest to `(x, z)`. */
  travelTo(x: number, z: number): number;
  /** XZ position at `travel` (clamped to `[0, length]`). */
  positionAt(travel: number): readonly [number, number];
  /** The edge's own parameter `t` in `[0, 1]` at `travel` -- uniform for a line or arc, sampled for a Bezier. */
  parameterAt(travel: number): number;
}

function chordFrame(start: ConstructionPosition, end: ConstructionPosition): EdgeFrame {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 1e-9)) {
    return { length: 0, travelTo: () => 0, positionAt: () => [start.x, start.z], parameterAt: () => 0 };
  }
  const ux = dx / length;
  const uz = dz / length;
  return {
    length,
    travelTo(x, z) {
      const t = (x - start.x) * ux + (z - start.z) * uz;
      return Math.min(Math.max(t, 0), length);
    },
    positionAt(travel) {
      const clamped = Math.min(Math.max(travel, 0), length);
      return [start.x + ux * clamped, start.z + uz * clamped];
    },
    parameterAt(travel) {
      return Math.min(Math.max(travel, 0), length) / length;
    },
  };
}

function arcFrame(
  geometry: { readonly center: readonly [number, number]; readonly clockwise: boolean },
  start: ConstructionPosition,
  end: ConstructionPosition,
): EdgeFrame | undefined {
  const { center, clockwise } = geometry;
  const radius = Math.hypot(start.x - center[0], start.z - center[1]);
  if (!(radius > 1e-6)) return undefined;
  const startAngle = angleAround(center, start.x, start.z);
  const endAngle = angleAround(center, end.x, end.z);
  const rawSweep = arcSweep(startAngle, endAngle, clockwise);
  const sweep = Math.abs(rawSweep) < 1e-9 ? (clockwise ? -TAU : TAU) : rawSweep;
  const length = radius * Math.abs(sweep);
  return {
    length,
    travelTo(x, z) {
      const angle = angleAround(center, x, z);
      const swept = arcSweep(startAngle, angle, clockwise);
      return Math.min(Math.max(radius * swept, 0), length);
    },
    positionAt(travel) {
      const clamped = Math.min(Math.max(travel, 0), length);
      const swept = clamped / radius;
      const angle = startAngle + (clockwise ? -swept : swept);
      return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    },
    parameterAt(travel) {
      return Math.min(Math.max(travel, 0), length) / length;
    },
  };
}

/** How many samples a Bezier edge's frame walks arc length with -- generous for both the opening tool's placement and the overlay's own polyline. */
const BEZIER_FRAME_SAMPLES = 64;

function bezierFrame(
  geometry: { readonly handle1: readonly [number, number]; readonly handle2: readonly [number, number] },
  start: ConstructionPosition,
  end: ConstructionPosition,
): EdgeFrame {
  const samples: { readonly x: number; readonly z: number; readonly t: number; readonly cumulative: number }[] = [
    { x: start.x, z: start.z, t: 0, cumulative: 0 },
  ];
  let cumulative = 0;
  let previous: readonly [number, number] = [start.x, start.z];
  for (let index = 1; index <= BEZIER_FRAME_SAMPLES; index += 1) {
    const t = index / BEZIER_FRAME_SAMPLES;
    const point = bezierPointXz(start, geometry.handle1, geometry.handle2, end, t);
    cumulative += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    samples.push({ x: point[0], z: point[1], t, cumulative });
    previous = point;
  }
  const length = cumulative;

  function segmentAt(travel: number): { readonly a: (typeof samples)[number]; readonly b: (typeof samples)[number] } {
    let index = 1;
    while (index < samples.length - 1 && samples[index]!.cumulative < travel) index += 1;
    return { a: samples[index - 1]!, b: samples[index]! };
  }

  return {
    length,
    travelTo(x, z) {
      let best = 0;
      let bestDistanceSq = Infinity;
      for (let index = 1; index < samples.length; index += 1) {
        const a = samples[index - 1]!;
        const b = samples[index]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const segmentLengthSq = dx * dx + dz * dz;
        const local = segmentLengthSq < 1e-12 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / segmentLengthSq));
        const px = a.x + dx * local;
        const pz = a.z + dz * local;
        const distanceSq = (x - px) * (x - px) + (z - pz) * (z - pz);
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          best = a.cumulative + local * (b.cumulative - a.cumulative);
        }
      }
      return Math.min(Math.max(best, 0), length);
    },
    positionAt(travel) {
      const clamped = Math.min(Math.max(travel, 0), length);
      const { a, b } = segmentAt(clamped);
      const span = b.cumulative - a.cumulative;
      const local = span < 1e-9 ? 0 : (clamped - a.cumulative) / span;
      return [a.x + (b.x - a.x) * local, a.z + (b.z - a.z) * local];
    },
    parameterAt(travel) {
      const clamped = Math.min(Math.max(travel, 0), length);
      const { a, b } = segmentAt(clamped);
      const span = b.cumulative - a.cumulative;
      const local = span < 1e-9 ? 0 : (clamped - a.cumulative) / span;
      return a.t + (b.t - a.t) * local;
    },
  };
}

/**
 * A parametrized XZ frame for `geometry` walked `start -> end`, whatever
 * shape it is. This is the generic answer to "how far along this edge is
 * this point" and "where is this edge at this distance" that a straight
 * chord and a circular arc already had closed-form answers for -- a Bezier
 * edge gets the same two questions answered here too, via arc-length
 * sampling, instead of a caller falling back to treating it as a chord.
 */
export function edgeFrame(geometry: ConstructionEdgeGeometry, start: ConstructionPosition, end: ConstructionPosition): EdgeFrame {
  if (geometry.kind === "arc") return arcFrame(geometry, start, end) ?? chordFrame(start, end);
  if (geometry.kind === "bezier") return bezierFrame(geometry, start, end);
  return chordFrame(start, end);
}

function lerpXz(a: readonly [number, number], b: readonly [number, number], t: number): readonly [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** De Casteljau split of cubic `p0 p1 p2 p3` at `t`: the two halves' own control points, both still exact cubics of the same curve. */
function splitCubic(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  t: number,
): {
  readonly left: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
  readonly right: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
} {
  const a = lerpXz(p0, p1, t);
  const b = lerpXz(p1, p2, t);
  const c = lerpXz(p2, p3, t);
  const d = lerpXz(a, b, t);
  const e = lerpXz(b, c, t);
  const f = lerpXz(d, e, t);
  return { left: [p0, a, d, f], right: [f, e, c, p3] };
}

/**
 * The exact sub-curve of `geometry` between its own parameters `t0` and
 * `t1` (`0 <= t0 < t1 <= 1`), as its own declarable geometry.
 *
 * A line or an arc need no work: a chord is a chord end to end, and any two
 * points on a circle bound an arc of that *same* circle, so the center and
 * direction alone already describe every sub-span. A Bezier's off-curve
 * handles are anchored to its own original endpoints, though, so reusing
 * them for a shorter span between two different points traces the wrong
 * curve entirely -- this is what an opening stamped onto a curved wall
 * needs to place its own rim edge correctly, via two de Casteljau splits
 * (isolate `[t0, 1]`, then take `[0, t1']` of that in its own local
 * parameter) instead of borrowing the whole rail's handles unchanged.
 */
export function subGeometry(
  geometry: ConstructionEdgeGeometry,
  start: ConstructionPosition,
  end: ConstructionPosition,
  t0: number,
  t1: number,
): ConstructionEdgeGeometry {
  if (geometry.kind !== "bezier") return geometry;
  if (!(t1 > t0) || t0 < 0 || t1 > 1) return geometry;
  const p0: readonly [number, number] = [start.x, start.z];
  const p3: readonly [number, number] = [end.x, end.z];
  const afterT0 = t0 <= 1e-9 ? { left: [p0, geometry.handle1, geometry.handle2, p3], right: [p0, geometry.handle1, geometry.handle2, p3] } : splitCubic(p0, geometry.handle1, geometry.handle2, p3, t0);
  const [q0, q1, q2, q3] = afterT0.right;
  const localT1 = t0 <= 1e-9 ? t1 : (t1 - t0) / (1 - t0);
  if (localT1 >= 1 - 1e-9) return { kind: "bezier", handle1: q1, handle2: q2 };
  const { left } = splitCubic(q0, q1, q2, q3, localT1);
  return { kind: "bezier", handle1: left[1], handle2: left[2] };
}
