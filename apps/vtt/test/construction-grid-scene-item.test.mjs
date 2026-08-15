import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConstructionGridPositions,
  CONSTRUCTION_GRID_MAJOR_ITEM_ID,
  CONSTRUCTION_GRID_MINOR_ITEM_ID,
  constructionGridSceneItems,
} from "../src/adapters/rendering/construction-grid-scene-item.ts";

test("buildConstructionGridPositions produces one line pair per grid step, closed at both bounds", () => {
  const positions = buildConstructionGridPositions(4, 2);
  // extent=4, cellSize=2 -> lines at -4, -2, 0, 2, 4 => 5 lines per axis, 2
  // segments (4 vertices, 12 floats) per line.
  assert.equal(positions.length, 5 * 2 * 2 * 3);

  // Every vertex must land on the grid's Y=0 ground plane.
  for (let i = 1; i < positions.length; i += 3) {
    assert.equal(positions[i], 0);
  }

  // Every vertex must stay within the requested bounds.
  for (let i = 0; i < positions.length; i += 3) {
    assert.ok(positions[i] >= -4 && positions[i] <= 4);
    assert.ok(positions[i + 2] >= -4 && positions[i + 2] <= 4);
  }
});

test("buildConstructionGridPositions rejects non-positive extent or cellSize", () => {
  assert.throws(() => buildConstructionGridPositions(0, 1));
  assert.throws(() => buildConstructionGridPositions(-1, 1));
  assert.throws(() => buildConstructionGridPositions(10, 0));
  assert.throws(() => buildConstructionGridPositions(10, -1));
});

test("constructionGridSceneItems returns a distinct minor and major tier, both centered on the origin", () => {
  const [minor, major] = constructionGridSceneItems();

  assert.equal(minor.id, CONSTRUCTION_GRID_MINOR_ITEM_ID);
  assert.equal(major.id, CONSTRUCTION_GRID_MAJOR_ITEM_ID);
  assert.notEqual(minor.id, major.id);

  // The major tier's coarser cell size means strictly fewer line segments
  // than the minor tier over the same board extent.
  assert.ok(major.visual.params.positions.length < minor.visual.params.positions.length);

  // Both tiers share one layer, so they draw and cull together as one board.
  assert.equal(minor.layer, major.layer);
});
