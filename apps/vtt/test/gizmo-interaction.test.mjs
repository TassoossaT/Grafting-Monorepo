import assert from "node:assert/strict";
import test from "node:test";

import { moveNodeTool } from "../src/composition/tabletop/tools/move-node-tool.ts";
import { createMoveNodeHistoryStack } from "../src/features/edit-construction/index.ts";

function createMockContext() {
  const history = createMoveNodeHistoryStack();
  const moved = [];
  const selected = [];

  const runtime = {
    moveNode(nodeId, position, origin, causeId) {
      moved.push({ nodeId, position, origin, causeId });
    },
  };

  return {
    ctx: {
      runtime,
      history,
      tableId: "table-1",
      nextSequence: () => 1,
      reportSelection: (info) => selected.push(info),
    },
    moved,
    selected,
    history,
  };
}

test("moveNodeTool with y-height axis constrains manipulation to vertical elevation (Y) only", () => {
  const { ctx, moved, selected, history } = createMockContext();

  const startSample = {
    point: { x: 5, y: 1.0, z: 8 },
    nodeId: "n-room-1",
    axis: "y-height",
  };

  const moveSample = {
    point: { x: 12, y: 3.5, z: 20 },
    nodeId: "n-room-1",
    axis: "y-height",
  };

  moveNodeTool.onPointerDown(ctx, startSample, {});
  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0], { id: "n-room-1", point: { x: 5, y: 1.0, z: 8 } });

  moveNodeTool.onPointerMove(ctx, { start: startSample, current: moveSample }, {});
  assert.equal(moved.length, 1);
  // (X, Z) remain locked to start (5, 8), Y is updated to 3.5
  assert.deepEqual(moved[0].position, { x: 5, y: 3.5, z: 8 });

  moveNodeTool.onPointerUp(ctx, { start: startSample, current: moveSample }, {});
  const undoEntry = history.undo();
  assert.deepEqual(undoEntry, {
    nodeId: "n-room-1",
    from: { x: 5, y: 1.0, z: 8 },
    to: { x: 5, y: 3.5, z: 8 },
  });
});

test("moveNodeTool with xz-planar axis constrains manipulation to horizontal plane (X, Z) only", () => {
  const { ctx, moved, selected, history } = createMockContext();

  const startSample = {
    point: { x: 5, y: 2.0, z: 8 },
    nodeId: "n-wall-1",
    axis: "xz-planar",
  };

  const moveSample = {
    point: { x: 9, y: 6.5, z: 14 },
    nodeId: "n-wall-1",
    axis: "xz-planar",
  };

  moveNodeTool.onPointerDown(ctx, startSample, {});
  moveNodeTool.onPointerMove(ctx, { start: startSample, current: moveSample }, {});
  assert.equal(moved.length, 1);
  // (X, Z) are updated to (9, 14), Y remains locked to start (2.0)
  assert.deepEqual(moved[0].position, { x: 9, y: 2.0, z: 14 });

  moveNodeTool.onPointerUp(ctx, { start: startSample, current: moveSample }, {});
  const undoEntry = history.undo();
  assert.deepEqual(undoEntry, {
    nodeId: "n-wall-1",
    from: { x: 5, y: 2.0, z: 8 },
    to: { x: 9, y: 2.0, z: 14 },
  });
});

test("moveNodeTool with edge height gizmo (secondaryNodeId) adjusts elevation of both edge endpoints", () => {
  const { ctx, moved, history } = createMockContext();

  const startSample = {
    point: { x: 2, y: 1.0, z: 4 },
    nodeId: "wall-node-a",
    secondaryNodeId: "wall-node-b",
    axis: "y-height",
  };

  const moveSample = {
    point: { x: 2, y: 3.5, z: 4 },
    nodeId: "wall-node-a",
    secondaryNodeId: "wall-node-b",
    axis: "y-height",
  };

  moveNodeTool.onPointerDown(ctx, startSample, {});
  moveNodeTool.onPointerMove(ctx, { start: startSample, current: moveSample }, {});

  // Both node A and node B must be moved to height 3.5m
  assert.equal(moved.length, 2);
  assert.equal(moved[0].nodeId, "wall-node-a");
  assert.deepEqual(moved[0].position, { x: 2, y: 3.5, z: 4 });
  assert.equal(moved[1].nodeId, "wall-node-b");
  assert.deepEqual(moved[1].position, { x: 2, y: 3.5, z: 4 });

  moveNodeTool.onPointerUp(ctx, { start: startSample, current: moveSample }, {});
  assert.equal(history.getState().canUndo, true);
});
