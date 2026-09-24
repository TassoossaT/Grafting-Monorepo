import assert from "node:assert/strict";
import test from "node:test";

import { buildVisual } from "../dist/backend/three/build-visual.js";

test("the private backend realizes sprite geometry as a camera-facing sprite", () => {
  const visual = buildVisual({
    geometry: { shape: "sprite" },
    material: { surface: "unlit", color: 0x44cc88 },
  });

  try {
    assert.equal(visual.object.type, "Sprite");
    assert.equal(visual.object.isSprite, true);
  } finally {
    visual.dispose();
  }
});

test("sprite geometry rejects materials whose semantics it cannot preserve", () => {
  assert.throws(
    () =>
      buildVisual({
        geometry: { shape: "sprite" },
        material: { surface: "lit" },
      }),
    /requires an "unlit" material/,
  );
});
