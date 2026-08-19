import assert from "node:assert/strict";
import test from "node:test";

import { createEditHistoryStack } from "../src/features/edit-construction/index.ts";

/** One completed edit gesture, as the op sequences that reverse and replay it. */
function entry(nodeId, from, to) {
  return {
    kind: "region-edit",
    undo: [{ kind: "move-vertex", nodeId, position: from }],
    redo: [{ kind: "move-vertex", nodeId, position: to }],
  };
}

test("a fresh stack can neither undo nor redo", () => {
  const stack = createEditHistoryStack();
  assert.deepEqual(stack.getState(), { canUndo: false, canRedo: false });
  assert.equal(stack.undo(), undefined);
  assert.equal(stack.redo(), undefined);
});

test("undo returns the entry carrying the pre-edit ops, most recent first", () => {
  const stack = createEditHistoryStack();
  const first = entry("n0", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const second = entry("n0", { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
  stack.record(first);
  stack.record(second);

  assert.equal(stack.undo(), second);
  assert.equal(stack.undo(), first);
  assert.equal(stack.undo(), undefined);
});

test("redo returns the entry carrying the post-edit ops after an undo", () => {
  const stack = createEditHistoryStack();
  const edited = entry("n0", { x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 });
  stack.record(edited);

  stack.undo();
  assert.equal(stack.redo(), edited);
  assert.equal(stack.redo(), undefined);
});

/**
 * A role's cascade moves nodes the gesture never named -- a wall's bottom
 * corner carries its paired top corner by the same delta. An entry that
 * recorded only the grabbed node would leave the panel sheared on undo, so
 * the entry carries every op the transaction actually issued.
 */
test("an entry carries every node a cascade touched, not only the grabbed one", () => {
  const stack = createEditHistoryStack();
  const cascaded = {
    kind: "region-edit",
    undo: [
      { kind: "move-vertex", nodeId: "bottom", position: { x: 0, y: 0, z: 0 } },
      { kind: "move-vertex", nodeId: "top", position: { x: 0, y: 3, z: 0 } },
    ],
    redo: [
      { kind: "move-vertex", nodeId: "bottom", position: { x: 1, y: 0, z: 0 } },
      { kind: "move-vertex", nodeId: "top", position: { x: 1, y: 3, z: 0 } },
    ],
  };
  stack.record(cascaded);

  assert.equal(stack.undo().undo.length, 2);
  assert.equal(stack.redo().redo.length, 2);
});

test("recording a new edit after an undo clears the redo history", () => {
  const stack = createEditHistoryStack();
  stack.record(entry("n0", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }));
  stack.undo();
  assert.equal(stack.getState().canRedo, true);

  stack.record(entry("n0", { x: 0, y: 0, z: 0 }, { x: 9, y: 0, z: 0 }));
  assert.deepEqual(stack.getState(), { canUndo: true, canRedo: false });
  assert.equal(stack.redo(), undefined);
});

test("getState reflects both stacks accurately across a full cycle", () => {
  const stack = createEditHistoryStack();
  assert.deepEqual(stack.getState(), { canUndo: false, canRedo: false });

  stack.record(entry("n0", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }));
  assert.deepEqual(stack.getState(), { canUndo: true, canRedo: false });

  stack.undo();
  assert.deepEqual(stack.getState(), { canUndo: false, canRedo: true });

  stack.redo();
  assert.deepEqual(stack.getState(), { canUndo: true, canRedo: false });
});

test("path-brush operations share the semantic LIFO history with region edits", () => {
  const stack = createEditHistoryStack();
  const edited = entry("n0", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const brush = { kind: "path-brush", operationId: "table-1:path-brush:1" };

  stack.record(edited);
  stack.record(brush);

  assert.equal(stack.undo(), brush);
  assert.equal(stack.undo(), edited);
  assert.equal(stack.redo(), edited);
  assert.equal(stack.redo(), brush);
});
