import assert from "node:assert/strict";
import test from "node:test";

import { resolveConstructionGuides, snapConstructionDistance } from "../src/features/edit-construction/guides/construction-guides.ts";

const point = (x, y, z) => ({ x, y, z });
const reference = (id, position, group = "panel") => ({ id, position, group, axes: ["x", "y", "z"] });

test("construction guides resolve a nearby reference point before independent axes", () => {
  const result = resolveConstructionGuides(
    point(1.03, 2.02, 3.01),
    [reference("b", point(1, 2, 3))],
    0.1,
  );
  assert.deepEqual(result.point, point(1, 2, 3));
  assert.equal(result.guides[0]?.axis, "point");
});

test("axis ties use the reference id consistently and preserve unrelated coordinates", () => {
  const result = resolveConstructionGuides(
    point(1, 2.04, 3),
    [reference("z-ref", point(0, 2, 0)), reference("a-ref", point(4, 2, 0))],
    0.1,
    { pointSnap: false, horizontalAlignment: false, equalHeight: true, equalSpacing: false },
  );
  assert.deepEqual(result.point, point(1, 2, 3));
  assert.equal(result.guides[0]?.id, "a-ref");
  assert.equal(result.guides[0]?.axis, "y");
});

test("equal spacing extends a same-group interval to the next position", () => {
  const result = resolveConstructionGuides(
    point(8.06, 0, 0),
    [reference("window-a", point(0, 0, 0), "opening"), reference("window-b", point(4, 0, 0), "opening")],
    0.1,
    { pointSnap: false, horizontalAlignment: false, equalHeight: false, equalSpacing: true },
  );
  assert.deepEqual(result.point, point(8, 0, 0));
  assert.equal(result.guides.length, 2);
});

test("distance steps preserve the direction and snap only the drag length", () => {
  const result = snapConstructionDistance(point(0.96, 0, 0.96), point(0, 0, 0), 0.5);
  assert.ok(Math.abs(Math.hypot(result.point.x, result.point.z) - 1.5) < 1e-9);
  assert.ok(Math.abs(result.point.x - result.point.z) < 1e-9);
  assert.equal(result.guides[0]?.axis, "distance");
});
