import earcut from "earcut";
import { getStroke } from "perfect-freehand";

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
/** The original sample nearest `(x, z)` -- used to carry a plausible terrain height onto an outline point that perfect-freehand invented (it only ever works in 2D). */
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
 * fill and reads as darker little blocks. A hand-rolled offset-ribbon or
 * convex-hull approximation either self-intersects on tight turns or fills
 * across concave stretches of the stroke instead of following it -- both
 * wrong for "show exactly where the brush passed." So this leans on the
 * same two building blocks every whiteboard/drawing app (Excalidraw,
 * tldraw) uses for freehand ink: `perfect-freehand`'s `getStroke` turns the
 * raw samples into one simple outline polygon that actually follows the
 * path (concave stretches included, not just the convex envelope), and
 * `earcut` triangulates that polygon -- both handle the self-intersection
 * and concavity problems generically instead of us re-deriving them here.
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
  const outline = getStroke(
    samples.map((sample) => [sample.x, sample.z]),
    { size: radius * 2, thinning: 0, smoothing: 0.5, streamline: 0.5, simulatePressure: false, last: true },
  );

  if (outline.length < 3) {
    // Perfect-freehand needs a real path to build an outline from -- a
    // stationary hover (one sample, `outline` empty/degenerate) still needs
    // its own ghost, so fall back to a plain disc of the same radius.
    const positions: number[] = [];
    const indices: number[] = [];
    const y = first.y + 0.03;
    positions.push(first.x, y, first.z);
    const segments = 24;
    for (let index = 0; index <= segments; index += 1) {
      const angle = (Math.PI * 2 * index) / segments;
      positions.push(first.x + radius * Math.cos(angle), y, first.z + radius * Math.sin(angle));
    }
    for (let index = 1; index <= segments; index += 1) indices.push(0, index, index + 1);
    return { kind: "mesh", color, opacity, positions: Float32Array.from(positions), indices: Uint16Array.from(indices) };
  }

  const flat: number[] = [];
  for (const [x, z] of outline) flat.push(x, z);
  const triangleIndices = earcut(flat);

  const positions = new Float32Array(outline.length * 3);
  outline.forEach(([x, z], index) => {
    positions[index * 3] = x;
    positions[index * 3 + 1] = nearestSampleY(x, z, samples) + 0.03;
    positions[index * 3 + 2] = z;
  });

  return {
    kind: "mesh",
    color,
    opacity,
    positions,
    indices: positions.length / 3 > 65535 ? Uint32Array.from(triangleIndices) : Uint16Array.from(triangleIndices),
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