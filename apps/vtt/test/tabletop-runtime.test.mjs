import assert from "node:assert/strict";
import test from "node:test";

import { createTabletopRuntime } from "../src/composition/tabletop/index.ts";

test("keeps a cached immutable snapshot and publishes lifecycle transitions", async () => {
  const runtime = createTabletopRuntime({ tableId: " table-1 " });
  const initial = runtime.getSnapshot();

  assert.equal(runtime.getSnapshot(), initial);
  assert.equal(initial.tableId, "table-1");
  assert.equal(initial.status, "idle");
  assert.equal(Object.isFrozen(initial), true);

  const observed = [];
  runtime.subscribe(() => observed.push(runtime.getSnapshot().status));

  await runtime.start();
  assert.deepEqual(observed, ["starting", "ready"]);
  assert.equal(runtime.getSnapshot().revision, 2);
  assert.equal(runtime.getSnapshot().status, "ready");
  await assert.rejects(runtime.start(), /already ready/);
});

test("disposal is idempotent and a later React lifecycle generation can restart", async () => {
  const runtime = createTabletopRuntime({ tableId: "table-2" });
  let notifications = 0;
  runtime.subscribe(() => (notifications += 1));

  await runtime.start();
  await runtime.dispose();
  const disposed = runtime.getSnapshot();
  await runtime.dispose();

  assert.equal(runtime.getSnapshot(), disposed);
  assert.equal(disposed.status, "disposed");
  assert.equal(notifications, 3);

  const restarted = [];
  runtime.subscribe(() => restarted.push(runtime.getSnapshot().status));
  await runtime.start();

  assert.deepEqual(restarted, ["starting", "ready"]);
  assert.equal(runtime.getSnapshot().status, "ready");
});

test("rejects an empty table identity", () => {
  assert.throws(() => createTabletopRuntime({ tableId: "   " }), /must not be empty/);
});
