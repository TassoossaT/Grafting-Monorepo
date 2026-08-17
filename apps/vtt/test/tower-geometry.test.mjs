import assert from "node:assert/strict";
import test from "node:test";

import { circleEdges, diameterPoints, previewOutline } from "../src/composition/tabletop/tools/tower-geometry.ts";

const CENTER = { x: 10, y: 0, z: 5 };
const RADIUS = 2.5;

test("diameterPoints returns the east/west points at exactly the given radius", () => {
  const { east, west } = diameterPoints(CENTER, RADIUS);
  assert.deepEqual(east, { x: 12.5, y: 0, z: 5 });
  assert.deepEqual(west, { x: 7.5, y: 0, z: 5 });
});

test("circleEdges is exactly two arc-left edges chained east-west-east", () => {
  const edges = circleEdges(CENTER, RADIUS);
  assert.equal(edges.length, 2);
  assert.equal(edges[0].curvature, "arc-left");
  assert.equal(edges[1].curvature, "arc-left");
  assert.deepEqual(edges[0].start, { x: 12.5, y: 0, z: 5 });
  assert.deepEqual(edges[0].end, { x: 7.5, y: 0, z: 5 });
  assert.deepEqual(edges[1].start, edges[0].end, "the second edge starts exactly where the first ends");
  assert.deepEqual(edges[1].end, edges[0].start, "the loop closes back onto the first edge's own start");
});

test("circleEdges chains continuously regardless of center/radius", () => {
  const edges = circleEdges({ x: -3, y: 1, z: -3 }, 1.5);
  assert.deepEqual(edges[0].end, edges[1].start);
  assert.deepEqual(edges[1].end, edges[0].start);
});

test("previewOutline returns a closed polygon of the requested resolution, every point at exactly `radius` from center", () => {
  const segments = 12;
  const outline = previewOutline(CENTER, RADIUS, segments);
  const pointCount = outline.length / 3;
  assert.equal(pointCount, segments * 2, "one (from, to) pair per segment");
  for (let i = 0; i < pointCount; i += 1) {
    const x = outline[i * 3];
    const z = outline[i * 3 + 2];
    const distance = Math.hypot(x - CENTER.x, z - CENTER.z);
    assert.ok(Math.abs(distance - RADIUS) < 1e-6, `point ${i} must sit exactly on the circle`);
  }
});

test("previewOutline's segments actually chain -- each pair's own end matches the next pair's own start, closing back to the first point", () => {
  const segments = 8;
  const outline = previewOutline(CENTER, RADIUS, segments);
  const point = (index) => ({ x: outline[index * 3], y: outline[index * 3 + 1], z: outline[index * 3 + 2] });

  for (let segment = 0; segment < segments - 1; segment += 1) {
    const thisSegmentEnd = point(segment * 2 + 1);
    const nextSegmentStart = point((segment + 1) * 2);
    assert.deepEqual(thisSegmentEnd, nextSegmentStart, `segment ${segment}'s end must match segment ${segment + 1}'s start`);
  }
  const firstStart = point(0);
  const lastEnd = point((segments - 1) * 2 + 1);
  assert.ok(Math.hypot(lastEnd.x - firstStart.x, lastEnd.z - firstStart.z) < 1e-5, "the outline closes back onto its own first point");
});
