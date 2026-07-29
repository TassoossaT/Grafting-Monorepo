import assert from "node:assert/strict";
import test from "node:test";
import { createReadOnlyCanvasHandle } from "../dist/canvas/handle.js";

const createController = (calls) => {
  let activationListener;
  return {
    controller: {
      centerContent: () => calls.push("center"),
      setSelection: (selection) => calls.push(["selection", selection]),
      subscribeActivation: (listener) => {
        calls.push("subscribe");
        activationListener = listener;
        return () => calls.push("unsubscribe");
      },
      dispose: () => calls.push("dispose"),
    },
    activate: (entity) => activationListener(entity),
  };
};

test("exposes only the immutable Grafting canvas contract and delegates its actions", () => {
  const calls = [];
  const { controller } = createController(calls);
  const canvas = createReadOnlyCanvasHandle(controller, 3, 2);

  assert.equal(Object.isFrozen(canvas), true);
  assert.deepEqual(Object.keys(canvas).sort(), [
    "center",
    "dispose",
    "edgeCount",
    "nodeCount",
    "setSelection",
  ]);
  assert.equal(canvas.nodeCount, 3);
  assert.equal(canvas.edgeCount, 2);
  canvas.center();
  canvas.dispose();
  assert.deepEqual(calls, ["subscribe", "center", "unsubscribe", "dispose"]);
});

test("copies and freezes caller-owned selections before crossing the private boundary", () => {
  const calls = [];
  const { controller } = createController(calls);
  const canvas = createReadOnlyCanvasHandle(controller, 1, 1);
  const callerSelection = { kind: "node", id: "node-1" };

  canvas.setSelection(callerSelection);
  callerSelection.id = "changed-after-call";
  canvas.setSelection(null);

  assert.equal(Object.isFrozen(calls[1][1]), true);
  assert.deepEqual(calls.slice(1), [
    ["selection", { kind: "node", id: "node-1" }],
    ["selection", null],
  ]);
});

test("selects an activated entity before publishing its immutable reference", () => {
  const calls = [];
  const { controller, activate } = createController(calls);
  let publishedEntity;
  const canvas = createReadOnlyCanvasHandle(controller, 1, 1, (entity) => {
    calls.push(["activate", entity]);
    publishedEntity = entity;
  }, true);

  activate({ kind: "edge", id: "edge-1" });

  assert.equal(Object.isFrozen(publishedEntity), true);
  assert.deepEqual(calls, [
    "subscribe",
    ["selection", { kind: "edge", id: "edge-1" }],
    ["activate", { kind: "edge", id: "edge-1" }],
  ]);
  canvas.dispose();
});

test("activation selection is an explicit replaceable policy", () => {
  const calls = [];
  const { controller, activate } = createController(calls);
  const canvas = createReadOnlyCanvasHandle(controller, 1, 0, undefined, true);

  activate({ kind: "node", id: "node-1" });

  assert.deepEqual(calls, [
    "subscribe",
    ["selection", { kind: "node", id: "node-1" }],
  ]);
  canvas.dispose();
});

test("publishes activation even if the private visual selection fails", () => {
  const calls = [];
  let activationListener;
  const canvas = createReadOnlyCanvasHandle(
    {
      centerContent: () => undefined,
      setSelection: () => {
        calls.push("selection-failed");
        throw new Error("private highlight failed");
      },
      subscribeActivation: (listener) => {
        activationListener = listener;
        return () => undefined;
      },
      dispose: () => undefined,
    },
    1,
    0,
    (entity) => calls.push(["activate", entity]),
    true,
  );

  assert.throws(
    () => activationListener({ kind: "node", id: "node-1" }),
    /private highlight failed/,
  );
  assert.deepEqual(calls, [
    "selection-failed",
    ["activate", { kind: "node", id: "node-1" }],
  ]);
  canvas.dispose();
});

test("disposal is idempotent, unsubscribes first, and rejects later operations", () => {
  const calls = [];
  const { controller, activate } = createController(calls);
  const canvas = createReadOnlyCanvasHandle(controller, 1, 0, () => calls.push("activate"));

  canvas.dispose();
  canvas.dispose();
  activate({ kind: "node", id: "node-after-dispose" });

  assert.throws(() => canvas.center(), /read-only canvas has been disposed/);
  assert.throws(
    () => canvas.setSelection({ kind: "node", id: "node-after-dispose" }),
    /read-only canvas has been disposed/,
  );
  assert.deepEqual(calls, ["subscribe", "unsubscribe", "dispose"]);
});
