import type { ConstructionPosition, PathEdgeSpec } from "@/ports";

/**
 * The two points diametrically opposite `center` at `radius`, east and west
 * -- a full circle is exactly two `"arc-left"` semicircle edges chained
 * east-to-west-to-east: each edge's own "left" side flips with its own
 * direction of travel (`extrusion.rs`'s own `ArcBulge` doc), so the same
 * curvature tag on both edges naturally traces the *opposite* halves of the
 * circle instead of retracing the same one -- no `"arc-right"` needed.
 */
export function diameterPoints(center: ConstructionPosition, radius: number): { readonly east: ConstructionPosition; readonly west: ConstructionPosition } {
  return {
    east: { x: center.x + radius, y: center.y, z: center.z },
    west: { x: center.x - radius, y: center.y, z: center.z },
  };
}

/** The exact two committed edges one tower stamp sends to `generatePathExtrusion` -- see `tower-stamp-tool.ts`'s own doc. */
export function circleEdges(center: ConstructionPosition, radius: number): readonly PathEdgeSpec[] {
  const { east, west } = diameterPoints(center, radius);
  return [
    { start: east, end: west, curvature: "arc-left" },
    { start: west, end: east, curvature: "arc-left" },
  ];
}

function pointOnCircle(center: ConstructionPosition, radius: number, angle: number): ConstructionPosition {
  return { x: center.x + radius * Math.cos(angle), y: center.y, z: center.z + radius * Math.sin(angle) };
}

/**
 * A closed polygon outline approximating the tower's own footprint, for the
 * ghost preview only -- never fed to the engine. `segments` line-segment
 * pairs (`pointAt(step)`, `pointAt(step + 1)`), the last one closing exactly
 * back onto the first point since `pointAt(segments)`'s angle (`2*PI`)
 * lands on the same position as `pointAt(0)`'s (`0`).
 */
export function previewOutline(center: ConstructionPosition, radius: number, segments: number): Float32Array {
  const points: number[] = [];
  for (let step = 0; step < segments; step += 1) {
    const from = pointOnCircle(center, radius, (step / segments) * Math.PI * 2);
    const to = pointOnCircle(center, radius, ((step + 1) / segments) * Math.PI * 2);
    points.push(from.x, from.y, from.z, to.x, to.y, to.z);
  }
  return Float32Array.from(points);
}
