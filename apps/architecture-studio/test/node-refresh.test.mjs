import assert from "node:assert/strict";
import test from "node:test";

import { diffNodeStatuses } from "../src/bench/node-refresh.ts";

const node = (id) => ({ id, kindId: "heightmap.perlin", x: 0, y: 0, params: {} });

test("reports a node the surface has never been told about", () => {
  const { changed, next } = diffNodeStatuses([node("a")], {}, {});

  assert.deepEqual(
    changed.map((entry) => [entry.node.id, entry.status]),
    [["a", "idle"]],
  );
  assert.deepEqual(next, { a: "idle" });
});

test("settles: feeding its own baseline back reports nothing", () => {
  // This is the regression. The previous baseline stored only the nodes a pass
  // had touched, so an untouched node compared undefined against "idle" on
  // every render, pushed an update, and the renderer's echo of that update
  // started the next render -- a loop that froze the whole tab.
  const nodes = [node("a"), node("b")];
  const first = diffNodeStatuses(nodes, {}, {});
  const second = diffNodeStatuses(nodes, {}, first.next);

  assert.deepEqual(second.changed, []);
  assert.deepEqual(second.next, first.next);
});

test("stays settled when only some nodes have a reported status", () => {
  const nodes = [node("a"), node("b")];
  const statuses = { a: "evaluated" };
  const first = diffNodeStatuses(nodes, statuses, {});
  const second = diffNodeStatuses(nodes, statuses, first.next);

  assert.deepEqual(first.next, { a: "evaluated", b: "idle" });
  assert.deepEqual(second.changed, []);
});

test("reports only the node whose status actually changed", () => {
  const nodes = [node("a"), node("b")];
  const baseline = { a: "evaluated", b: "idle" };
  const { changed } = diffNodeStatuses(nodes, { a: "evaluated", b: "failed" }, baseline);

  assert.deepEqual(
    changed.map((entry) => entry.node.id),
    ["b"],
  );
});

test("drops a removed node from the baseline instead of remembering it forever", () => {
  const { next } = diffNodeStatuses([node("a")], {}, { a: "idle", gone: "evaluated" });
  assert.deepEqual(next, { a: "idle" });
});
