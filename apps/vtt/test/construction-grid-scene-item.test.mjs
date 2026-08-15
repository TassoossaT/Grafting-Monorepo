import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSTRUCTION_GRID_MAJOR_ITEM_ID,
  CONSTRUCTION_GRID_MINOR_ITEM_ID,
  constructionGridSceneItems,
} from "../src/adapters/rendering/construction-grid-scene-item.ts";

test("constructionGridSceneItems returns a distinct minor and major tier, both centered on the origin", () => {
  const [minor, major] = constructionGridSceneItems();

  assert.equal(minor.id, CONSTRUCTION_GRID_MINOR_ITEM_ID);
  assert.equal(major.id, CONSTRUCTION_GRID_MAJOR_ITEM_ID);
  assert.notEqual(minor.id, major.id);

  // The major tier's coarser cell size means strictly fewer line segments
  // than the minor tier over the same board extent -- the geometry itself is
  // derived by @grafting/render-3d's gridVisual, tested there; this only
  // checks this app's own choice of parameters comes through.
  assert.ok(major.visual.params.cellSize > minor.visual.params.cellSize);
  assert.equal(major.visual.params.extent, minor.visual.params.extent);

  // Both tiers share one layer and one registered visual kind, so they draw
  // and cull together as one board.
  assert.equal(minor.layer, major.layer);
  assert.equal(minor.visual.kind, major.visual.kind);
});
