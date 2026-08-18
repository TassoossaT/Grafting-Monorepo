import assert from "node:assert/strict";
import test from "node:test";

import { createMoveNodeHistoryStack } from "../src/features/edit-construction/index.ts";

function entry(nodeId, from, to) {
  return { nodeId, from, to };
}

test("a fresh stack can neither undo nor redo", () => {
  const stack = createMoveNodeHistoryStack();
  assert.deepEqual(stack.getState(), { canUndo: false, canRedo: false });
  assert.equal(stack.undo(), undefined);
  assert.equal(stack.redo(), undefined);
});

test("undo returns the entry's pre-move position, most recent first", () => {
  const stack = createMoveNodeHistoryStack();
  const first = entry("n0", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const second = entry("n0", { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
  stack.record(first);
  stack.record(second);

  assert.equal(stack.undo(), second);
  assert.equal(stack.undo(), first);
  assert.equal(stack.undo(), undefined);
});

test("redo returns the entry's post-move position after an undo", () => {
  const stack = createMoveNodeHistoryStack();
  const moved = entry("n0", { x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 });
  stack.record(moved);

  stack.undo();
  assert.equal(stack.redo(), moved);
  assert.equal(stack.redo(), undefined);
});

test("recording a new move after an undo clears the redo history", () => {
  const stack = createMoveNodeHistoryStack();
  const original = entry("n0", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  stack.record(original);
  stack.undo();
  assert.equal(stack.getState().canRedo, true);

  stack.record(entry("n0", { x: 0, y: 0, z: 0 }, { x: 9, y: 0, z: 0 }));
  assert.deepEqual(stack.getState(), { canUndo: true, canRedo: false });
  assert.equal(stack.redo(), undefined);
});

test("getState reflects both stacks accurately across a full cycle", () => {
  const stack = createMoveNodeHistoryStack();
  assert.deepEqual(stack.getState(), { canUndo: false, canRedo: false });

  stack.record(entry("n0", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }));
  assert.deepEqual(stack.getState(), { canUndo: true, canRedo: false });

  stack.undo();
  assert.deepEqual(stack.getState(), { canUndo: false, canRedo: true });

  stack.redo();
  assert.deepEqual(stack.getState(), { canUndo: true, canRedo: false });
});
test("path-brush operations share the semantic LIFO history with node moves", () => {
  const stack = createMoveNodeHistoryStack();
  const moved = entry("n0", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const brush = { kind: "path-brush", operationId: "table-1:path-brush:1" };

  stack.record(moved);
  stack.record(brush);

  assert.equal(stack.undo(), brush);
  assert.equal(stack.undo(), moved);
  assert.equal(stack.redo(), moved);
  assert.equal(stack.redo(), brush);
});