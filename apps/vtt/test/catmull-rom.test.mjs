import assert from "node:assert/strict";
import test from "node:test";

import { sampleCatmullRom } from "../src/composition/tabletop/path/contour/spine-contour/catmull-rom.ts";

const at = (x, z, y = 0) => ({ x, y, z });

function distanceXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

test("collinear, evenly spaced control points flatten to their own straight chords", () => {
  const control = [at(0, 0), at(1, 0), at(2, 0), at(3, 0)];
  const sampled = sampleCatmullRom(control, 0.01);
  assert.deepEqual(sampled, control);
});

test("collinear but unevenly spaced control points still flatten straight -- collinear is collinear under any parametrization", () => {
  const control = [at(0, 0), at(1, 0), at(10, 0)];
  const sampled = sampleCatmullRom(control, 0.01);
  assert.deepEqual(sampled, control);
  for (const point of sampled) assert.equal(point.z, 0);
});

test("a long straight run into a tight corner does not loop or overshoot -- the uneven-spacing regression", () => {
  // Exactly the shape `referenceLineFrom` produces: a long, sparse straight
  // stretch (A -> B, 50 apart) followed by a short, tight corner (B -> C,
  // ~2.8 apart, turning about 45 degrees) into a continuing leg (C -> D).
  // Uniform Catmull-Rom's tangent at B is shaped by the *long* neighbouring
  // span while the curve itself has to travel the *short* B->C span in the
  // same unit parameter interval -- that mismatch is exactly what
  // overshoots into a cusp or a loop right at the corner.
  const a = at(0, 0);
  const b = at(50, 0);
  const c = at(52, 2);
  const d = at(52, 10);
  const control = [a, b, c, d];

  const sampled = sampleCatmullRom(control, 0.02);

  // No sampled point strays far outside the control polygon's own
  // footprint -- a real loop/cusp shoots well past this, a well-behaved
  // centripetal curve through this shape does not.
  const minX = Math.min(...control.map((p) => p.x));
  const maxX = Math.max(...control.map((p) => p.x));
  const minZ = Math.min(...control.map((p) => p.z));
  const maxZ = Math.max(...control.map((p) => p.z));
  const margin = 3 * distanceXZ(b, c); // 3x the short, tight-corner span
  for (const point of sampled) {
    assert.ok(
      point.x >= minX - margin && point.x <= maxX + margin,
      `x overshoot: ${point.x} outside [${minX - margin}, ${maxX + margin}]`,
    );
    assert.ok(
      point.z >= minZ - margin && point.z <= maxZ + margin,
      `z overshoot: ${point.z} outside [${minZ - margin}, ${maxZ + margin}]`,
    );
  }

  // The curve still reaches every control point in order.
  assert.deepEqual(sampled[0], a);
  assert.deepEqual(sampled[sampled.length - 1], d);
});

test("a finer tolerance samples a curve more densely and stays smooth end to end", () => {
  const control = [at(0, 0), at(1, 2), at(2, -2), at(3, 0)];
  const coarse = sampleCatmullRom(control, 0.2);
  const fine = sampleCatmullRom(control, 0.01);
  assert.ok(fine.length > coarse.length, "a tighter tolerance needs more chords to stay within it");
  assert.deepEqual(fine[0], control[0]);
  assert.deepEqual(fine[fine.length - 1], control[control.length - 1]);
});
