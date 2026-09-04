import assert from "node:assert/strict";
import test from "node:test";

import {
  dirtLoadOver,
  dirtProfile,
} from "../src/composition/tabletop/tools/terrain/terrain-restack.ts";

test("a load of earth is full under the brush and nothing at its rim", () => {
  assert.equal(dirtProfile(0), 1);
  assert.equal(dirtProfile(1), 0);
  assert.equal(dirtProfile(2), 0, "past the rim is still nothing, never negative");
});

test("the profile arrives flat, so the mound does not crease into flat ground", () => {
  // The slope near the rim has to vanish. A straight taper would keep a
  // constant slope right up to the edge and leave a visible crease there.
  const nearRim = dirtProfile(0.95) - dirtProfile(0.99);
  const midway = dirtProfile(0.48) - dirtProfile(0.52);
  assert.ok(nearRim < midway / 4, `slope should die off at the rim; got ${nearRim} against ${midway}`);
});

test("the load is measured from the path the brush travelled, not from a bounding box", () => {
  // A long stroke along x. A point beside its middle is under the brush; a
  // point the same distance past its end is not.
  const path = [
    { x: 0, y: 0, z: 0 },
    { x: 20, y: 0, z: 0 },
  ];
  const load = dirtLoadOver(path, 3);
  assert.ok(load({ x: 10, y: 0, z: 0 }) > 0.99, "on the spine");
  assert.ok(load({ x: 10, y: 0, z: 2.9 }) < 0.1, "at the edge of the band");
  assert.equal(load({ x: 24, y: 0, z: 0 }), 0, "past the end of the stroke");
});

test("a stroke of one sample still loads, so a tap is not a no-op", () => {
  const load = dirtLoadOver([{ x: 5, y: 0, z: 5 }], 3);
  assert.ok(load({ x: 5, y: 0, z: 5 }) > 0.99);
  assert.equal(load({ x: 9, y: 0, z: 5 }), 0);
});
