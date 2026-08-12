import assert from "node:assert/strict";
import test from "node:test";

import { createVisualRegistry, heightfieldVisual } from "../dist/index.js";

/**
 * Descriptors are the whole extension surface, so what matters is what a
 * caller can *express* through them. These assert on that, not on rendering.
 */

test("one geometry can be described with different surfaces", () => {
  // The case this exists for: showing that something is there without showing
  // what it is. Points carry silhouette and cannot carry surface detail, so
  // the same field is either observed or merely remembered depending only on
  // which surface it is paired with — no second copy of the data.
  const field = { width: 4, depth: 4, values: new Float32Array(16) };

  const registry = createVisualRegistry();
  registry.register({
    kind: "surface-observed",
    describe: () => ({
      geometry: { shape: "heightfield", field },
      material: { surface: "lit", color: 0x88aa88 },
    }),
  });
  registry.register({
    kind: "surface-remembered",
    describe: () => ({
      geometry: { shape: "heightfield", field },
      material: { surface: "points", size: 0.4, opacity: 0.7 },
    }),
  });

  const observed = registry.get("surface-observed").describe({});
  const remembered = registry.get("surface-remembered").describe({});

  assert.equal(observed.geometry.field, remembered.geometry.field, "same data, not a copy");
  assert.equal(observed.material.surface, "lit");
  assert.equal(remembered.material.surface, "points");
});

test("the heightfield default describes a lit surface sized by its caller", () => {
  const values = new Float32Array(9);
  const descriptor = heightfieldVisual.describe({
    width: 3,
    depth: 3,
    values,
    size: 10,
    elevationScale: 2,
  });

  assert.equal(descriptor.geometry.shape, "heightfield");
  assert.deepEqual(descriptor.geometry.field.size, { x: 10, z: 10 });
  assert.equal(descriptor.geometry.field.elevationScale, 2);
  assert.equal(descriptor.material.surface, "lit");
});

test("the heightfield default compares sample data by reference", () => {
  const values = new Float32Array(9);
  const base = { width: 3, depth: 3, values };

  assert.equal(heightfieldVisual.equals(base, { ...base }), true);
  assert.equal(
    heightfieldVisual.equals(base, { ...base, values: new Float32Array(9) }),
    false,
    "a new array is the caller's signal that the data changed",
  );
});

test("a caller can describe a camera-facing sprite without a renderer type", () => {
  const registry = createVisualRegistry();
  registry.register({
    kind: "camera-facing-marker",
    describe: () => ({
      geometry: { shape: "sprite" },
      material: { surface: "unlit", color: 0x44cc88 },
    }),
  });

  const descriptor = registry.get("camera-facing-marker").describe({});
  assert.deepEqual(descriptor.geometry, { shape: "sprite" });
  assert.equal(descriptor.material.surface, "unlit");
});
