import type { ConstructionPosition } from "@/ports";

import type { FittedEdge } from "../core/stroke-fitting.ts";

/**
 * How many arcs one tower's own circle is built from.
 *
 * Four rather than two: two semicircles closing the same circle share *both*
 * their endpoints, so the two panels over them would be bounded by the same
 * pair of columns and the same pair of edges -- one region, declared twice,
 * of which only the first survives. Four quarter turns give every panel its
 * own pair of columns, which is the plain reason, not a property of towers.
 */
const CIRCLE_SEGMENTS = 4;

function pointOnCircle(center: ConstructionPosition, radius: number, angle: number): ConstructionPosition {
  return { x: center.x + radius * Math.cos(angle), y: center.y, z: center.z + radius * Math.sin(angle) };
}

/**
 * A closed circular wall run: {@link CIRCLE_SEGMENTS} corners around the
 * circle and one true circular arc between each pair, every arc sharing the
 * one real center.
 *
 * This is the whole of the tower preset. It produces contour edges in the
 * same vocabulary a free stroke is fitted into, so the preset commits
 * through exactly the same wall builder with no geometry, no ids and no
 * generation of its own -- a preset decides where the corners go and how
 * each step curves, and stops there.
 *
 * Corners run counter-clockwise (increasing angle), and each arc sweeps the
 * short way between consecutive corners, which is the quarter turn that
 * actually lies on the requested circle.
 */
export function circleContour(center: ConstructionPosition, radius: number): readonly FittedEdge[] {
  const corners = Array.from({ length: CIRCLE_SEGMENTS }, (_unused, step) =>
    pointOnCircle(center, radius, (step / CIRCLE_SEGMENTS) * Math.PI * 2),
  );
  const arcCenter = [center.x, center.z] as const;
  return corners.map((start, index) => ({
    start,
    end: corners[(index + 1) % corners.length] ?? start,
    geometry: { kind: "arc", center: arcCenter, clockwise: false } as const,
  }));
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
