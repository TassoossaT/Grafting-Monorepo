import type { ConstructionPosition, PathEdgeSpec } from "@/ports";

/** How many arcs one tower stamp's own circle is built from -- see {@link circleEdges}'s own doc for why this can never be 2. */
const CIRCLE_SEGMENTS = 4;

function pointOnCircle(center: ConstructionPosition, radius: number, angle: number): ConstructionPosition {
  return { x: center.x + radius * Math.cos(angle), y: center.y, z: center.z + radius * Math.sin(angle) };
}

/**
 * {@link CIRCLE_SEGMENTS} points evenly spaced around the circle, starting
 * due east and proceeding counterclockwise (increasing angle, matching
 * {@link previewOutline}'s own convention).
 */
function circlePoints(center: ConstructionPosition, radius: number): readonly ConstructionPosition[] {
  const points: ConstructionPosition[] = [];
  for (let step = 0; step < CIRCLE_SEGMENTS; step += 1) {
    points.push(pointOnCircle(center, radius, (step / CIRCLE_SEGMENTS) * Math.PI * 2));
  }
  return points;
}

/**
 * The {@link CIRCLE_SEGMENTS} committed edges one tower stamp sends to
 * `generatePathExtrusion` -- a full circle built from {@link CIRCLE_SEGMENTS}
 * true circular arcs, **never exactly 2** true semicircles: two semicircle
 * edges closing the same circle share both their own endpoints, and a
 * curved edge's own 4 corner nodes are purely position-derived
 * (`extrusion.rs`'s own `corner_id`), so both would mint the identical node
 * set and collide on one `grafting_graph_core::SurfaceKey` -- the engine
 * silently keeps only the first and drops the second, which read as "only
 * half the circle draws." {@link CIRCLE_SEGMENTS} arcs of `2*PI /
 * CIRCLE_SEGMENTS` each keep every edge's own corner pair unique. Each arc
 * is tagged `"arc-right"`, not `"arc-left"` -- for points generated in
 * increasing-angle (counterclockwise) order, `"arc-right"` is the tag whose
 * own true circle center actually lands back on `center` (verified in
 * `extrusion.rs`'s and `generation.rs`'s own matching tests); `"arc-left"`
 * would still produce 4 valid, non-colliding surfaces (this tag only
 * affects which side of the chord the arc bulges toward, not corner
 * identity), just not the circle actually requested.
 */
export function circleEdges(center: ConstructionPosition, radius: number): readonly PathEdgeSpec[] {
  const points = circlePoints(center, radius);
  const includedAngle = (Math.PI * 2) / CIRCLE_SEGMENTS;
  const edges: PathEdgeSpec[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (start === undefined || end === undefined) continue;
    edges.push({ start, end, curvature: "arc-right", includedAngle });
  }
  return edges;
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
