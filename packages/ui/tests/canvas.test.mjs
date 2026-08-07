import assert from "node:assert/strict";
import test from "node:test";

import { createCanvas } from "../dist/index.js";
import { checkCanvasConnection } from "../dist/canvas/graph/connection-policy.js";
import {
  clampCanvasZoomScale,
  resolveCanvasInteractionPolicy,
  resolveCanvasZoomRange,
} from "../dist/canvas/graph/interaction-policy.js";
import { isReportableMovement } from "../dist/canvas/graph/movement-policy.js";
import { resolveCanvasSocketPointerPolicy } from "../dist/canvas/graph/socket-policy.js";
import { findMagneticTarget } from "../dist/canvas/graph/magnetic-policy.js";

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

test("withholds a translation that only repeats the caller's own coordinates", () => {
  // The regression this guards: the renderer reports the adapter's own
  // translations too. Passing those on as user movement closed a loop --
  // consumer records a move, re-renders, calls updateNode, which translates
  // again -- that froze the browser tab outright.
  assert.equal(isReportableMovement({ x: 40, y: 40 }, { x: 40, y: 40 }), false);
});

test("reports a translation that actually moved the node", () => {
  assert.equal(isReportableMovement({ x: 40, y: 40 }, { x: 41, y: 40 }), true);
  assert.equal(isReportableMovement({ x: 40, y: 40 }, { x: 40, y: 41 }), true);
});

test("withholds a translation for a node the caller no longer owns", () => {
  assert.equal(isReportableMovement(undefined, { x: 1, y: 2 }), false);
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

test("makes a magnet port a real pointer target, so a connection can be started", () => {
  // The regression: the port was drawn with pointer-events none, inherited from
  // when this canvas was read-only. The connection plugin resolves a socket by
  // looking for its registered element in document.elementsFromPoint, and the
  // port's wrapper has no width of its own -- so with the dot transparent to
  // the pointer, nothing was hit there at all and the chain never included the
  // element the plugin had registered. Dragging from a port did nothing.
  const policy = resolveCanvasSocketPointerPolicy({
    id: "heightmap",
    position: "right",
    magnet: true,
    presentation: { radius: 5 },
  });

  assert.equal(policy.interactive, true);
});

test("keeps a decorative port transparent to the pointer", () => {
  const policy = resolveCanvasSocketPointerPolicy({ id: "top", position: "top" });

  // A read-only canvas's ports must not intercept clicks meant for the node.
  assert.equal(policy.interactive, false);
});

test("gives a small port a target large enough to grab", () => {
  const drawn = resolveCanvasSocketPointerPolicy({
    id: "value",
    position: "left",
    magnet: true,
    presentation: { radius: 5 },
  });
  const large = resolveCanvasSocketPointerPolicy({
    id: "value",
    position: "left",
    magnet: true,
    presentation: { radius: 20 },
  });

  assert.equal(drawn.hitSize, 18);
  // A port drawn larger than the minimum keeps its own size.
  assert.equal(large.hitSize, 40);
});

const port = (nodeId, key, x, y) => ({ nodeId, key, side: "input", center: { x, y } });

test("snaps a released connection to the nearest port within reach", () => {
  const target = findMagneticTarget({ x: 100, y: 100 }, [port("a", "in", 130, 100), port("b", "in", 108, 100)], 40);
  assert.equal(target.nodeId, "b");
});

test("leaves a connection unmade when every port is out of reach", () => {
  assert.equal(findMagneticTarget({ x: 0, y: 0 }, [port("a", "in", 100, 0)], 40), null);
});

test("measures reach as a radius, not as a box", () => {
  // (30, 30) is inside a 40-wide square but outside a 40 radius.
  assert.equal(findMagneticTarget({ x: 0, y: 0 }, [port("a", "in", 30, 30)], 40), null);
  assert.equal(findMagneticTarget({ x: 0, y: 0 }, [port("a", "in", 0, 39)], 40).nodeId, "a");
});

test("treats an absent or zero radius as requiring a direct hit", () => {
  assert.equal(findMagneticTarget({ x: 0, y: 0 }, [port("a", "in", 1, 0)], 0), null);
});

test("resolves a tie to the first candidate, so the same input gives the same result", () => {
  const first = findMagneticTarget({ x: 0, y: 0 }, [port("a", "in", 10, 0), port("b", "in", 10, 0)], 40);
  assert.equal(first.nodeId, "a");
});
