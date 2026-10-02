import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { buildVisual } from "../dist/backend/three/build-visual.js";

const box = { shape: "box", width: 2, height: 2, depth: 2 };

/** Whether a ray straight down onto the origin hits the object. */
function hitFromAbove(object) {
  object.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
  return raycaster.intersectObject(object).length > 0;
}

test("a pick-only material is never drawn and is still picked", () => {
  const proxy = buildVisual({ geometry: box, material: { surface: "unlit", opacity: 0, depthWrite: false, pickOnly: true } });
  // The renderer skips an invisible material; at opacity 0 alone it was still
  // drawn, as a transparent object, on every frame.
  assert.equal(proxy.object.material.visible, false);
  assert.equal(hitFromAbove(proxy.object), true, "the ray still hits it");
  proxy.dispose();
});

test("a material is drawn unless it says it is only for picking", () => {
  const drawn = buildVisual({ geometry: box, material: { surface: "unlit", opacity: 0 } });
  assert.equal(drawn.object.material.visible, true);
  drawn.dispose();
});
