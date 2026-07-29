import assert from "node:assert/strict";
import test from "node:test";
import { createReadOnlyCanvasHandle } from "../dist/internal/read-only-canvas.js";

test("exposes only the immutable Grafting canvas contract and delegates its actions", () => {
  const calls = [];
  const controller = {
    centerContent: () => calls.push("center"),
    dispose: () => calls.push("dispose"),
  };

  const canvas = createReadOnlyCanvasHandle(controller, 3, 2);

  assert.equal(Object.isFrozen(canvas), true);
  assert.deepEqual(Object.keys(canvas).sort(), ["center", "dispose", "edgeCount", "nodeCount"]);
  assert.equal(canvas.nodeCount, 3);
  assert.equal(canvas.edgeCount, 2);
  canvas.center();
  canvas.dispose();
  assert.deepEqual(calls, ["center", "dispose"]);
});
