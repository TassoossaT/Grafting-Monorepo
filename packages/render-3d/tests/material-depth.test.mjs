import assert from "node:assert/strict";
import test from "node:test";

import { buildVisual } from "../dist/backend/three/build-visual.js";

test("material depth policy defaults on and can be disabled for exact overlays", () => {
  const defaultVisual = buildVisual({
    geometry: { shape: "box", width: 1, height: 1, depth: 1 },
    material: { surface: "unlit" },
  });
  assert.equal(defaultVisual.object.material.depthTest, true);
  assert.equal(defaultVisual.object.material.depthWrite, true);
  defaultVisual.dispose();

  const overlayVisual = buildVisual({
    geometry: { shape: "box", width: 1, height: 1, depth: 1 },
    material: { surface: "unlit", opacity: 0.5, depthTest: false, depthWrite: false },
  });
  assert.equal(overlayVisual.object.material.depthTest, false);
  assert.equal(overlayVisual.object.material.depthWrite, false);
  overlayVisual.dispose();
});
