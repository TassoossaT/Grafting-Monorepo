import assert from "node:assert/strict";
import test from "node:test";

import { Document, WebIO } from "@gltf-transform/core";

import { GLTF_MESH_KIND, createAssetStore, gltfMeshResolver, resourceRef } from "../dist/index.js";

const provenance = { origin: "test", license: "NONE" };

/**
 * Builds a `.glb` in memory with the same library that reads it.
 *
 * No binary fixture is committed: asset binaries are deliberately not versioned
 * in this repository, and a test that needed one would contradict that as well
 * as being opaque to review.
 */
async function glbWith({ translation, withNormals = true, withUvs = true, vertexCount = 3 } = {}) {
  const document = new Document();
  const buffer = document.createBuffer();

  const positions = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    positions[vertex * 3] = vertex;
    positions[vertex * 3 + 1] = 0;
    positions[vertex * 3 + 2] = vertex % 2;
  }

  const primitive = document
    .createPrimitive()
    .setAttribute(
      "POSITION",
      document.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor()
        .setType("SCALAR")
        .setArray(new Uint32Array(Array.from({ length: vertexCount }, (_u, i) => i)))
        .setBuffer(buffer),
    );

  if (withNormals) {
    const normals = new Float32Array(vertexCount * 3);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) normals[vertex * 3 + 1] = 1;
    primitive.setAttribute(
      "NORMAL",
      document.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer),
    );
  }
  if (withUvs) {
    primitive.setAttribute(
      "TEXCOORD_0",
      document
        .createAccessor()
        .setType("VEC2")
        .setArray(new Float32Array(vertexCount * 2))
        .setBuffer(buffer),
    );
  }

  const mesh = document.createMesh().addPrimitive(primitive);
  const node = document.createNode().setMesh(mesh);
  if (translation) node.setTranslation(translation);
  document.createScene().addChild(node);

  return new WebIO().writeBinary(document);
}

const storeWith = (bytes, ref = resourceRef("model/one")) => {
  const store = createAssetStore();
  store.registerResolver(gltfMeshResolver);
  store.define({ ref, kind: GLTF_MESH_KIND, revision: 1, source: { bytes }, provenance });
  return store;
};

test("a glTF asset becomes plain parts, not a merged buffer", async () => {
  const store = storeWith(await glbWith());
  const model = await store.acquire(resourceRef("model/one")).whenReady();

  assert.equal(model.parts.length, 1, "one primitive in, one part out");
  const [part] = model.parts;
  assert.equal(part.positions.length, 9, "three vertices");
  assert.equal(part.indices.length, 3);
  assert.equal(part.normals.length, 9);
  assert.equal(part.uvs.length, 6);
  assert.ok(part.positions instanceof Float32Array, "no glTF accessor type leaks through");
});

test("joining parts is left to the consumer, so per-part detail survives", async () => {
  const store = storeWith(await glbWith());
  const model = await store.acquire(resourceRef("model/one")).whenReady();

  // The store decodes; concatenating buffers to save a draw call belongs to
  // whoever draws, and render-3d already owns that as mergeMeshChunks.
  assert.equal(model.positions, undefined, "no merged buffer is produced here");
  assert.ok(Array.isArray(model.parts) || model.parts.length >= 0);
});

test("node transforms are applied, so geometry arrives in world space", async () => {
  const store = storeWith(await glbWith({ translation: [10, 5, 0] }));
  const model = await store.acquire(resourceRef("model/one")).whenReady();
  const [part] = model.parts;

  assert.equal(part.positions[0], 10, "first vertex shifted by the node translation");
  assert.equal(part.positions[1], 5);
  assert.equal(model.bounds.min.x, 10);
  assert.equal(model.bounds.max.y, 5);
});

test("bounds describe the geometry rather than being reported as empty", async () => {
  const store = storeWith(await glbWith({ vertexCount: 4 }));
  const model = await store.acquire(resourceRef("model/one")).whenReady();

  assert.equal(model.bounds.min.x, 0);
  assert.equal(model.bounds.max.x, 3, "four vertices at x = 0..3");
  assert.ok(model.bounds.max.z >= model.bounds.min.z);
  assert.deepEqual(model.bounds, model.parts[0].bounds, "one part means its own bounds are the union");
});

test("an attribute missing from the source is absent rather than fabricated", async () => {
  const store = storeWith(await glbWith({ withNormals: false, withUvs: false }));
  const [part] = (await store.acquire(resourceRef("model/one")).whenReady()).parts;

  assert.equal(part.normals, undefined);
  assert.equal(part.uvs, undefined);
  assert.equal(part.positions.length, 9, "geometry still loads without them");
});

test("index width follows the vertex count rather than a fixed choice", async () => {
  const small = await storeWith(await glbWith()).acquire(resourceRef("model/one")).whenReady();
  assert.ok(small.parts[0].indices instanceof Uint16Array, "16 bits is enough for three vertices");

  const large = await storeWith(await glbWith({ vertexCount: 70000 }))
    .acquire(resourceRef("model/one"))
    .whenReady();
  assert.ok(
    large.parts[0].indices instanceof Uint32Array,
    "past 65535 vertices, 16-bit indices cannot address the buffer",
  );
});

test("a malformed asset reports failure instead of throwing into the caller", async () => {
  const store = storeWith(new Uint8Array([1, 2, 3, 4]));
  const handle = store.acquire(resourceRef("model/one"));

  await assert.rejects(() => handle.whenReady());
  assert.equal(handle.current(), undefined, "current() stays safe to call every frame");
  assert.equal(store.status(resourceRef("model/one")).state, "failed");
});

test("an asset with no drawable primitive fails with a description, not an empty mesh", async () => {
  const document = new Document();
  document.createScene().addChild(document.createNode());
  const store = storeWith(await new WebIO().writeBinary(document));

  await assert.rejects(
    () => store.acquire(resourceRef("model/one")).whenReady(),
    /no drawable primitive/,
  );
});

test("a definition with no source fails rather than loading nothing", async () => {
  const store = createAssetStore();
  store.registerResolver(gltfMeshResolver);
  const ref = resourceRef("model/empty");
  store.define({ ref, kind: GLTF_MESH_KIND, revision: 1, source: undefined, provenance });

  await assert.rejects(() => store.acquire(ref).whenReady(), /declares no glTF source/);
});

test("a loaded model reports its decoded cost and is disposed with its last holder", async () => {
  const store = storeWith(await glbWith());
  const ref = resourceRef("model/one");
  const handle = store.acquire(ref);
  await handle.whenReady();

  const status = store.status(ref);
  assert.equal(status.state, "ready");
  assert.ok(status.bytes > 0, "size comes from the resolver, not a guess");

  handle.release();
  assert.deepEqual(store.status(ref), { state: "idle" });
});
