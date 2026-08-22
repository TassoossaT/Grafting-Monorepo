import assert from "node:assert/strict";
import test from "node:test";

import {
  MAP_LAYER_ID,
  MAP_SURFACE_VISUAL_KIND,
  mapChunkSceneItem,
} from "../src/adapters/rendering/map-chunk-scene-item.ts";
import {
  PAINTED_COVERING_KIND,
  colorForSurfaceType,
  resolveSurfaceCovering,
} from "../src/entities/map/surface-covering.ts";

test("the VTT adapter names the product while the renderer receives generic mesh data", () => {
  const mesh = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    indices: new Uint16Array([0, 1, 2]),
  };
  const item = mapChunkSceneItem({
    chunkId: "0:0",
    surfaceType: "terrain",
    physical: true,
    covering: resolveSurfaceCovering("terrain", true),
    mesh,
  });

  assert.equal(item.id, "map-chunk:0:0");
  assert.equal(item.layer, MAP_LAYER_ID);
  assert.equal(item.visual.kind, MAP_SURFACE_VISUAL_KIND);
  assert.equal(item.visual.params.mesh, mesh, "no copy of the mesh buffers");
  assert.equal(item.visual.params.color, colorForSurfaceType("terrain", true));
  assert.deepEqual(item.data, { entity: "map-chunk", chunkId: "0:0" });
});

test("the adapter draws the covering it is handed and derives nothing", () => {
  const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]) };
  const item = mapChunkSceneItem({
    chunkId: "1:1",
    surfaceType: "terrain",
    physical: true,
    // Deliberately inconsistent with `surfaceType`: the adapter must not
    // second-guess the resolved covering by re-deriving a color of its own.
    covering: { kind: PAINTED_COVERING_KIND, color: 0x123456 },
    mesh,
  });

  assert.equal(item.visual.params.color, 0x123456);
});

test("non-physical geometry gets a distinct color regardless of surface type", () => {
  assert.equal(colorForSurfaceType("terrain", false), colorForSurfaceType("wall", false));
  assert.notEqual(colorForSurfaceType("terrain", true), colorForSurfaceType("terrain", false));
});

test("physical wall and terrain surfaces are visually distinguishable", () => {
  assert.notEqual(colorForSurfaceType("wall", true), colorForSurfaceType("terrain", true));
});

test("every surface currently resolves to the painted covering, preserving prior behaviour", () => {
  for (const [type, physical] of [
    ["terrain", true],
    ["wall", true],
    ["path", true],
    ["unknown-type", false],
  ]) {
    const covering = resolveSurfaceCovering(type, physical);
    assert.equal(covering.kind, PAINTED_COVERING_KIND);
    assert.equal(covering.color, colorForSurfaceType(type, physical));
  }
});

test("coverings that render differently do not share a batching key", () => {
  const wall = resolveSurfaceCovering("wall", true);
  const terrain = resolveSurfaceCovering("terrain", true);

  assert.notEqual(wall.key, terrain.key, "a wall and a terrain cell must not merge into one buffer");
  assert.equal(
    terrain.key,
    resolveSurfaceCovering("terrain", true).key,
    "the same classification must resolve to the same key so chunks stay mergeable",
  );
});
