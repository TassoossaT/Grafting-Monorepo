import assert from "node:assert/strict";
import test from "node:test";

import { createCanvas } from "../dist/index.js";
import { resolveCanvasInteractionPolicy } from "../dist/canvas/graph/interaction-policy.js";

const NODE_VIEW = Object.freeze({
  id: "summary",
  defaultWidth: 120,
  defaultHeight: 80,
  mount() {
    throw new Error("mount must not run during input validation");
  },
});

const EDGE_VIEW = Object.freeze({
  id: "relation",
  present() {
    return Object.freeze({});
  },
});

const node = (id) =>
  Object.freeze({
    id,
    view: NODE_VIEW.id,
    x: 0,
    y: 0,
  });

test("rejects duplicate caller-owned node identifiers before mounting a renderer", () => {
  assert.throws(
    () =>
      createCanvas(
        {},
        [node("same"), node("same")],
        [],
        { nodeViews: [NODE_VIEW] },
      ),
    /Duplicate canvas node id: same/,
  );
});

test("rejects missing connection endpoints before mounting a renderer", () => {
  assert.throws(
    () =>
      createCanvas(
        {},
        [node("source")],
        [
          {
            id: "missing-target",
            view: EDGE_VIEW.id,
            source: { nodeId: "source" },
            target: { nodeId: "target" },
          },
        ],
        { nodeViews: [NODE_VIEW], edgeViews: [EDGE_VIEW] },
      ),
    /references a missing endpoint/,
  );
});

test("rejects renderer view identifiers that were not registered", () => {
  assert.throws(
    () =>
      createCanvas(
        {},
        [{ ...node("unknown"), view: "absent" }],
        [],
        { nodeViews: [NODE_VIEW] },
      ),
    /Canvas node view is not registered: absent/,
  );
});

test("keeps canvas interactions neutral until a consumer opts in", () => {
  assert.deepEqual(resolveCanvasInteractionPolicy(undefined), {
    panning: false,
    movableNodes: false,
    clickThreshold: 0,
    zoom: false,
    selectOnActivate: false,
  });

  const zoom = Object.freeze({ modifiers: Object.freeze(["control"]), minScale: 0.2 });
  assert.deepEqual(
    resolveCanvasInteractionPolicy({
      panning: true,
      movableNodes: true,
      clickThreshold: 7,
      zoom,
      selectOnActivate: true,
    }),
    {
      panning: true,
      movableNodes: true,
      clickThreshold: 7,
      zoom,
      selectOnActivate: true,
    },
  );
});
