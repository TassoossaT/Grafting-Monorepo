import assert from "node:assert/strict";
import test from "node:test";

import {
  chunkKeyForSurface,
  chunkSurfaceMeshes,
  mergeChunkBucket,
} from "../src/adapters/rendering/map-chunk-batching.ts";
import { resolveSurfaceCovering } from "../src/entities/map/surface-covering.ts";

/** A unit quad centred on `x`/`z`, small enough that neighbours share a spatial bucket. */
const quadAt = (x, z, surfaceType, physical = true) => ({
  surfaceKey: [`${surfaceType}-${x}-${z}`],
  surfaceType,
  physical,
  mesh: {
    positions: new Float32Array([x, 0, z, x + 0.1, 0, z, x, 0, z + 0.1]),
    indices: new Uint16Array([0, 1, 2]),
  },
});

test("surfaces at the same position but with different coverings land in different chunks", () => {
  const wall = quadAt(0, 0, "wall");
  const terrain = quadAt(0, 0, "terrain");

  assert.notEqual(
    chunkKeyForSurface(wall, resolveSurfaceCovering),
    chunkKeyForSurface(terrain, resolveSurfaceCovering),
    "a wall and a terrain cell in one bucket must not merge into a single buffer",
  );
});

test("surfaces sharing a covering and a bucket still merge into one chunk", () => {
  const a = quadAt(0, 0, "terrain");
  const b = quadAt(0.2, 0.2, "terrain");

  assert.equal(
    chunkKeyForSurface(a, resolveSurfaceCovering),
    chunkKeyForSurface(b, resolveSurfaceCovering),
    "splitting by covering must not defeat spatial batching for identical surfaces",
  );

  const chunks = chunkSurfaceMeshes([a, b], resolveSurfaceCovering);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].mesh.positions.length, 18, "both quads present in one buffer");
});

test("a bucket mixing surface types produces one correctly-classified chunk each", () => {
  const chunks = chunkSurfaceMeshes(
    [quadAt(0, 0, "wall"), quadAt(0.1, 0.1, "terrain")],
    resolveSurfaceCovering,
  );

  assert.equal(chunks.length, 2, "one chunk per covering, not one chunk for both");

  const colors = chunks.map((chunk) => chunk.covering.color).sort();
  const expected = [
    resolveSurfaceCovering("wall", true).color,
    resolveSurfaceCovering("terrain", true).color,
  ].sort();
  assert.deepEqual(colors, expected, "neither surface inherits the other's appearance");
});

test("an empty bucket yields no chunk, so the caller removes it instead of upserting", () => {
  assert.equal(mergeChunkBucket("0:0", [], resolveSurfaceCovering), undefined);
});
