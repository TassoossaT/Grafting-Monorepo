import assert from "node:assert/strict";
import test from "node:test";

import {
  MAP_SURFACE_PICK_LAYER_ID,
  MAP_SURFACE_PICK_VISUAL_KIND,
  mapSurfacePickSceneItem,
  mapSurfacePickSceneItemId,
} from "../src/adapters/rendering/map-surface-pick-scene-item.ts";

test("each semantic surface has an invisible pick proxy carrying its SurfaceRef", () => {
  const mesh = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    indices: new Uint16Array([0, 1, 2]),
  };
  const surfaceRef = "surface:a|b|c";
  const item = mapSurfacePickSceneItem(surfaceRef, mesh);

  assert.equal(item.id, mapSurfacePickSceneItemId(surfaceRef));
  assert.equal(item.layer, MAP_SURFACE_PICK_LAYER_ID);
  assert.equal(item.visual.kind, MAP_SURFACE_PICK_VISUAL_KIND);
  assert.equal(item.visual.params.mesh, mesh);
  assert.deepEqual(item.data, { entity: "map-surface-pick", surfaceRef });
  assert.equal(Object.isFrozen(item.data), true);
});