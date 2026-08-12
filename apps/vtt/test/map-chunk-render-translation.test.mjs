import assert from "node:assert/strict";
import test from "node:test";

import {
  MAP_LAYER_ID,
  MAP_SURFACE_VISUAL_KIND,
  colorForSurfaceType,
  mapChunkSceneItem,
} from "../src/adapters/rendering/map-chunk-scene-item.ts";

test("the VTT adapter names the product while the renderer receives generic mesh data", () => {
  const mesh = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    indices: new Uint16Array([0, 1, 2]),
  };
  const item = mapChunkSceneItem({ chunkId: "0:0", surfaceType: "terrain", physical: true, mesh });

  assert.equal(item.id, "map-chunk:0:0");
  assert.equal(item.layer, MAP_LAYER_ID);
  assert.equal(item.visual.kind, MAP_SURFACE_VISUAL_KIND);
  assert.equal(item.visual.params.mesh, mesh, "no copy of the mesh buffers");
  assert.equal(item.visual.params.color, colorForSurfaceType("terrain", true));
  assert.deepEqual(item.data, { entity: "map-chunk", chunkId: "0:0" });
});

test("non-physical geometry gets a distinct color regardless of surface type", () => {
  assert.equal(colorForSurfaceType("terrain", false), colorForSurfaceType("wall", false));
  assert.notEqual(colorForSurfaceType("terrain", true), colorForSurfaceType("terrain", false));
});

test("physical wall and terrain surfaces are visually distinguishable", () => {
  assert.notEqual(colorForSurfaceType("wall", true), colorForSurfaceType("terrain", true));
});
