import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createAliasResolveHook } from "./support/alias-resolve-hook.mjs";

registerHooks(createAliasResolveHook(new URL("../src/", import.meta.url)));
const { pointerAtHeight } = await import("../src/composition/tabletop/tools/core/pointer-ray.ts");

// The pointer on (4, 5, 2), seen from a slanted camera.
const camera = { x: 0, y: 12, z: -8 };
const hit = { x: 4, y: 5, z: 2 };
const d = { x: hit.x - camera.x, y: hit.y - camera.y, z: hit.z - camera.z };
const n = Math.hypot(d.x, d.y, d.z);
const ray = { origin: camera, direction: { x: d.x / n, y: d.y / n, z: d.z / n } };
const round = (p) => [p.x, p.y, p.z].map((v) => Math.round(v * 1e6) / 1e6);
/** Where the ray crosses level `y`. */
const down = (y) => { const t = (y - camera.y) / ray.direction.y; return round({ x: camera.x + ray.direction.x * t, y, z: camera.z + ray.direction.z * t }); };

test("a point read on a face standing above its level lands under the cursor, whichever tool reads it", () => {
  const leaf = { normal: { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 }, centre: hit };
  // The hit snapped to the grid, as the table plays: the ray and the face still give the exact spot.
  assert.deepEqual(round(pointerAtHeight({ point: { x: 4, y: 5, z: 2 }, ray, face: leaf }, 3)), [4, 3, 2]);
  assert.deepEqual(round(pointerAtHeight({ point: { x: 4, y: 5, z: 2 }, ray, face: { normal: { x: 0, y: 1, z: 0 }, centre: hit } }, 3)), [4, 3, 2], "a level top in front too");
});

test("anywhere else the ray crosses the level", () => {
  assert.deepEqual(round(pointerAtHeight({ point: hit, ray, face: { normal: { x: 1, y: 0, z: 0 }, centre: hit } }, 3)), down(3), "a wall is looked past");
  assert.deepEqual(round(pointerAtHeight({ point: hit, ray }, 3)), down(3), "no face known");
  assert.deepEqual(round(pointerAtHeight({ point: hit, ray, face: { normal: { x: 0, y: 1, z: 0 }, centre: hit } }, 7)), down(7), "a level above what the pointer is on");
});
