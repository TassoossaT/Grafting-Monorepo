import assert from "node:assert/strict";
import test from "node:test";
import { enginePort } from "./engine-planar.mjs";

import { heightsOnCurves } from "../src/features/edit-construction/structure-types/path/contour/curve-projection.ts";

/**
 * A planar union hands its vertices back flat; the curve the surface was swept
 * from is what says how high each one is. That projection is the engine's own
 * reference field -- the same one that elevates the mesh's interior -- so these
 * run against it rather than against a second copy of the arithmetic.
 */

/** A curve climbing one unit of height per unit of ground, along +x. */
const ramp = [{ points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }], reach: 2 }];

test("a vertex reads the curve's height at the station it projects onto, not the nearest sample's", () => {
  const [left, right] = heightsOnCurves(enginePort, ramp, [[2.5, 1.5], [2.5, -1.5]]);

  assert.ok(Math.abs(left - 2.5) < 1e-3, `left margin read ${left}`);
  assert.ok(Math.abs(right - 2.5) < 1e-3, "both margins of one station read the same height");
});

test("a vertex past the curve's end reads that end rather than an extrapolation", () => {
  const [beyond] = heightsOnCurves(enginePort, ramp, [[14, 0]]);

  assert.ok(Math.abs(beyond - 10) < 1e-3, `an end cap reads the end's own height, got ${beyond}`);
});

test("with no curve to project onto a vertex is flat, never NaN", () => {
  assert.deepEqual(heightsOnCurves(enginePort, [], [[1, 1]]), [0]);
  assert.deepEqual(heightsOnCurves(enginePort, [], [[1, 1]], 3), [3]);
});
