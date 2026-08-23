import assert from "node:assert/strict";
import test from "node:test";

import { pathFormationFor } from "../src/features/edit-construction/path-recipe.ts";
import { createPathBrushEffect } from "../src/features/edit-construction/surface-edit-contract.ts";

const context = { operationId: "path-1", tableId: "table-1", initiatedBy: "gm-1" };
const payload = {
  brushShape: { kind: "circle", radius: 2 },
  brushRegion: { samples: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] },
  parameters: { kind: "road", profile: [{ lateralOffset: -2, elevation: 0.2 }, { lateralOffset: -1, elevation: 0 }, { lateralOffset: 1, elevation: 0 }, { lateralOffset: 2, elevation: 0.2 }], maxSegmentLength: 0.5, miterLimit: 4 },
};

test("path brush is one frozen semantic effect with a local scope", () => {
  const effect = createPathBrushEffect(payload, context, [{ scope: "surface:terrain", revision: 4 }]);
  assert.equal(effect.kind, "surface.path-brush@1");
  assert.equal(effect.targetScope, "brush-region");
  assert.equal(Object.isFrozen(effect), true);
  assert.equal(Object.isFrozen(effect.brushRegion.samples), true);
  assert.equal(Object.isFrozen(effect.parameters.profile), true);
  assert.deepEqual(effect.expected, [{ scope: "surface:terrain", revision: 4 }]);
});

test("alternate footprints remain representable without renderer types", () => {
  const effect = createPathBrushEffect({ ...payload, brushShape: { kind: "hexagon", radius: 2, rotationRadians: Math.PI / 6 } }, context);
  assert.deepEqual(effect.brushShape, { kind: "hexagon", radius: 2, rotationRadians: Math.PI / 6 });
});

test("invalid gestures and formation values fail before a boundary call", () => {
  assert.throws(() => createPathBrushEffect({ ...payload, brushRegion: { samples: [] } }, context), /must not be empty/);
  assert.throws(() => createPathBrushEffect({ ...payload, parameters: { ...payload.parameters, profile: [{ lateralOffset: -1, elevation: 0 }, { lateralOffset: 1, elevation: -0.1 }] } }, context), /must not be negative/);
});

test("VTT recipes choose the cross-section without constructing geometry", () => {
  const common = { shape: "circle", radius: 1, rotationDegrees: 0, bedWidth: 4, shoulderWidth: 1, shoulderHeight: 0.2, maxSegmentLength: 0.5, miterLimit: 4 };
  assert.deepEqual(pathFormationFor({ ...common, pathKind: "street" }).profile, [{ lateralOffset: -2, elevation: 0 }, { lateralOffset: 2, elevation: 0 }]);
  assert.deepEqual(pathFormationFor({ ...common, pathKind: "road" }).profile, [{ lateralOffset: -3, elevation: 0.2 }, { lateralOffset: -2, elevation: 0 }, { lateralOffset: 2, elevation: 0 }, { lateralOffset: 3, elevation: 0.2 }]);
});
