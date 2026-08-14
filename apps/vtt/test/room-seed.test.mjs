import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGenerateRoomOperations,
  layoutNextRoomOrigin,
  ROOM_DEPTH,
  ROOM_HEIGHT,
  ROOM_WIDTH,
} from "../src/composition/tabletop/index.ts";

function context(operationId) {
  return { operationId, tableId: "table-1", initiatedBy: "local" };
}

test("buildGenerateRoomOperations forms a closed rectangle with exactly one door", () => {
  const layout = { origin: { x: 0, y: 0, z: 0 }, width: ROOM_WIDTH, depth: ROOM_DEPTH, height: ROOM_HEIGHT };
  const [south, east, north, west] = buildGenerateRoomOperations(
    "table-1",
    "room-1",
    context("op-1"),
    layout,
    "wall-white",
    "wall-white",
  );

  // Each wall's end must be the next wall's start, closing the loop.
  assert.deepEqual(south.payload.wall.end, east.payload.wall.start);
  assert.deepEqual(east.payload.wall.end, north.payload.wall.start);
  assert.deepEqual(north.payload.wall.end, west.payload.wall.start);
  assert.deepEqual(west.payload.wall.end, south.payload.wall.start);

  const withDoor = [south, east, north, west].filter((op) => op.payload.door !== undefined);
  assert.equal(withDoor.length, 1);
  assert.equal(withDoor[0], south);

  // Every wall shares the same height and the requested wall/door type.
  for (const op of [south, east, north, west]) {
    assert.equal(op.payload.wall.height, ROOM_HEIGHT);
    assert.equal(op.payload.wallType, "wall-white");
  }
});

test("buildGenerateRoomOperations namespaces node/edge ids per side so 4 walls never collide", () => {
  const layout = { origin: { x: 0, y: 0, z: 0 }, width: ROOM_WIDTH, depth: ROOM_DEPTH, height: ROOM_HEIGHT };
  const operations = buildGenerateRoomOperations("table-1", "room-1", context("op-1"), layout, "wall-white", "wall-white");

  const allNodeIds = operations.flatMap((op) => Object.values(op.payload.nodeIds));
  assert.equal(new Set(allNodeIds).size, allNodeIds.length);

  const allOperationIds = operations.map((op) => op.operationId);
  assert.equal(new Set(allOperationIds).size, 4);
});

test("layoutNextRoomOrigin tiles successive rooms without overlapping footprints", () => {
  const origins = [1, 2, 3].map(layoutNextRoomOrigin);
  for (let i = 1; i < origins.length; i += 1) {
    const previousRight = origins[i - 1].x + ROOM_WIDTH;
    assert.ok(origins[i].x >= previousRight, `room ${i} at x=${origins[i].x} must not overlap room ${i - 1} ending at x=${previousRight}`);
  }
});
