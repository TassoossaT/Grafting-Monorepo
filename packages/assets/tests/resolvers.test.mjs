import assert from "node:assert/strict";
import test from "node:test";

import {
  IN_MEMORY_IMAGE_KIND,
  PRIMITIVE_MESH_KIND,
  createAssetStore,
  inMemoryImageResolver,
  primitiveMeshResolver,
  resourceRef,
} from "../dist/index.js";

const provenance = { origin: "generated", license: "NONE" };

test("a box is loadable with no file, no network and no dependency", async () => {
  const store = createAssetStore();
  store.registerResolver(primitiveMeshResolver);
  const ref = resourceRef("unit/brick");
  store.define({
    ref,
    kind: PRIMITIVE_MESH_KIND,
    revision: 1,
    source: { shape: "box", width: 0.2, height: 0.1, depth: 0.1 },
    provenance,
  });

  const mesh = await store.acquire(ref).whenReady();

  assert.equal(mesh.positions.length, 24 * 3, "six faces of four vertices, not shared corners");
  assert.equal(mesh.indices.length, 36);
  assert.equal(mesh.uvs.length, 24 * 2, "UVs are present, so a texture can be applied");
  assert.deepEqual(mesh.bounds.min, { x: -0.1, y: -0.05, z: -0.05 });
  assert.deepEqual(mesh.bounds.max, { x: 0.1, y: 0.05, z: 0.05 });
});

test("box faces carry outward normals rather than inheriting one", async () => {
  const store = createAssetStore();
  store.registerResolver(primitiveMeshResolver);
  const ref = resourceRef("unit/cube");
  store.define({
    ref,
    kind: PRIMITIVE_MESH_KIND,
    revision: 1,
    source: { shape: "box", width: 2, height: 2, depth: 2 },
    provenance,
  });

  const mesh = await store.acquire(ref).whenReady();
  const distinct = new Set();
  for (let vertex = 0; vertex < 24; vertex += 1) {
    distinct.add(
      `${mesh.normals[vertex * 3]},${mesh.normals[vertex * 3 + 1]},${mesh.normals[vertex * 3 + 2]}`,
    );
  }
  assert.equal(distinct.size, 6, "one normal per face");
});

test("a plane lies flat and is a single quad", async () => {
  const store = createAssetStore();
  store.registerResolver(primitiveMeshResolver);
  const ref = resourceRef("unit/tile");
  store.define({
    ref,
    kind: PRIMITIVE_MESH_KIND,
    revision: 1,
    source: { shape: "plane", width: 1, depth: 1 },
    provenance,
  });

  const mesh = await store.acquire(ref).whenReady();
  assert.equal(mesh.indices.length, 6);
  for (let vertex = 0; vertex < 4; vertex += 1) {
    assert.equal(mesh.positions[vertex * 3 + 1], 0, "every vertex sits on the ground plane");
  }
});

test("a primitive definition with no source fails rather than producing empty geometry", async () => {
  const store = createAssetStore();
  store.registerResolver(primitiveMeshResolver);
  const ref = resourceRef("unit/broken");
  store.define({ ref, kind: PRIMITIVE_MESH_KIND, revision: 1, source: undefined, provenance });

  await assert.rejects(() => store.acquire(ref).whenReady(), /declares no primitive source/);
  assert.equal(store.status(ref).state, "failed");
});

test("an adopted image is closed on disposal, not merely dropped", async () => {
  const store = createAssetStore();
  store.registerResolver(inMemoryImageResolver);
  const ref = resourceRef("texture/stone");

  // Stands in for an `ImageBitmap`: the representation `.glb` textures decode
  // to, and the one three.js leaks by not closing (mrdoob/three.js#23953).
  let closed = 0;
  const bitmap = {
    close: () => {
      closed += 1;
    },
  };

  store.define({
    ref,
    kind: IN_MEMORY_IMAGE_KIND,
    revision: 1,
    source: { source: bitmap, width: 2048, height: 2048 },
    provenance,
  });

  const handle = store.acquire(ref);
  const image = await handle.whenReady();
  assert.equal(image.form, "decoded");
  assert.equal(image.colorSpace, "srgb", "colour textures default to sRGB");
  assert.equal(store.status(ref).bytes, 2048 * 2048 * 4, "cost is the decoded size, not a file size");

  handle.release();
  assert.equal(closed, 1, "the bitmap is closed exactly once");
});

test("an image source that cannot be closed is disposed without error", async () => {
  const store = createAssetStore();
  store.registerResolver(inMemoryImageResolver);
  const ref = resourceRef("texture/canvas");
  store.define({
    ref,
    kind: IN_MEMORY_IMAGE_KIND,
    revision: 1,
    source: { source: { width: 4, height: 4 }, width: 4, height: 4, colorSpace: "linear" },
    provenance,
  });

  const handle = store.acquire(ref);
  const image = await handle.whenReady();
  assert.equal(image.colorSpace, "linear");
  handle.release();
  assert.deepEqual(store.status(ref), { state: "idle" });
});
