import assert from "node:assert/strict";
import test from "node:test";

import {
  chunkKeyFor,
  clipPlaneForCameraHeight,
} from "../src/adapters/rendering/map-chunk-key.ts";

test("centroids in the same spatial bucket share a chunk key", () => {
  const a = chunkKeyFor({ x: 1, y: 0, z: 1 }, 8);
  const b = chunkKeyFor({ x: 7.9, y: 5, z: 0.1 }, 8);
  assert.equal(a, b, "Y never affects the bucket");
});

test("centroids across a bucket boundary get different chunk keys", () => {
  const a = chunkKeyFor({ x: 7.9, y: 0, z: 0 }, 8);
  const b = chunkKeyFor({ x: 8.1, y: 0, z: 0 }, 8);
  assert.notEqual(a, b);
});

test("negative coordinates bucket toward negative infinity, not toward zero", () => {
  const a = chunkKeyFor({ x: -0.5, y: 0, z: 0 }, 8);
  const b = chunkKeyFor({ x: -7.9, y: 0, z: 0 }, 8);
  assert.equal(a, b, "both fall in the same [-8, 0) bucket");
  assert.notEqual(a, chunkKeyFor({ x: 0.5, y: 0, z: 0 }, 8));
});

test("clipPlaneForCameraHeight keeps geometry at or below the camera and cuts what's above", () => {
  const plane = clipPlaneForCameraHeight(5);
  assert.deepEqual(plane.normal, { x: 0, y: -1, z: 0 });
  assert.equal(plane.constant, 5);

  const keep = (y) => plane.normal.y * y + plane.constant >= 0;
  assert.equal(keep(4), true);
  assert.equal(keep(5), true);
  assert.equal(keep(6), false);
});

test("an offset lowers the clip height below the raw camera Y", () => {
  const plane = clipPlaneForCameraHeight(5, 2);
  assert.equal(plane.constant, 3);
});
