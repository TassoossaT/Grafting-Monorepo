import assert from "node:assert/strict";
import test from "node:test";

import { resolveBrushShape } from "../src/features/edit-construction/tools/brush-shape-params.ts";

test("circle, square, and hexagon UI parameters resolve to the shared brush contract", () => {
  assert.deepEqual(resolveBrushShape({ shape: "circle", radius: 1.25, rotationDegrees: 90 }), {
    kind: "circle",
    radius: 1.25,
  });
  assert.deepEqual(resolveBrushShape({ shape: "square", radius: 1.5, rotationDegrees: 90 }), {
    kind: "square",
    size: 3,
    rotationRadians: Math.PI / 2,
  });
  assert.deepEqual(resolveBrushShape({ shape: "hexagon", radius: 2, rotationDegrees: 30 }), {
    kind: "hexagon",
    radius: 2,
    rotationRadians: Math.PI / 6,
  });
});