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
 * Built as one continuous, non-overlapping triangle strip -- each interior
 * sample's offset uses the *averaged* normal of its two adjacent segments
 * (not each segment's own normal independently), so a curving/zigzagging
 * stroke reads as one smooth ribbon instead of a chain of independently
 * rotated little rectangles that overlap at every turn. That overlap used to
 * double-blend the translucent fill wherever the stroke curved or the
 * pointer produced closely-spaced samples -- reading as both "little
 * squares" and "gets more intense with more passes." A single non-self-
 * overlapping strip has neither problem: it is exactly the swept area, once.
 */
export function brushSweptRegionFill(
  samples: readonly ConstructionPosition[],
  shape: BrushOutlineShape,
  color: number,
  opacity = 0.3,
): PreviewDescriptor {
  const positions: number[] = [];
  const indices: number[] = [];
  const first = samples[0];
  if (first === undefined) return { kind: "mesh", color, opacity, positions: new Float32Array(), indices: new Uint16Array() };

  const radius = shape.radius;
  const CAP_SEGMENTS = 24;

  const addCap = (center: ConstructionPosition) => {
    const y = center.y + 0.03;
    const base = positions.length / 3;
    positions.push(center.x, y, center.z);
    for (let index = 0; index <= CAP_SEGMENTS; index += 1) {
      const angle = (Math.PI * 2 * index) / CAP_SEGMENTS;
      positions.push(center.x + radius * Math.cos(angle), y, center.z + radius * Math.sin(angle));
    }
    for (let index = 1; index <= CAP_SEGMENTS; index += 1) {
      indices.push(base, base + index, base + index + 1);
    }
  };

  addCap(first);
  const last = samples[samples.length - 1];
  if (samples.length > 1 && last !== undefined) addCap(last);

  if (samples.length > 1) {
    // One unit normal per segment (perpendicular to that segment's own direction).
    const segmentNormals: ({ readonly x: number; readonly z: number } | undefined)[] = [];
    for (let index = 1; index < samples.length; index += 1) {
      const dx = samples[index].x - samples[index - 1].x;
      const dz = samples[index].z - samples[index - 1].z;
      const length = Math.hypot(dx, dz);
      segmentNormals.push(length <= Number.EPSILON ? undefined : { x: -dz / length, z: dx / length });
    }

    // Each vertex's normal is the average of its two adjacent segments' normals
    // (just one segment's, at the stroke's own ends) -- this is what keeps the
    // strip's two rails continuous through a turn instead of leaving a
    // gap/overlap at every joint.
    const normalAt = (index: number): { readonly x: number; readonly z: number } => {
      const previous = segmentNormals[index - 1];
      const next = segmentNormals[index];
      if (previous === undefined) return next ?? { x: 0, z: 0 };
      if (next === undefined) return previous;
      const sx = previous.x + next.x;
      const sz = previous.z + next.z;
      const length = Math.hypot(sx, sz);
      return length <= Number.EPSILON ? next : { x: sx / length, z: sz / length };
    };

    for (let index = 1; index < samples.length; index += 1) {
      const startNormal = normalAt(index - 1);
      const endNormal = normalAt(index);
      const start = samples[index - 1];
      const end = samples[index];
      const startY = start.y + 0.03;
      const endY = end.y + 0.03;
      const base = positions.length / 3;
      positions.push(
        start.x + startNormal.x * radius, startY, start.z + startNormal.z * radius,
        end.x + endNormal.x * radius, endY, end.z + endNormal.z * radius,
        end.x - endNormal.x * radius, endY, end.z - endNormal.z * radius,
        start.x - startNormal.x * radius, startY, start.z - startNormal.z * radius,
      );
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
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