import assert from "node:assert/strict";
import test from "node:test";

import { circleContour, previewOutline } from "../src/composition/tabletop/tools/tower/tower-geometry.ts";

const CENTER = { x: 10, y: 0, z: 5 };
const RADIUS = 2.5;

test("circleContour is four true quarter-arcs around one real center, chained continuously", () => {
  const edges = circleContour(CENTER, RADIUS);
  assert.equal(edges.length, 4, "two semicircles would share both endpoints, so both panels would be the same region declared twice");
  for (const edge of edges) {
    assert.equal(edge.geometry.kind, "arc");
    assert.deepEqual(edge.geometry.center, [CENTER.x, CENTER.z], "every arc shares the tower's own center -- there is no per-edge approximation");
    assert.equal(edge.geometry.clockwise, false, "corners run counter-clockwise, so the short sweep between them is the counter-clockwise one");
  }
  for (let index = 0; index < edges.length; index += 1) {
    const next = edges[(index + 1) % edges.length];
    assert.deepEqual(edges[index].end, next.start, `edge ${index}'s end must match the next edge's own start`);
  }
});

test("circleContour's own points sit exactly on the requested circle", () => {
  for (const edge of circleContour(CENTER, RADIUS)) {
    const distance = Math.hypot(edge.start.x - CENTER.x, edge.start.z - CENTER.z);
    assert.ok(Math.abs(distance - RADIUS) < 1e-6, "every edge's own start must sit exactly on the circle");
  }
});

test("circleContour chains continuously regardless of center/radius", () => {
  const edges = circleContour({ x: -3, y: 1, z: -3 }, 1.5);
  for (let index = 0; index < edges.length; index += 1) {
    const next = edges[(index + 1) % edges.length];
    assert.deepEqual(edges[index].end, next.start);
  }
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
