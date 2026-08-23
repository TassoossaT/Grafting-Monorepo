import assert from "node:assert/strict";
import test from "node:test";

import { fitPath } from "../src/composition/tabletop/tools/core/stroke-fitting.ts";

const TOLERANCE = 0.4;

function point(x, z) {
  return { x, y: 0, z };
}

test("fitPath returns nothing for fewer than two points", () => {
  assert.deepEqual(fitPath([], TOLERANCE), []);
  assert.deepEqual(fitPath([point(0, 0)], TOLERANCE), []);
});

test("a straight line of raw samples fits into one straight edge", () => {
  const points = [point(0, 0), point(1, 0), point(2, 0), point(3, 0), point(4, 0)];
  const edges = fitPath(points, TOLERANCE);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].geometry.kind, "line");
  assert.deepEqual(edges[0].start, points[0]);
  assert.deepEqual(edges[0].end, points[4]);
});

test("small hand-tremor noise under the tolerance still fits as one straight edge", () => {
  const points = [point(0, 0), point(1, 0.1), point(2, -0.1), point(3, 0.05), point(4, 0)];
  const edges = fitPath(points, TOLERANCE);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].geometry.kind, "line");
});

test("a sharp right-angle turn fits into two straight edges, corner preserved", () => {
  const points = [point(0, 0), point(2, 0), point(4, 0), point(4, 2), point(4, 4)];
  const edges = fitPath(points, TOLERANCE);
  assert.equal(edges.length, 2);
  assert.equal(edges[0].geometry.kind, "line");
  assert.equal(edges[1].geometry.kind, "line");
  assert.deepEqual(edges[0].start, points[0]);
  assert.deepEqual(edges[0].end, points[2]);
  assert.deepEqual(edges[1].start, points[2]);
  assert.deepEqual(edges[1].end, points[4]);
});

/** Samples on a real arc from `start` to `end` around `center`, sweeping `includedAngle` -- positive sweeps counter-clockwise in the XZ convention (`atan2(z, x)`). */
function arcPoints(center, radius, startAngle, includedAngle, steps) {
  const points = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = startAngle + includedAngle * (step / steps);
    points.push(point(center.x + radius * Math.cos(angle), center.z + radius * Math.sin(angle)));
  }
  return points;
}

test("a perfectly traced semicircle fits into one true arc, not several straight corners", () => {
  // (0,0) to (4,0) around (2,0), bulging toward +z: the sweep from start to
  // end that passes through (2,2) is the clockwise one in `atan2(z, x)`.
  const points = arcPoints({ x: 2, z: 0 }, 2, Math.PI, -Math.PI, 8);
  const edges = fitPath(points, TOLERANCE);
  assert.equal(edges.length, 1, "a smooth curve must not be chopped into false corners by straight-line RDP");
  assert.equal(edges[0].geometry.kind, "arc");
  assert.ok(Math.hypot(edges[0].geometry.center[0] - 2, edges[0].geometry.center[1] - 0) < 1e-6);
  assert.equal(edges[0].geometry.clockwise, true);
  assert.deepEqual(edges[0].start, points[0]);
  assert.deepEqual(edges[0].end, points[points.length - 1]);
});

test("an arc traced the other way round the same circle fits with the opposite sweep", () => {
  const points = arcPoints({ x: 2, z: 0 }, 2, Math.PI, Math.PI, 8);
  const edges = fitPath(points, TOLERANCE);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].geometry.kind, "arc");
  assert.equal(edges[0].geometry.clockwise, false);
});

/**
 * The fitter's arc is the true circle through a span's own endpoints and the
 * point it wanders furthest to, so a partial turn is an ordinary fit rather
 * than something the vocabulary cannot express. A quarter arc must come back
 * as one arc on the circle actually drawn -- this is also exactly what a
 * tower preset commits, so the two agree on the same shape.
 */
test("a quarter turn fits as one arc on the circle it was actually drawn on", () => {
  const points = arcPoints({ x: 0, z: 0 }, 3, 0, Math.PI / 2, 6);
  const edges = fitPath(points, TOLERANCE);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].geometry.kind, "arc");
  assert.ok(Math.hypot(edges[0].geometry.center[0], edges[0].geometry.center[1]) < 1e-5, "the fitted center is the real one, not the chord's own midpoint");
  assert.equal(edges[0].geometry.clockwise, false);
});

test("a straight run followed by a genuine curve isolates the straight run exactly", () => {
  const straightPart = [point(-4, 0), point(-3, 0), point(-2, 0), point(-1, 0), point(0, 0)];
  const curvedPart = arcPoints({ x: 2, z: 0 }, 2, Math.PI, -Math.PI, 8).slice(1);
  const points = [...straightPart, ...curvedPart];
  const edges = fitPath(points, TOLERANCE);
  assert.ok(edges.length < points.length - 1, "fitting must still collapse far fewer edges than one per raw sample");
  assert.equal(edges[0].geometry.kind, "line");
  assert.deepEqual(edges[0].start, points[0]);
  assert.deepEqual(edges[0].end, points[4], "the straight/curve boundary itself is found exactly");
  assert.deepEqual(edges[edges.length - 1].end, points[points.length - 1]);
});

test("a tolerance of zero commits the contour literally -- one edge per raw sample", () => {
  const points = [point(0, 0), point(1, 0.3), point(2, -0.2), point(3, 0.1)];
  const edges = fitPath(points, 0);
  assert.equal(edges.length, points.length - 1);
  for (const edge of edges) assert.equal(edge.geometry.kind, "line");
});

test("a wider tolerance corrects the same shaky stroke into one straight run", () => {
  const points = [point(0, 0), point(1, 0.3), point(2, -0.2), point(3, 0.1)];
  const edges = fitPath(points, 1);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].geometry.kind, "line");
});

test("with arcs off, a perfectly traced circle still fits as straight chords", () => {
  const points = arcPoints({ x: 2, z: 0 }, 2, Math.PI, -Math.PI, 8);
  const edges = fitPath(points, TOLERANCE, { arcs: false });
  assert.ok(edges.length >= 1);
  for (const edge of edges) assert.equal(edge.geometry.kind, "line");
  assert.deepEqual(edges[0].start, points[0]);
  assert.deepEqual(edges[edges.length - 1].end, points[points.length - 1]);
});

test("with arcs off, corners are still found -- only curvature is refused", () => {
  const points = [point(0, 0), point(2, 0), point(4, 0), point(4, 2), point(4, 4)];
  const edges = fitPath(points, TOLERANCE, { arcs: false });
  assert.equal(edges.length, 2);
  assert.deepEqual(edges[0].end, points[2], "the corner is where it always was");
});
