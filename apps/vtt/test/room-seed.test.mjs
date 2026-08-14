import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGenerateRoomOperations,
  layoutNextRoomOrigin,
  roomVariantForIndex,
} from "../src/composition/tabletop/index.ts";

const MAX_ROOM_WIDTH = 6;

function context(operationId) {
  return { operationId, tableId: "table-1", initiatedBy: "local" };
}

test("buildGenerateRoomOperations forms a closed rectangle with exactly one door", () => {
  const origin = { x: 0, y: 0, z: 0 };
  const variant = roomVariantForIndex(1);
  const [south, east, north, west] = buildGenerateRoomOperations(
    "table-1",
    "room-1",
    context("op-1"),
    origin,
    variant,
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

  // Every wall shares the variant's height and the requested wall/door type.
  for (const op of [south, east, north, west]) {
    assert.equal(op.payload.wall.height, variant.height);
    assert.equal(op.payload.wallType, "wall-white");
  }
});

test("buildGenerateRoomOperations namespaces node/edge ids per side so 4 walls never collide", () => {
  const origin = { x: 0, y: 0, z: 0 };
  const variant = roomVariantForIndex(1);
  const operations = buildGenerateRoomOperations("table-1", "room-1", context("op-1"), origin, variant, "wall-white", "wall-white");

  const allNodeIds = operations.flatMap((op) => Object.values(op.payload.nodeIds));
  assert.equal(new Set(allNodeIds).size, allNodeIds.length);

  const allOperationIds = operations.map((op) => op.operationId);
  assert.equal(new Set(allOperationIds).size, 4);
});

test("layoutNextRoomOrigin tiles successive rooms without overlapping footprints", () => {
  const origins = [1, 2, 3].map(layoutNextRoomOrigin);
  for (let i = 1; i < origins.length; i += 1) {
    // Widest possible room, not just this room's actual width, since the
    // stride is fixed independent of the variant -- see room-seed.ts.
    const previousRight = origins[i - 1].x + MAX_ROOM_WIDTH;
    assert.ok(origins[i].x >= previousRight, `room ${i} at x=${origins[i].x} must not overlap room ${i - 1} ending at x=${previousRight}`);
  }
});

test("roomVariantForIndex is deterministic for a given index", () => {
  const a = roomVariantForIndex(7);
  const b = roomVariantForIndex(7);
  assert.deepEqual(a, b);
});

test("roomVariantForIndex differs across indices", () => {
  const a = roomVariantForIndex(1);
  const b = roomVariantForIndex(2);
  assert.notDeepEqual(a, b);
});

test("roomVariantForIndex keeps width/depth within the stride's bound and the door within (0, 1)", () => {
  for (let index = 1; index <= 20; index += 1) {
    const variant = roomVariantForIndex(index);
    assert.ok(variant.width > 0 && variant.width <= MAX_ROOM_WIDTH, `width ${variant.width} out of bounds at index ${index}`);
    assert.ok(variant.depth > 0 && variant.depth <= MAX_ROOM_WIDTH, `depth ${variant.depth} out of bounds at index ${index}`);
    assert.ok(variant.height > 0, `height ${variant.height} out of bounds at index ${index}`);
    assert.ok(variant.door.opensAt >= 0 && variant.door.opensAt < variant.door.closesAt, `door opening invalid at index ${index}`);
    assert.ok(variant.door.closesAt <= 1, `door opening invalid at index ${index}`);
  }
});
