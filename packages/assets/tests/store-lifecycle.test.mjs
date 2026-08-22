import assert from "node:assert/strict";
import test from "node:test";

import { createAssetStore, resourceRef } from "../dist/index.js";

const REF = resourceRef("thing/one");

/** A resolver that records every load and disposal, and can be held open. */
function trackingResolver({ kind = "tracked", fail = false } = {}) {
  const calls = { loads: 0, disposals: 0, aborts: 0 };
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return {
    calls,
    openGate: () => release(),
    resolver: {
      kind,
      async load(definition, signal) {
        calls.loads += 1;
        signal.addEventListener("abort", () => {
          calls.aborts += 1;
        });
        await gate;
        if (fail) throw new Error("resolver refused");
        return { id: definition.ref, revision: definition.revision };
      },
      dispose() {
        calls.disposals += 1;
      },
      sizeOf: () => 100,
    },
  };
}

const define = (store, { ref = REF, kind = "tracked", revision = 1 } = {}) => {
  store.define({
    ref,
    kind,
    revision,
    source: {},
    provenance: { origin: "test", license: "NONE" },
  });
};

test("a resource is declared before it is loaded, and reports so", () => {
  const store = createAssetStore();
  assert.deepEqual(store.status(REF), { state: "undeclared" });

  const { resolver } = trackingResolver();
  store.registerResolver(resolver);
  define(store);

  assert.deepEqual(store.status(REF), { state: "idle" }, "declaring must not load");
});

test("concurrent acquisitions join one load rather than starting two", async () => {
  const store = createAssetStore();
  const { resolver, calls, openGate } = trackingResolver();
  store.registerResolver(resolver);
  define(store);

  const first = store.acquire(REF);
  const second = store.acquire(REF);
  assert.deepEqual(store.status(REF), { state: "loading", holders: 2 });

  openGate();
  const [a, b] = await Promise.all([first.whenReady(), second.whenReady()]);

  assert.equal(calls.loads, 1, "one in-flight load per (ref, revision)");
  assert.equal(a, b, "both holders receive the same resource, not two copies");
});

test("a resource is disposed exactly when its last holder releases", async () => {
  const store = createAssetStore();
  const { resolver, calls, openGate } = trackingResolver();
  store.registerResolver(resolver);
  define(store);

  const first = store.acquire(REF);
  const second = store.acquire(REF);
  openGate();
  await first.whenReady();

  first.release();
  assert.equal(calls.disposals, 0, "a resource still held must not be disposed");
  assert.equal(store.status(REF).holders, 1);

  second.release();
  assert.equal(calls.disposals, 1, "the last release disposes");
  assert.deepEqual(store.status(REF), { state: "idle" });
});

test("releasing twice is harmless", async () => {
  const store = createAssetStore();
  const { resolver, calls, openGate } = trackingResolver();
  store.registerResolver(resolver);
  define(store);

  const handle = store.acquire(REF);
  openGate();
  await handle.whenReady();

  handle.release();
  handle.release();
  assert.equal(calls.disposals, 1, "a second release must not dispose again");
});

test("abandoning a load in flight cancels it instead of allocating", async () => {
  const store = createAssetStore();
  const { resolver, calls, openGate } = trackingResolver();
  store.registerResolver(resolver);
  define(store);

  const handle = store.acquire(REF);
  handle.release();
  assert.equal(calls.aborts, 1, "the resolver is told to stop");

  openGate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.disposals, 1, "a resource that arrived unheld is disposed, not retained");
  assert.deepEqual(store.status(REF), { state: "idle" });
});

test("a failed load is reported, never thrown into the caller's frame", async () => {
  const store = createAssetStore();
  const { resolver, calls, openGate } = trackingResolver({ fail: true });
  store.registerResolver(resolver);
  define(store);

  const handle = store.acquire(REF);
  openGate();
  await assert.rejects(() => handle.whenReady(), /resolver refused/);

  assert.equal(handle.current(), undefined, "current() reports absence rather than throwing");
  const status = store.status(REF);
  assert.equal(status.state, "failed");
  assert.equal(status.attempts, 1, "the failure is not retried in a loop");
  assert.equal(calls.loads, 1);
});

test("peek reads metadata without loading and without holding", () => {
  const store = createAssetStore();
  const { resolver, calls } = trackingResolver();
  store.registerResolver(resolver);
  store.define({
    ref: REF,
    kind: "tracked",
    revision: 1,
    source: {},
    dimensions: { x: 0.2, y: 0.1, z: 0.1 },
    provenance: { origin: "test", license: "NONE" },
  });

  assert.deepEqual(store.peek(REF).dimensions, { x: 0.2, y: 0.1, z: 0.1 });
  assert.equal(calls.loads, 0, "reading a size must not pin bytes in memory");
  assert.deepEqual(store.status(REF), { state: "idle" });
});

test("a new revision loads separately while existing holders keep serving the old one", async () => {
  const store = createAssetStore();
  const { resolver, calls, openGate } = trackingResolver();
  store.registerResolver(resolver);
  define(store, { revision: 1 });

  const old = store.acquire(REF);
  openGate();
  const before = await old.whenReady();

  define(store, { revision: 2 });
  const fresh = store.acquire(REF);
  const after = await fresh.whenReady();

  assert.equal(before.revision, 1, "the existing holder does not blink to the new revision");
  assert.equal(after.revision, 2);
  assert.equal(calls.loads, 2);
});

test("inventory lists every declared resource with its state", async () => {
  const store = createAssetStore();
  const { resolver, openGate } = trackingResolver();
  store.registerResolver(resolver);
  define(store, { ref: resourceRef("a"), revision: 1 });
  define(store, { ref: resourceRef("b"), revision: 1 });

  const handle = store.acquire(resourceRef("a"));
  openGate();
  await handle.whenReady();

  const rows = store.inventory();
  assert.equal(rows.length, 2, "declared-but-unloaded resources are listed too");
  const loaded = rows.find((row) => row.ref === "a");
  assert.equal(loaded.status.state, "ready");
  assert.equal(loaded.status.holders, 1);
  assert.equal(loaded.status.bytes, 100, "the resolver reports its own cost");
  assert.equal(rows.find((row) => row.ref === "b").status.state, "idle");
});

test("retention keeps an unheld resource loaded until the budget is exceeded", async () => {
  const store = createAssetStore({ retention: { kind: "least-recently-used", maxBytes: 150 } });
  const { resolver, calls, openGate } = trackingResolver();
  store.registerResolver(resolver);
  define(store, { ref: resourceRef("a") });
  define(store, { ref: resourceRef("b") });
  openGate();

  const first = store.acquire(resourceRef("a"));
  await first.whenReady();
  first.release();
  assert.equal(calls.disposals, 0, "under retention, releasing does not dispose immediately");

  const again = store.acquire(resourceRef("a"));
  await again.whenReady();
  assert.equal(calls.loads, 1, "re-acquiring a retained resource does not reload it");
  again.release();

  // 100 + 100 exceeds the 150-byte budget, so the oldest release is evicted.
  const second = store.acquire(resourceRef("b"));
  await second.whenReady();
  second.release();
  assert.equal(calls.disposals, 1, "the least recently released resource is evicted");
});

test("a resolver may only claim a kind once", () => {
  const store = createAssetStore();
  store.registerResolver(trackingResolver().resolver);
  assert.throws(() => store.registerResolver(trackingResolver().resolver), /already registered/);
});

test("acquiring something undeclared fails loudly rather than silently", () => {
  const store = createAssetStore();
  assert.throws(() => store.acquire(resourceRef("nope")), /no definition declared/);
});

test("a catalog source declares everything it lists", async () => {
  const store = createAssetStore();
  const source = {
    id: "fixture",
    async list() {
      return [
        {
          ref: resourceRef("from/catalog"),
          kind: "tracked",
          revision: 1,
          source: {},
          provenance: { origin: "fixture", license: "CC0-1.0" },
        },
      ];
    },
  };

  assert.equal(await store.load(source), 1);
  assert.equal(store.peek(resourceRef("from/catalog")).provenance.license, "CC0-1.0");
});
