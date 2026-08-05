import assert from "node:assert/strict";
import test from "node:test";
import { resolveHeightfieldOptions } from "../dist/canvas/heightfield/resolve-options.js";

test("fills in every optional field with its documented default", () => {
  const values = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const resolved = resolveHeightfieldOptions({ width: 2, height: 2, values });

  assert.equal(resolved.width, 2);
  assert.equal(resolved.height, 2);
  assert.equal(resolved.values, values);
  assert.equal(resolved.heightScale, 6);
  assert.equal(resolved.planeSize, 20);
  assert.equal(resolved.backgroundColor, 0xf7f9fc);
  assert.equal(resolved.meshColor, 0x5b8a63);
  assert.equal(resolved.autoRotate, true);
});

test("keeps every explicitly given value instead of the default", () => {
  const values = new Float32Array([1, 2]);
  const resolved = resolveHeightfieldOptions({
    width: 1,
    height: 2,
    values,
    heightScale: 3,
    planeSize: 10,
    backgroundColor: 0x000000,
    meshColor: 0xffffff,
    autoRotate: false,
  });

  assert.equal(resolved.heightScale, 3);
  assert.equal(resolved.planeSize, 10);
  assert.equal(resolved.backgroundColor, 0x000000);
  assert.equal(resolved.meshColor, 0xffffff);
  assert.equal(resolved.autoRotate, false);
});
