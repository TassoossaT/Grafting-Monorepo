import assert from "node:assert/strict";
import test from "node:test";

import { resolveNodeStatuses, resolvePreviewTarget } from "../src/bench/evaluation-status.ts";

const plan = (skipped = []) => ({ steps: [], skipped, hashes: {} });
const outcome = (partial) => ({ evaluated: [], reused: [], previews: {}, failures: {}, ...partial });

test("marks nodes by what the pass actually did with them", () => {
  const statuses = resolveNodeStatuses(
    plan([{ nodeId: "c", missingInputs: ["heightmap"] }]),
    outcome({ evaluated: ["a"], reused: ["b"] }),
  );

  assert.deepEqual(statuses, { a: "evaluated", b: "reused", c: "waiting" });
});

test("lets a failure override having been evaluated", () => {
  const statuses = resolveNodeStatuses(plan(), outcome({ evaluated: ["a"], failures: { a: "boom" } }));
  assert.equal(statuses.a, "failed");
});

test("lets a cycle override everything else known about a node", () => {
  const statuses = resolveNodeStatuses(
    plan([{ nodeId: "a", missingInputs: ["x"] }]),
    outcome({ reused: ["a"] }),
    ["a"],
  );

  assert.equal(statuses.a, "failed");
});

test("reports nothing when no pass has run yet", () => {
  assert.deepEqual(resolveNodeStatuses(plan(), null), {});
});

test("prefers a viewport over the selection, so a chain keeps rendering while browsing", () => {
  assert.equal(resolvePreviewTarget(["viewport-1"], "generator-1"), "viewport-1");
});

test("shows the selected viewport when there is more than one", () => {
  assert.equal(resolvePreviewTarget(["viewport-1", "viewport-2"], "viewport-2"), "viewport-2");
});

test("falls back to the selected node, which is how one element is inspected alone", () => {
  assert.equal(resolvePreviewTarget([], "generator-1"), "generator-1");
});

test("has nothing to show with no viewport and no selection", () => {
  assert.equal(resolvePreviewTarget([], null), null);
});
