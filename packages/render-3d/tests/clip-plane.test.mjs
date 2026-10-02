import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { buildVisual } from "../dist/backend/three/build-visual.js";
import { cutAwayByClip } from "../dist/backend/three/clip-hit.js";

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

test("a clippable sprite attaches the shared clip plane, an ordinary one does not", () => {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const cut = buildVisual({ geometry: { shape: "sprite" }, material: { surface: "unlit", clippable: true } }, plane);
  const kept = buildVisual({ geometry: { shape: "sprite" }, material: { surface: "unlit" } }, plane);

  try {
    assert.deepEqual(cut.object.material.clippingPlanes, [plane]);
    assert.equal(kept.object.material.clippingPlanes, null);
  } finally {
    cut.dispose();
    kept.dispose();
  }
});

test("the object records whether it is clippable, for the picker", () => {
  const cut = buildVisual({ geometry: { shape: "box", width: 1, height: 1, depth: 1 }, material: { surface: "lit", clippable: true } });
  const kept = buildVisual({ geometry: { shape: "box", width: 1, height: 1, depth: 1 }, material: { surface: "lit" } });

  try {
    assert.equal(cut.object.userData.clippable, true);
    assert.equal(kept.object.userData.clippable, false);
  } finally {
    cut.dispose();
    kept.dispose();
  }
});

test("a ray hit above a height cut is cut away; one below it, or on a material that never opted in, is not", () => {
  // Keeps y <= 3, the way the vtt's height cut builds its plane.
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 3);
  const cut = buildVisual({ geometry: { shape: "box", width: 1, height: 1, depth: 1 }, material: { surface: "lit", clippable: true } });
  const kept = buildVisual({ geometry: { shape: "box", width: 1, height: 1, depth: 1 }, material: { surface: "lit" } });
  const above = new THREE.Vector3(0, 4, 0);
  const below = new THREE.Vector3(0, 2, 0);

  try {
    assert.equal(cutAwayByClip(plane, true, cut.object, above), true);
    assert.equal(cutAwayByClip(plane, true, cut.object, below), false);
    assert.equal(cutAwayByClip(plane, true, kept.object, above), false);
    assert.equal(cutAwayByClip(plane, false, cut.object, above), false);
  } finally {
    cut.dispose();
    kept.dispose();
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
