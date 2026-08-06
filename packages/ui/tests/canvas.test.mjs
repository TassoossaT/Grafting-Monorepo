import assert from "node:assert/strict";
import test from "node:test";

import { createCanvas } from "../dist/index.js";
import { checkCanvasConnection } from "../dist/canvas/graph/connection-policy.js";
import {
  clampCanvasZoomScale,
  resolveCanvasInteractionPolicy,
  resolveCanvasZoomRange,
} from "../dist/canvas/graph/interaction-policy.js";

const candidate = (nodeId, side, port = {}, connectionCount = 0) => ({
  nodeId,
  side,
  port: { id: `${side}-port`, position: side === "input" ? "left" : "right", ...port },
  connectionCount,
});

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

test("refuses an edge that leaves a node through an input-only port", () => {
  const view = {
    ...NODE_VIEW,
    ports: [
      { id: "value", position: "left", direction: "in" },
      { id: "result", position: "right", direction: "out" },
    ],
  };
  assert.throws(
    () =>
      createCanvas(
        {},
        [
          { ...node("a"), view: view.id },
          { ...node("b"), view: view.id },
        ],
        [
          {
            id: "backwards",
            view: EDGE_VIEW.id,
            source: { nodeId: "a", portId: "value" },
            target: { nodeId: "b", portId: "value" },
          },
        ],
        { nodeViews: [view], edgeViews: [EDGE_VIEW] },
      ),
    /leaves a through input-only port value/,
  );
});

test("refuses an edge that enters a node through an output-only port", () => {
  const view = {
    ...NODE_VIEW,
    ports: [
      { id: "value", position: "left", direction: "in" },
      { id: "result", position: "right", direction: "out" },
    ],
  };
  assert.throws(
    () =>
      createCanvas(
        {},
        [
          { ...node("a"), view: view.id },
          { ...node("b"), view: view.id },
        ],
        [
          {
            id: "backwards",
            view: EDGE_VIEW.id,
            source: { nodeId: "a", portId: "result" },
            target: { nodeId: "b", portId: "result" },
          },
        ],
        { nodeViews: [view], edgeViews: [EDGE_VIEW] },
      ),
    /enters b through output-only port result/,
  );
});

test("still accepts an edge through a port that declares no direction", () => {
  const view = {
    ...NODE_VIEW,
    ports: [{ id: "any", position: "right" }],
  };
  assert.throws(
    () =>
      createCanvas(
        {},
        [{ ...node("a"), view: view.id }],
        [
          {
            id: "undirected",
            view: EDGE_VIEW.id,
            source: { nodeId: "a", portId: "any" },
            target: { nodeId: "a", portId: "any" },
          },
        ],
        { nodeViews: [view], edgeViews: [EDGE_VIEW] },
      ),
    // Reaching the renderer proves the undirected port was accepted on both
    // sides; a real surface is out of scope for a DOM-free contract test.
    /container|replaceChildren|style/,
  );
});

test("accepts a structurally sound user-drawn connection", () => {
  assert.equal(
    checkCanvasConnection(
      candidate("a", "output", { direction: "out", dataType: "heightmap" }),
      candidate("b", "input", { direction: "in", dataType: "mask" }),
      false,
    ),
    // Mismatched value kinds are deliberately not the canvas's business; only
    // the consumer's onConnectRequest decides that.
    null,
  );
});

test("refuses user-drawn connections that violate a structural rule", () => {
  const out = candidate("a", "output", { direction: "out" });
  const into = candidate("b", "input", { direction: "in" });

  assert.equal(checkCanvasConnection(out, candidate("b", "output"), false), "same-side");
  assert.equal(
    checkCanvasConnection(out, candidate("a", "input", { direction: "in" }), false),
    "self-connection",
  );
  assert.equal(
    checkCanvasConnection(candidate("a", "output", { direction: "in" }), into, false),
    "direction",
  );
  assert.equal(
    checkCanvasConnection(out, candidate("b", "input", { direction: "out" }), false),
    "direction",
  );
  assert.equal(checkCanvasConnection(out, into, true), "duplicate");
  assert.equal(
    checkCanvasConnection(out, candidate("b", "input", { direction: "in", capacity: 1 }, 1), false),
    "capacity",
  );
});

test("treats an omitted capacity as unlimited", () => {
  assert.equal(
    checkCanvasConnection(
      candidate("a", "output", { direction: "out" }, 99),
      candidate("b", "input", { direction: "in" }, 99),
      false,
    ),
    null,
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

test("keeps caller-driven zoom inside a valid consumer-owned range", () => {
  const zoom = Object.freeze({ minScale: 0.3, maxScale: 2.4 });

  assert.deepEqual(resolveCanvasZoomRange(zoom), { min: 0.3, max: 2.4 });
  assert.equal(clampCanvasZoomScale(0.1, zoom), 0.3);
  assert.equal(clampCanvasZoomScale(1.25, zoom), 1.25);
  assert.equal(clampCanvasZoomScale(8, zoom), 2.4);
  assert.deepEqual(resolveCanvasZoomRange({ minScale: 2, maxScale: 1 }), { min: 2, max: 2 });
});
