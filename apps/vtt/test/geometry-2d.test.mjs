import assert from "node:assert/strict";
import test from "node:test";

import { nearestPointOnPolygonBoundaryXZ } from "../src/composition/tabletop/tools/shapes/geometry-2d.ts";

const SQUARE = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
];

test("a point outside the polygon lands on the nearest edge, not just the nearest vertex", () => {
  const nearest = nearestPointOnPolygonBoundaryXZ({ x: 5, z: -3 }, SQUARE);
  assert.deepEqual(nearest, { x: 5, z: 0 });
});

test("a point already on an edge stays put", () => {
  const nearest = nearestPointOnPolygonBoundaryXZ({ x: 4, z: 0 }, SQUARE);
  assert.deepEqual(nearest, { x: 4, z: 0 });
});

test("a point near a corner picks whichever edge is actually closest", () => {
  const nearest = nearestPointOnPolygonBoundaryXZ({ x: -1, z: -1 }, SQUARE);
  assert.deepEqual(nearest, { x: 0, z: 0 });
});

test("a point inside the polygon still snaps to its boundary, not treated as already there", () => {
  const nearest = nearestPointOnPolygonBoundaryXZ({ x: 5, z: 1 }, SQUARE);
  assert.deepEqual(nearest, { x: 5, z: 0 });
});
