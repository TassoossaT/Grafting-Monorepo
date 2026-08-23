import assert from "node:assert/strict";
import test from "node:test";

import {
  ENCODED_IMAGE_KIND,
  createAssetStore,
  createEncodedImageResolver,
  resourceRef,
} from "../dist/index.js";

const provenance = { origin: "test", license: "NONE" };

/**
 * A stand-in for a decoded bitmap: it records whether it was closed, which is
 * the only thing about disposal that can be asserted from outside.
 *
 * No real image is decoded anywhere in this file, and none is on disk. Asset
 * binaries are not committed, so a test that needed one could not run on a
 * fresh clone -- `AGENTS.md` makes that a rule rather than a preference.
 */
function fakeBitmap(width, height) {
  return { width, height, closed: false, close() { this.closed = true; } };
}

function decoderReturning(bitmap) {
  return async () => ({ source: bitmap, width: bitmap.width, height: bitmap.height });
}

test("bytes already in hand decode without any network", async () => {
  const bitmap = fakeBitmap(4, 2);
  const store = createAssetStore();
  store.registerResolver(
    createEncodedImageResolver({
      decode: decoderReturning(bitmap),
      fetch: async () => assert.fail("declared bytes must not be fetched"),
    }),
  );
  const ref = resourceRef("texture/from-bytes");
  store.define({
    ref,
    kind: ENCODED_IMAGE_KIND,
    revision: 1,
    source: { bytes: new Uint8Array([1, 2, 3]) },
    provenance,
  });

  const image = await store.acquire(ref).whenReady();

  assert.equal(image.form, "decoded");
  assert.equal(image.source, bitmap);
  assert.deepEqual([image.width, image.height], [4, 2]);
});

test("a url is fetched, and the abort signal goes with it", async () => {
  const bitmap = fakeBitmap(8, 8);
  let seenUrl;
  let sawSignal = false;
  const store = createAssetStore();
  store.registerResolver(
    createEncodedImageResolver({
      decode: decoderReturning(bitmap),
      async fetch(url, init) {
        seenUrl = url;
        sawSignal = init.signal instanceof AbortSignal;
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(3) };
      },
    }),
  );
  const ref = resourceRef("texture/from-url");
  store.define({
    ref,
    kind: ENCODED_IMAGE_KIND,
    revision: 1,
    source: { url: "https://example.invalid/bricks.png" },
    provenance,
  });

  await store.acquire(ref).whenReady();

  assert.equal(seenUrl, "https://example.invalid/bricks.png");
  assert.ok(sawSignal, "a fetch that ignores the signal cannot be cancelled");
});

test("a failed fetch is reported, not thrown into the caller's frame", async () => {
  const store = createAssetStore();
  store.registerResolver(
    createEncodedImageResolver({
      decode: decoderReturning(fakeBitmap(1, 1)),
      async fetch() {
        return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      },
    }),
  );
  const ref = resourceRef("texture/missing");
  store.define({
    ref,
    kind: ENCODED_IMAGE_KIND,
    revision: 1,
    source: { url: "https://example.invalid/gone.png" },
    provenance,
  });

  const handle = store.acquire(ref);
  await assert.rejects(handle.whenReady(), /404/);
  assert.equal(handle.current(), undefined, "current() never throws");
  assert.equal(store.status(ref).state, "failed");
});

test("colour space is carried from the declaration, never guessed", async () => {
  const store = createAssetStore();
  store.registerResolver(
    createEncodedImageResolver({ decode: decoderReturning(fakeBitmap(2, 2)) }),
  );
  const base = resourceRef("material/base-color");
  const normal = resourceRef("material/normal");
  store.define({
    ref: base,
    kind: ENCODED_IMAGE_KIND,
    revision: 1,
    source: { bytes: new Uint8Array([0]) },
    provenance,
  });
  store.define({
    ref: normal,
    kind: ENCODED_IMAGE_KIND,
    revision: 1,
    source: { bytes: new Uint8Array([0]), colorSpace: "linear" },
    provenance,
  });

  // The two maps of one material disagree, and must: reading a normal map as
  // sRGB does not fail, it lights wrongly.
  assert.equal((await store.acquire(base).whenReady()).colorSpace, "srgb");
  assert.equal((await store.acquire(normal).whenReady()).colorSpace, "linear");
});

test("a bitmap that arrives after its last holder released is closed, not leaked", async () => {
  const bitmap = fakeBitmap(16, 16);
  let releaseDecode;
  const store = createAssetStore();
  store.registerResolver(
    createEncodedImageResolver({
      // Decoding blocks until the test says otherwise, which is the real
      // window: `createImageBitmap` takes no signal, so the bitmap still
      // arrives after the abort and is owned by nobody.
      decode: () =>
        new Promise((resolve) => {
          releaseDecode = () => resolve({ source: bitmap, width: 16, height: 16 });
        }),
    }),
  );
  const ref = resourceRef("texture/abandoned");
  store.define({
    ref,
    kind: ENCODED_IMAGE_KIND,
    revision: 1,
    source: { bytes: new Uint8Array([0]) },
    provenance,
  });

  const handle = store.acquire(ref);
  handle.whenReady().catch(() => {});

  // Wait for the decode to actually be in flight. Releasing before it starts
  // would test the ordinary cancellation path instead of this one.
  while (releaseDecode === undefined) await new Promise((resolve) => setImmediate(resolve));

  handle.release();
  releaseDecode();
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(bitmap.closed, "the decode outlived its holder and leaked its bitmap");
});

test("a released image is disposed, and the inventory says so", async () => {
  const bitmap = fakeBitmap(32, 32);
  const store = createAssetStore();
  store.registerResolver(
    createEncodedImageResolver({ decode: decoderReturning(bitmap) }),
  );
  const ref = resourceRef("texture/released");
  store.define({
    ref,
    kind: ENCODED_IMAGE_KIND,
    revision: 1,
    source: { bytes: new Uint8Array([0]) },
    provenance,
  });

  const handle = store.acquire(ref);
  await handle.whenReady();

  const ready = store.inventory().find((entry) => entry.ref === ref);
  assert.equal(ready.status.state, "ready");
  assert.equal(ready.status.holders, 1);
  // Decoded cost, not file size: three bytes of input, 32*32*4 in memory.
  assert.equal(ready.status.bytes, 32 * 32 * 4);

  handle.release();

  assert.ok(bitmap.closed);
  assert.equal(store.status(ref).state, "idle");
});

test("a definition naming neither bytes nor a url fails with a usable message", async () => {
  const store = createAssetStore();
  store.registerResolver(
    createEncodedImageResolver({ decode: decoderReturning(fakeBitmap(1, 1)) }),
  );
  const ref = resourceRef("texture/empty");
  store.define({
    ref,
    kind: ENCODED_IMAGE_KIND,
    revision: 1,
    source: { colorSpace: "linear" },
    provenance,
  });

  await assert.rejects(store.acquire(ref).whenReady(), /neither image bytes nor a url/);
});
