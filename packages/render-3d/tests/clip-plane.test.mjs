import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { buildVisual } from "../dist/backend/three/build-visual.js";

/**
 * `clippable` is opt-in per material, so a caller that never asks for it
 * (every existing consumer, today) must see no behavior change at all.
 */

test("a clippable lit material attaches the shared clip plane", () => {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const visual = buildVisual(
    {
      geometry: { shape: "box", width: 1, height: 1, depth: 1 },
      material: { surface: "lit", clippable: true },
    },
    plane,
  );

  try {
    assert.deepEqual(visual.object.material.clippingPlanes, [plane]);
  } finally {
    visual.dispose();
  }
});

test("a clippable unlit material attaches the shared clip plane", () => {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const visual = buildVisual(
    {
      geometry: { shape: "box", width: 1, height: 1, depth: 1 },
      material: { surface: "unlit", clippable: true },
    },
    plane,
  );

  try {
    assert.deepEqual(visual.object.material.clippingPlanes, [plane]);
  } finally {
    visual.dispose();
  }
});

test("a material that does not opt in is never clipped, even when a plane is supplied", () => {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const visual = buildVisual(
    {
      geometry: { shape: "box", width: 1, height: 1, depth: 1 },
      material: { surface: "lit" },
    },
    plane,
  );

  try {
    assert.equal(visual.object.material.clippingPlanes, null);
  } finally {
    visual.dispose();
  }
});

test("a clippable material built without a plane in scope stays unclipped", () => {
  const visual = buildVisual({
    geometry: { shape: "box", width: 1, height: 1, depth: 1 },
    material: { surface: "lit", clippable: true },
  });

  try {
    assert.equal(visual.object.material.clippingPlanes, null);
  } finally {
    visual.dispose();
  }
});

test("mutating the shared plane in place is visible to an already-built material", () => {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const visual = buildVisual(
    {
      geometry: { shape: "box", width: 1, height: 1, depth: 1 },
      material: { surface: "lit", clippable: true },
    },
    plane,
  );

  try {
    plane.constant = 5;
    assert.equal(visual.object.material.clippingPlanes[0].constant, 5);
  } finally {
    visual.dispose();
  }
});
