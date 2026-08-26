import assert from "node:assert/strict";
import test from "node:test";

import { referenceLineFrom } from "../src/composition/tabletop/path/path-effect-executor.ts";
import {
  stationFrame,
  sweepFormation,
} from "../src/composition/tabletop/tools/core/sweep-formation.ts";

// `pathPatch` (station-node-major patch declaration) and the three tests
// below that exercised it through `sweepFormation` were retired along with
// the rest of the station-sweep commit path -- see `path-shared.ts`'s
// `commitPathContour` doc. `sweepFormation`/`stationFrame` themselves are
// still real, still-used geometry (this file's own remaining tests), so
// they stay; only the patch-declaration integration went with the engine
// that consumed it. The spine-contour engine that replaces it flattens a
// curve to dense straight chords rather than keeping true arc edges in the
// graph, which is a real trade-off worth naming: more graph nodes along a
// curved stretch, no single arc edge a renderer can draw smooth from few
// points.

const HALF_WIDTH = 2;
const FLAT = [
  { lateralOffset: -HALF_WIDTH, elevation: 0 },
  { lateralOffset: 0, elevation: 0 },
  { lateralOffset: HALF_WIDTH, elevation: 0 },
];

/** A quarter circle of radius 10 about the origin, sampled every 15 degrees. */
const RADIUS = 10;
const ARC = { center: [0, 0], clockwise: false };

function quarterCircle() {
  const line = [];
  for (let step = 0; step <= 6; step += 1) {
    const angle = (step * Math.PI) / 12;
    line.push({ x: RADIUS * Math.cos(angle), y: 0, z: RADIUS * Math.sin(angle) });
  }
  // The last station ends the curve, so nothing runs on from it.
  const arcs = line.slice(0, -1).map(() => ARC);
  return { line, arcs };
}

test("a station in the middle of a curve has no corner, so the road stays smooth", () => {
  const { line, arcs } = quarterCircle();
  // Arriving and leaving normals are the same radial direction, so the mitre
  // resolves to a plain unit normal rather than a widened corner.
  const frame = stationFrame(line, 3, 4, arcs);
  assert.ok(Math.abs(Math.hypot(frame[0], frame[1]) - 1) < 1e-6, `${frame}`);

  // Read from the chords instead, the same station reads as a corner.
  const chorded = stationFrame(line, 3, 4, []);
  assert.ok(Math.hypot(chorded[0], chorded[1]) > 1 + 1e-4, `${chorded}`);
});

test("every offset of a curve lands on a circle concentric with it", () => {
  const { line, arcs } = quarterCircle();
  const plan = sweepFormation(line, FLAT, 4, { arcs });

  for (let station = 0; station < line.length; station += 1) {
    for (const [slot, point] of FLAT.entries()) {
      const vertex = plan.vertices[station * 3 + slot];
      const radius = Math.hypot(vertex.x - ARC.center[0], vertex.z - ARC.center[1]);
      // A left-hand turn about the origin: the inner rim is nearer the centre.
      const expected = RADIUS - point.lateralOffset;
      assert.ok(
        Math.abs(radius - expected) < 1e-4,
        `station ${station} slot ${slot}: radius ${radius}, expected ${expected}`,
      );
    }
  }
});

test("the lengthwise edges of a curve are arcs, one centre for all three slots", () => {
  const { line, arcs } = quarterCircle();
  const plan = sweepFormation(line, FLAT, 4, { arcs });

  // One curve per slot per span, and no more.
  assert.equal(plan.curves.length, (line.length - 1) * 3);
  for (const curve of plan.curves) {
    assert.equal(curve.geometry.kind, "arc");
    assert.deepEqual(curve.geometry.center, ARC.center);
    assert.equal(curve.geometry.clockwise, ARC.clockwise);
    assert.equal(curve.to - curve.from, 3, "one span onwards, same slot");
  }
});

test("a straight run reports no curves at all", () => {
  const plan = sweepFormation(
    [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    FLAT,
    4,
  );
  assert.deepEqual(plan.curves, []);
});

test("a fitted arc reaches the sweep as a curve, not as a bag of chords", () => {
  // What the tool actually hands over: a fitted arc, ground samples, and the
  // reference line walk in between.
  const start = { x: 10, y: 0, z: 0 };
  const end = { x: 0, y: 0, z: 10 };
  const fitted = [{ start, end, geometry: { kind: "arc", center: [0, 0], clockwise: false } }];
  const stroke = [start, { x: 7.07, y: 0, z: 7.07 }, end];

  const swept = referenceLineFrom(fitted, stroke, true);
  assert.ok(swept.line.length > 2, "the curve is sampled into stations");
  assert.equal(swept.arcs.length, swept.line.length - 1, "one span per gap");
  assert.ok(
    swept.arcs.every((arc) => arc !== undefined && arc.center[0] === 0 && arc.center[1] === 0),
    "and every span of it knows which circle it is on",
  );
});

test("a straight stroke carries no curve through", () => {
  const at = (x) => ({ x, y: 0, z: 0 });
  const swept = referenceLineFrom(
    [{ start: at(0), end: at(6), geometry: { kind: "line" } }],
    [at(0), at(6)],
    true,
  );
  assert.ok(swept.arcs.every((arc) => arc === undefined));
});
