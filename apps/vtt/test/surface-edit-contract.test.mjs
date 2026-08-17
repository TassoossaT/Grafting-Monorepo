import assert from "node:assert/strict";
import test from "node:test";

import { createPathBrushEffect } from "../src/features/edit-construction/surface-edit-contract.ts";

const context = { operationId: "path-1", tableId: "table-1", initiatedBy: "gm-1" };
const payload = {
  brushShape: { kind: "circle", radius: 2 },
  brushRegion: { samples: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] },
  parameters: { width: 2, depth: 0.25, falloff: 0.5, strength: 1 },
};

test("path brush is one frozen semantic effect with a local scope", () => {
  const effect = createPathBrushEffect(payload, context, [{ scope: "surface:terrain", revision: 4 }]);
  assert.equal(effect.kind, "surface.path-brush@1");
  assert.equal(effect.targetScope, "brush-region");
  assert.equal(Object.isFrozen(effect), true);
  assert.equal(Object.isFrozen(effect.brushRegion.samples), true);
  assert.deepEqual(effect.expected, [{ scope: "surface:terrain", revision: 4 }]);
});

test("alternate footprints remain representable without renderer types", () => {
  const effect = createPathBrushEffect({ ...payload, brushShape: { kind: "hexagon", radius: 2, rotationRadians: Math.PI / 6 } }, context);
  assert.deepEqual(effect.brushShape, { kind: "hexagon", radius: 2, rotationRadians: Math.PI / 6 });
});

test("invalid gestures and formation values fail before a boundary call", () => {
  assert.throws(() => createPathBrushEffect({ ...payload, brushRegion: { samples: [] } }, context), /must not be empty/);
  assert.throws(() => createPathBrushEffect({ ...payload, parameters: { ...payload.parameters, depth: 0 } }, context), /must be positive/);
});
