import assert from "node:assert/strict";
import test from "node:test";

import { fitPath } from "../src/composition/tabletop/tools/path-fitting.ts";

const EPSILON = 0.4;

function point(x, z) {
  return { x, y: 0, z };
}

test("fitPath returns nothing for fewer than two points", () => {
  assert.deepEqual(fitPath([], EPSILON), []);
  assert.deepEqual(fitPath([point(0, 0)], EPSILON), []);
});

test("a straight line of raw samples fits into one straight edge", () => {
  const points = [point(0, 0), point(1, 0), point(2, 0), point(3, 0), point(4, 0)];
  const edges = fitPath(points, EPSILON);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].curvature, "straight");
  assert.deepEqual(edges[0].start, points[0]);
  assert.deepEqual(edges[0].end, points[4]);
});

test("small hand-tremor noise under the tolerance still fits as one straight edge", () => {
  const points = [point(0, 0), point(1, 0.1), point(2, -0.1), point(3, 0.05), point(4, 0)];
  const edges = fitPath(points, EPSILON);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].curvature, "straight");
});

test("a sharp right-angle turn fits into two straight edges, corner preserved", () => {
  const points = [point(0, 0), point(2, 0), point(4, 0), point(4, 2), point(4, 4)];
  const edges = fitPath(points, EPSILON);
  assert.equal(edges.length, 2);
  assert.equal(edges[0].curvature, "straight");
  assert.equal(edges[1].curvature, "straight");
  assert.deepEqual(edges[0].start, points[0]);
  assert.deepEqual(edges[0].end, points[2]);
  assert.deepEqual(edges[1].start, points[2]);
  assert.deepEqual(edges[1].end, points[4]);
});

/** Points sampled exactly on the true semicircle from (0,0) to (4,0), bulging toward +z -- the same tessellation `extrusion.rs`'s own `tessellate_semicircle_points` produces for `ArcBulge::Left`, so a perfect trace of that curve must fit back into exactly one `"arc-left"` edge, not get chopped into false corners by straight-line RDP. */
function leftBulgingSemicirclePoints() {
  const start = point(0, 0);
  const end = point(4, 0);
  const center = { x: 2, z: 0 };
  const radius = 2;
  const steps = 8;
  const points = [];
  for (let step = 0; step <= steps; step += 1) {
    if (step === 0) {
      points.push(start);
      continue;
    }
    if (step === steps) {
      points.push(end);
      continue;
    }
    const theta = Math.PI * (1 - step / steps);
    points.push(point(center.x + radius * Math.cos(theta), center.z + radius * Math.sin(theta)));
  }
  return points;
}

test("a perfectly traced semicircle fits into one arc edge, not several straight corners", () => {
  const points = leftBulgingSemicirclePoints();
  const edges = fitPath(points, EPSILON);
  assert.equal(edges.length, 1, "a smooth curve must not be chopped into false corners by straight-line RDP");
  assert.equal(edges[0].curvature, "arc-left");
  assert.deepEqual(edges[0].start, points[0]);
  assert.deepEqual(edges[0].end, points[points.length - 1]);
});

test("a semicircle bulging the other way fits as arc-right", () => {
  const points = leftBulgingSemicirclePoints().map((p) => point(p.x, -p.z));
  const edges = fitPath(points, EPSILON);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].curvature, "arc-right");
});

/**
 * A known v1 limitation, not a bug: the fitter's arc shape is always the
 * *exact* semicircle a span's own two endpoints imply (see
 * `computeResiduals`'s own doc) -- there is no way to fit a partial (say,
 * 90-degree) arc, only a true 180-degree one. `cornerIndices`'s top-down
 * splitting finds the straight/curve boundary correctly here (the first
 * edge below is exactly the straight run), but its very first split lands
 * at the curve's own apex (the single point of max deviation from the
 * whole stroke's outer chord) before the remaining curve is ever tested as
 * one full-semicircle span in its own right -- so the curved remainder
 * falls back to several short straight chords approximating it, rather
 * than being recognized as one arc. Real, but still a large improvement
 * over pre-fitting behaviour (one straight panel per raw pointer sample):
 * this asserts the honest current shape of that fallback, not the ideal
 * one.
 */
test("a straight run followed by a genuine curve isolates the straight run exactly; the curved remainder falls back to a few short straight chords", () => {
  const straightPart = [point(-4, 0), point(-3, 0), point(-2, 0), point(-1, 0), point(0, 0)];
  const curvedPart = leftBulgingSemicirclePoints().slice(1);
  const points = [...straightPart, ...curvedPart];
  const edges = fitPath(points, EPSILON);
  assert.ok(edges.length < points.length - 1, "fitting must still collapse far fewer edges than one per raw sample");
  assert.equal(edges[0].curvature, "straight");
  assert.deepEqual(edges[0].start, points[0]);
  assert.deepEqual(edges[0].end, points[4], "the straight/curve boundary itself is still found exactly");
  assert.deepEqual(edges[edges.length - 1].end, points[points.length - 1]);
});
