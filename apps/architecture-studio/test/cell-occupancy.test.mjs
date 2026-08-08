import assert from "node:assert/strict";
import test from "node:test";

import {
  occupancyFromHeights,
  occupancyOf,
  runBelow,
  withCell,
  withoutCell,
} from "../src/vtt/cell-occupancy.ts";

test("heights seed a contiguous column from the ground up", () => {
  const occupancy = occupancyFromHeights([3, 0, 1]);
  assert.deepEqual(occupancy.layersOf(0), [0, 1, 2]);
  assert.deepEqual(occupancy.layersOf(1), []);
  assert.deepEqual(occupancy.layersOf(2), [0]);
  assert.equal(occupancy.layerCount, 3);
  assert.equal(occupancy.size, 4);
  assert.equal(occupancy.quadCount, 3);
});

test("an occupancy holds gaps a height could never describe", () => {
  const occupancy = occupancyOf([[0, 2, 5]]);
  assert.ok(occupancy.has(0, 0));
  assert.ok(!occupancy.has(0, 1), "the gap under the overhang");
  assert.ok(occupancy.has(0, 5));
  assert.equal(occupancy.layerCount, 6, "one past the highest occupied layer");
});

test("layers are deduplicated and sorted, so a cell id is stable", () => {
  assert.deepEqual(occupancyOf([[3, 1, 1, 0]]).layersOf(0), [0, 1, 3]);
});

test("out of range is empty rather than an error", () => {
  const occupancy = occupancyFromHeights([2]);
  assert.ok(!occupancy.has(0, -1), "below the floor is not occupied");
  assert.ok(!occupancy.has(0, 99));
  assert.ok(!occupancy.has(7, 0));
  assert.deepEqual(occupancy.layersOf(7), []);
});

test("cells enumerate quad-major and layer-ascending", () => {
  assert.deepEqual(
    [...occupancyOf([[1, 0], [], [2]]).cells()],
    [
      { quad: 0, layer: 0 },
      { quad: 0, layer: 1 },
      { quad: 2, layer: 2 },
    ],
  );
});

test("adding a cell is the click that builds, and leaves the rest alone", () => {
  const before = occupancyFromHeights([1, 1]);
  const after = withCell(before, 0, 4);
  assert.ok(after.has(0, 4));
  assert.ok(!before.has(0, 4), "the original is untouched");
  assert.deepEqual(after.layersOf(1), [0]);
  assert.equal(after.size, before.size + 1);
  assert.equal(withCell(after, 0, 4), after, "adding what is there changes nothing");
});

test("removing a cell is the click that digs", () => {
  const before = occupancyFromHeights([3]);
  const after = withoutCell(before, 0, 1);
  assert.deepEqual(after.layersOf(0), [0, 2], "and the column now overhangs");
  assert.equal(withoutCell(after, 0, 1), after, "removing what is absent changes nothing");
});

test("editing a quad the occupancy does not have is refused", () => {
  assert.throws(() => withCell(occupancyFromHeights([1]), 5, 0), RangeError);
});

test("a height that is not a count is refused", () => {
  assert.throws(() => occupancyFromHeights([-1]), RangeError);
  assert.throws(() => occupancyFromHeights([1.5]), RangeError);
  assert.throws(() => occupancyOf([[0, -2]]), RangeError);
});

test("the run below a cell is how far its sides must reach", () => {
  const ground = occupancyFromHeights([4]);
  assert.equal(runBelow(ground, 0, 3), 3, "ordinary ground closes to the floor");
  assert.equal(runBelow(ground, 0, 0), 0);

  const overhang = occupancyOf([[0, 3, 4]]);
  assert.equal(runBelow(overhang, 0, 4), 1, "an overhang stops at its own underside");
  assert.equal(runBelow(overhang, 0, 3), 0);
});
