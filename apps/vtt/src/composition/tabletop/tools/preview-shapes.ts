import type { PreviewDescriptor } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

/** A filled square ghost centered on `center`, `halfExtent` out on both X and Z -- a hover cursor or stamp footprint. */
export function quadAround(
  center: ConstructionPosition,
  halfExtent: number,
  color: number,
  opacity = 0.35,
): PreviewDescriptor {
  const y = center.y;
  return {
    kind: "quad",
    color,
    opacity,
    positions: Float32Array.from([
      center.x - halfExtent, y, center.z - halfExtent,
      center.x + halfExtent, y, center.z - halfExtent,
      center.x + halfExtent, y, center.z + halfExtent,
      center.x - halfExtent, y, center.z + halfExtent,
    ]),
  };
}

/** An open line ghost from `start` to `end` -- a wall-brush's centerline while dragging. */
export function segmentBetween(
  start: ConstructionPosition,
  end: ConstructionPosition,
  color: number,
  opacity = 0.7,
): PreviewDescriptor {
  return {
    kind: "segments",
    color,
    opacity,
    positions: Float32Array.from([start.x, start.y, start.z, end.x, end.y, end.z]),
  };
}

/** A filled ghost over an arbitrary rectangular footprint (not necessarily axis-aligned to `center`) -- a stamped footprint's proposed outline. */
export function footprintQuad(
  corners: readonly [ConstructionPosition, ConstructionPosition, ConstructionPosition, ConstructionPosition],
  color: number,
  opacity = 0.3,
): PreviewDescriptor {
  const positions = new Float32Array(12);
  corners.forEach((corner, index) => {
    positions[index * 3] = corner.x;
    positions[index * 3 + 1] = corner.y;
    positions[index * 3 + 2] = corner.z;
  });
  return { kind: "quad", color, opacity, positions };
}

export type BrushOutlineShape =
  | { readonly kind: "circle"; readonly radius: number }
  | { readonly kind: "square"; readonly radius: number; readonly rotationRadians: number }
  | { readonly kind: "hexagon"; readonly radius: number; readonly rotationRadians: number };

/** Preview-only outline for any convex brush shape supported by the Rust contract. */
export function brushStrokeOutline(
  samples: readonly ConstructionPosition[],
  shape: BrushOutlineShape,
  color: number,
  opacity = 0.7,
): PreviewDescriptor {
  if (shape.kind === "circle") return circularBrushStrokeOutline(samples, shape.radius, color, opacity);
  const positions: number[] = [];
  if (samples.length === 0) return { kind: "segments", color, opacity, positions: new Float32Array() };
  const sides = shape.kind === "square" ? 4 : 6;
  const polygonRadius = shape.kind === "square" ? shape.radius * Math.SQRT2 : shape.radius;
  const startAngle = shape.rotationRadians + (shape.kind === "square" ? Math.PI / 4 : 0);
  const stride = Math.max(1, Math.ceil(samples.length / 24));
  const selected = samples.filter((_, index) => index === 0 || index === samples.length - 1 || index % stride === 0);
  for (const center of selected) {
    for (let side = 0; side < sides; side += 1) {
      const from = startAngle + (Math.PI * 2 * side) / sides;
      const to = startAngle + (Math.PI * 2 * (side + 1)) / sides;
      positions.push(
        center.x + polygonRadius * Math.cos(from), center.y + 0.03, center.z + polygonRadius * Math.sin(from),
        center.x + polygonRadius * Math.cos(to), center.y + 0.03, center.z + polygonRadius * Math.sin(to),
      );
    }
  }
  for (let index = 1; index < samples.length; index += 1) {
    const start = samples[index - 1];
    const end = samples[index];
    positions.push(start.x, start.y + 0.03, start.z, end.x, end.y + 0.03, end.z);
  }
  return { kind: "segments", color, opacity, positions: Float32Array.from(positions) };
}
interface HullPoint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

/** 2D convex hull (XZ plane, Andrew's monotone chain), carrying `y` along with each surviving point. Collinear/duplicate points are dropped, not just tolerated -- that's what keeps every downstream step (a fan from the centroid) provably non-self-intersecting. */
function convexHullXZ(points: readonly ConstructionPosition[]): HullPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: HullPoint, a: HullPoint, b: HullPoint): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

  const lower: HullPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: HullPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * A filled highlight of the whole area a brush of `shape` sweeps along
 * `samples`, start to end -- purely "this is the region that's about to be
 * affected," with no relation to whatever geometry a later backend call
 * actually produces for it. Every shape (circle/square/hexagon) is filled as
 * a rounded capsule of `shape.radius`, ignoring corners/rotation -- exact
 * enough to read as "this area," not a stand-in for the real result. Used as
 * every brush's default preview; a tool with a real result preview (e.g.
 * path-brush's analytic mesh) replaces it, this is only the fallback/ghost.
 *
 * The render port draws this with depth-testing off (a ghost must never be
 * occluded), so any self-overlap in the mesh double-blends the translucent
 * fill and reads as darker little blocks -- worse the more pointer samples
 * there are. A ribbon built segment-by-segment self-intersects on the inside
 * of any turn tighter than `shape.radius`, which an ordinary hand-drawn
 * stroke hits often. So instead this takes the convex hull of `samples` and
 * expands it outward by `radius` (rounding each hull corner with an arc,
 * i.e. a Minkowski sum with a disc) -- a convex shape, fan-triangulated from
 * its own centroid, which by construction can never self-intersect. The
 * trade-off is coverage, not overlap: a sharply concave stroke (a tight
 * hook, a near-closed loop) reads as its own convex envelope, slightly wider
 * than the literal swept path -- deliberate, since "not exact but never
 * doubles up" is what actually reads as "one continuous brush," which a
 * mathematically exact but self-intersecting ribbon does not.
 */
export function brushSweptRegionFill(
  samples: readonly ConstructionPosition[],
  shape: BrushOutlineShape,
  color: number,
  opacity = 0.3,
): PreviewDescriptor {
  const first = samples[0];
  if (first === undefined) return { kind: "mesh", color, opacity, positions: new Float32Array(), indices: new Uint16Array() };

  const radius = shape.radius;
  const positions: number[] = [];
  const indices: number[] = [];

  const addDisc = (center: HullPoint) => {
    const y = center.y + 0.03;
    const base = positions.length / 3;
    positions.push(center.x, y, center.z);
    const segments = 24;
    for (let index = 0; index <= segments; index += 1) {
      const angle = (Math.PI * 2 * index) / segments;
      positions.push(center.x + radius * Math.cos(angle), y, center.z + radius * Math.sin(angle));
    }
    for (let index = 1; index <= segments; index += 1) indices.push(base, base + index, base + index + 1);
  };

  const hull = convexHullXZ(samples);
  if (hull.length <= 1) {
    addDisc(hull[0] ?? first);
    return {
      kind: "mesh",
      color,
      opacity,
      positions: Float32Array.from(positions),
      indices: Uint16Array.from(indices),
    };
  }

  const outwardNormal = (from: HullPoint, to: HullPoint): { readonly x: number; readonly z: number } => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz) || 1;
    // Rotating a CCW polygon's edge direction by -90 deg points outward -- `convexHullXZ` always returns its points in CCW order.
    return { x: dz / length, z: -dx / length };
  };

  let centroidX = 0;
  let centroidZ = 0;
  let centroidY = 0;
  for (const point of hull) {
    centroidX += point.x;
    centroidZ += point.z;
    centroidY += point.y;
  }
  centroidX /= hull.length;
  centroidZ /= hull.length;
  centroidY /= hull.length;
  const centroid: HullPoint = { x: centroidX, y: centroidY, z: centroidZ };

  // One ring vertex per hull corner's rounding arc (plus the straight edges
  // implied by consecutive corners sharing that edge's outward normal),
  // walked in the same CCW order as the hull -- fan-triangulated from
  // `centroid` below, which stays interior because the whole ring is convex.
  const ring: HullPoint[] = [];
  const ringCount = hull.length;
  for (let index = 0; index < ringCount; index += 1) {
    const previous = hull[(index - 1 + ringCount) % ringCount];
    const current = hull[index];
    const next = hull[(index + 1) % ringCount];
    const normalIn = outwardNormal(previous, current);
    const normalOut = outwardNormal(current, next);

    let angleIn = Math.atan2(normalIn.z, normalIn.x);
    let angleOut = Math.atan2(normalOut.z, normalOut.x);
    while (angleOut < angleIn) angleOut += Math.PI * 2;

    const cornerSteps = Math.max(1, Math.ceil(((angleOut - angleIn) / Math.PI) * 8));
    for (let step = 0; step <= cornerSteps; step += 1) {
      const angle = angleIn + ((angleOut - angleIn) * step) / cornerSteps;
      ring.push({ x: current.x + radius * Math.cos(angle), y: current.y, z: current.z + radius * Math.sin(angle) });
    }
  }

  const centroidBase = positions.length / 3;
  positions.push(centroid.x, centroid.y + 0.03, centroid.z);
  const ringBase = positions.length / 3;
  for (const point of ring) positions.push(point.x, point.y + 0.03, point.z);
  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    indices.push(centroidBase, ringBase + index, ringBase + next);
  }

  return {
    kind: "mesh",
    color,
    opacity,
    positions: Float32Array.from(positions),
    indices: positions.length / 3 > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices),
  };
}

/** A renderer-neutral circular brush outline shared by terrain and surface transformations. */
export function circleOutline(
  center: ConstructionPosition,
  radius: number,
  color: number,
  opacity = 0.7,
): PreviewDescriptor {
  return circularBrushStrokeOutline([center], radius, color, opacity);
}

/**
 * Preview-only outline of the same circular brush swept over ordered samples.
 * Positions are explicit segment pairs because the render port's `segments`
 * primitive does not imply a line strip.
 */
export function circularBrushStrokeOutline(
  samples: readonly ConstructionPosition[],
  radius: number,
  color: number,
  opacity = 0.7,
): PreviewDescriptor {
  const positions: number[] = [];
  if (samples.length === 0) return { kind: "segments", color, opacity, positions: new Float32Array() };

  const appendCircle = (center: ConstructionPosition) => {
    const segments = 24;
    for (let index = 0; index < segments; index += 1) {
      const from = (Math.PI * 2 * index) / segments;
      const to = (Math.PI * 2 * (index + 1)) / segments;
      positions.push(
        center.x + radius * Math.cos(from), center.y + 0.03, center.z + radius * Math.sin(from),
        center.x + radius * Math.cos(to), center.y + 0.03, center.z + radius * Math.sin(to),
      );
    }
  };

  appendCircle(samples[0]);
  if (samples.length > 1) appendCircle(samples[samples.length - 1]);
  for (let index = 1; index < samples.length; index += 1) {
    const start = samples[index - 1];
    const end = samples[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length <= Number.EPSILON) continue;
    const offsetX = (-dz / length) * radius;
    const offsetZ = (dx / length) * radius;
    positions.push(
      start.x, start.y + 0.03, start.z, end.x, end.y + 0.03, end.z,
      start.x + offsetX, start.y + 0.03, start.z + offsetZ,
      end.x + offsetX, end.y + 0.03, end.z + offsetZ,
      start.x - offsetX, start.y + 0.03, start.z - offsetZ,
      end.x - offsetX, end.y + 0.03, end.z - offsetZ,
    );
  }
  return { kind: "segments", color, opacity, positions: Float32Array.from(positions) };
}