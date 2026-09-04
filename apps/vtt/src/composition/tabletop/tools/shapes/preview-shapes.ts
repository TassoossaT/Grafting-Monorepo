import earcut, { flatten as earcutFlatten } from "earcut";
import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Polygon } from "polygon-clipping";

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

/** Builds a PreviewDescriptor for a set of straight segment pairs (e.g. wall centerline ghost). */
export function segmentsPreview(
  positions: Float32Array | readonly number[],
  color: number,
  opacity = 0.7,
): PreviewDescriptor {
  return {
    kind: "segments",
    color,
    opacity,
    positions: positions instanceof Float32Array ? positions : Float32Array.from(positions),
  };
}

/** Builds an open polyline preview connecting consecutive points. */
export function polylineSegmentsPreview(
  points: readonly ConstructionPosition[],
  color: number,
  opacity = 0.7,
): PreviewDescriptor | undefined {
  if (points.length < 2) return undefined;
  const positions = new Float32Array((points.length - 1) * 6);
  let offset = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    positions[offset++] = a.x;
    positions[offset++] = a.y;
    positions[offset++] = a.z;
    positions[offset++] = b.x;
    positions[offset++] = b.y;
    positions[offset++] = b.z;
  }
  return { kind: "segments", color, opacity, positions };
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
/** The original sample nearest `(x, z)` -- used to carry a plausible terrain height onto a union outline point, which only ever exists in 2D. */
function nearestSampleY(x: number, z: number, samples: readonly ConstructionPosition[]): number {
  let bestY = samples[0]?.y ?? 0;
  let bestDistanceSq = Infinity;
  for (const sample of samples) {
    const dx = sample.x - x;
    const dz = sample.z - z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestY = sample.y;
    }
  }
  return bestY;
}

/** `samples` thinned to at least `minDistance` apart (XZ), always keeping the first and last point -- caps how many circles {@link brushSweptRegionFill} has to union without changing the swept shape (points closer than the brush radius add nothing a wider circle didn't already cover). */
function decimateXZ(samples: readonly ConstructionPosition[], minDistance: number): readonly ConstructionPosition[] {
  if (samples.length <= 2) return samples;
  const kept: ConstructionPosition[] = [samples[0]];
  for (let index = 1; index < samples.length - 1; index += 1) {
    const last = kept[kept.length - 1];
    const sample = samples[index];
    const dx = sample.x - last.x;
    const dz = sample.z - last.z;
    if (dx * dx + dz * dz >= minDistance * minDistance) kept.push(sample);
  }
  kept.push(samples[samples.length - 1]);
  return kept;
}

/** A closed circle ring (XZ), `sides`-gon, for one polygon-clipping `Polygon`. */
function circleRing(center: ConstructionPosition, radius: number, sides: number): [number, number][] {
  const ring: [number, number][] = [];
  for (let index = 0; index <= sides; index += 1) {
    const angle = (Math.PI * 2 * (index % sides)) / sides;
    ring.push([center.x + radius * Math.cos(angle), center.z + radius * Math.sin(angle)]);
  }
  return ring;
}

/**
 * A closed capsule ring (XZ) covering one segment `start` to `end` at
 * `radius` -- a rectangle with a rounded half-circle cap at each end
 * (the Minkowski sum of the segment with a disc). Always convex, so always
 * simple regardless of the brush radius or the segment's own length --
 * unlike a *chain* of these built by hand, one capsule alone can never
 * self-intersect. `brushSweptRegionFill` unions one of these per (decimated)
 * segment instead of a circle per sample, so the covered area is the whole
 * swept path, not just discs at the sample points with empty gaps between.
 */
function capsuleRing(start: ConstructionPosition, end: ConstructionPosition, radius: number, sides: number): [number, number][] {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length <= Number.EPSILON) return circleRing(start, radius, sides);

  const direction = Math.atan2(dz, dx);
  const capSteps = Math.max(2, Math.round(sides / 2));
  const ring: [number, number][] = [];
  for (let step = 0; step <= capSteps; step += 1) {
    const angle = direction - Math.PI / 2 + (Math.PI * step) / capSteps;
    ring.push([end.x + radius * Math.cos(angle), end.z + radius * Math.sin(angle)]);
  }
  for (let step = 0; step <= capSteps; step += 1) {
    const angle = direction + Math.PI / 2 + (Math.PI * step) / capSteps;
    ring.push([start.x + radius * Math.cos(angle), start.z + radius * Math.sin(angle)]);
  }
  return ring;
}

/**
 * A filled highlight of the whole area a brush of `shape` sweeps along
 * `samples`, start to end -- purely "this is the region that's about to be
 * affected," with no relation to whatever geometry a later backend call
 * actually produces for it. Every shape is filled as a rounded stroke of
 * `shape.radius`, ignoring corners/rotation -- exact enough to read as "this
 * area," not a stand-in for the real result. Used as every brush's default
 * preview; a tool with a real result preview (e.g. path-brush's analytic
 * mesh) replaces it, this is only the fallback/ghost.
 *
 * The render port draws this with depth-testing off (a ghost must never be
 * occluded), so any self-overlap in the mesh double-blends the translucent
 * fill and reads as darker little blocks -- and earcut, fed a self-
 * intersecting polygon, produces outright wrong triangles (crossing edges
 * connecting unrelated parts of the shape), not just a cosmetic artifact.
 * Both a hand-rolled offset-ribbon *and* `perfect-freehand`'s own stroke
 * outline self-intersect wherever the path curves tighter than the brush
 * radius -- ink-stroke tooling assumes a thin pen, not a fat brush, so nei-
 * ther guarantees a simple polygon here. What *is* guaranteed simple is a
 * proper 2D polygon union: the swept area is exactly the union of one
 * capsule per (decimated) segment, and `polygon-clipping` (the
 * Martinez-Rueda algorithm, also what turf.js uses) computes that union
 * robustly for any input, self-overlapping or not. `earcut` then
 * triangulates the union's own simple output, which it was always built for.
 */
/**
 * The union of one capsule per stroke segment, and never a thrown error.
 *
 * The union is geometry the user is mid-gesture with, so it runs on every
 * pointer move and again on release. `polygon-clipping` is robust for
 * ordinary input but not total: certain near-degenerate arrangements make it
 * give up mid-ring. That must not take the table down, and it must not
 * silently shrink the stroke either -- so a capsule the union refuses is
 * kept as its own polygon instead. Overlapping polygons in the result are
 * fine for both consumers: `earcut` triangulates each one independently, and
 * the footprint query merges the regions it finds by identity.
 *
 * Snapping the corners to a grid first was tried and dropped: over 2000
 * simulated wandering drags it changed the failure rate from 12 to 10, and
 * on straighter strokes it introduced failures where there had been none.
 * The arrangements that defeat the algorithm are not near-duplicate corners,
 * so rounding them does not help.
 */
function unionCapsules(capsules: readonly Polygon[]): MultiPolygon {
  const [first, ...rest] = capsules;
  if (first === undefined) return [];
  try {
    return polygonClipping.union(first, ...rest);
  } catch {
    let merged: MultiPolygon = [first];
    for (const capsule of rest) {
      try {
        merged = polygonClipping.union(merged, capsule);
      } catch {
        merged = [...merged, capsule];
      }
    }
    return merged;
  }
}

/**
 * How many segments an arc of this radius is worth describing in, given that
 * the outline is about to become the boundary of a mesh whose cells are
 * `chord` across.
 *
 * A boundary point is a cell corner. Describing a brush cap in sixteen
 * segments when the cells are two units wide does not buy a rounder shape --
 * it buys cells a fraction of the size asked for, because the mesh cannot be
 * coarser than the outline that bounds it. Measured: the face count of a
 * generated patch is about twice its boundary point count whenever the region
 * is too small for the interior lattice to survive, which is every brush
 * stroke. A single dab described in 24 segments came back as 50 faces where
 * seven were wanted.
 *
 * Clamped at both ends: never so coarse that a circle reads as a triangle,
 * never so fine that it dictates the mesh again.
 */
function arcSegments(radius: number, chord: number): number {
  if (!(chord > 0)) return 16;
  return Math.min(24, Math.max(6, Math.ceil((2 * Math.PI * radius) / chord)));
}

/** One capsule per (decimated) stroke segment, snapped and ready to union. */
function strokeCapsules(
  samples: readonly ConstructionPosition[],
  radius: number,
  chord: number,
): readonly Polygon[] {
  // Samples closer together than a cell add a capsule that changes the union
  // by less than one cell, at the cost of two more points on its outline.
  const spacing = Math.max(chord > 0 ? chord : radius * 0.5, radius * 0.5, 0.05);
  const decimated = decimateXZ(samples, spacing);
  const capsules: Polygon[] = [];
  for (let index = 1; index < decimated.length; index += 1) {
    capsules.push([capsuleRing(decimated[index - 1], decimated[index], radius, arcSegments(radius, chord))]);
  }
  return capsules;
}

/**
 * The swept area of a circular brush stroke, as real 2D polygons (XZ).
 *
 * Shared with {@link brushSweptRegionFill} on purpose: the ghost the user
 * saw while dragging and the footprint the engine is then asked about must
 * be the identical shape, or the stroke would affect ground the preview
 * never highlighted.
 */
export function brushSweptOutlinePolygons(
  samples: readonly ConstructionPosition[],
  radius: number,
  /**
   * How far apart the points of the result may be, for a caller that is going
   * to turn this outline into a mesh. Omitted keeps the fixed resolution every
   * other caller has always had.
   */
  chord = 0,
): MultiPolygon {
  const first = samples[0];
  if (first === undefined) return [];
  const capsules = strokeCapsules(samples, radius, chord);
  if (capsules.length === 0) return [[circleRing(first, radius, arcSegments(radius, chord))]];
  return unionCapsules(capsules);
}

export function brushSweptRegionFill(
  samples: readonly ConstructionPosition[],
  shape: BrushOutlineShape,
  color: number,
  opacity = 0.3,
  /**
   * Must match whatever the same stroke passes to
   * {@link brushSweptOutlinePolygons}, or the ghost stops being the shape the
   * engine is asked about.
   */
  chord = 0,
): PreviewDescriptor {
  const first = samples[0];
  if (first === undefined) return { kind: "mesh", color, opacity, positions: new Float32Array(), indices: new Uint16Array() };

  const radius = shape.radius;
  const positions: number[] = [];
  const indices: number[] = [];

  const addPolygon = (polygon: Polygon, allSamples: readonly ConstructionPosition[]) => {
    const { vertices, holes, dimensions } = earcutFlatten(polygon);
    const triangles = earcut(vertices, holes, dimensions);
    const base = positions.length / 3;
    for (let index = 0; index < vertices.length; index += dimensions) {
      const x = vertices[index];
      const z = vertices[index + 1];
      positions.push(x, nearestSampleY(x, z, allSamples) + 0.03, z);
    }
    for (const triangleIndex of triangles) indices.push(base + triangleIndex);
  };

  const capsules = strokeCapsules(samples, radius, chord);
  if (capsules.length === 0) {
    addPolygon([circleRing(first, radius, arcSegments(radius, chord))], samples);
  } else {
    for (const polygon of unionCapsules(capsules)) addPolygon(polygon, samples);
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