import assert from "node:assert/strict";
import test from "node:test";

import {
  boundaryUsage,
  createBoundaryEdges,
  reverseGeometry,
} from "../src/composition/tabletop/tools/core/boundary-edges.ts";

const TABLE_ID = "table-1";
const REFUSE = { kind: "refuse-when-full" };

function privateWhenFull(existing = new Map()) {
  return { kind: "private-when-full", runPrefix: `${TABLE_ID}:run-1`, existingUses: existing };
}

test("both directions of a pair name the same edge, walked opposite ways", () => {
  const edges = createBoundaryEdges(TABLE_ID, REFUSE);

  const forward = edges.use("a", "b");
  const backward = edges.use("b", "a");

  assert.equal(forward.edgeId, backward.edgeId, "lexicographic order picks the same representative from either side");
  assert.equal(forward.reversed, false);
  assert.equal(backward.reversed, true);
  assert.equal(edges.all().length, 1, "one edge, declared once, used twice");
  assert.deepEqual(edges.all()[0], { edgeId: `${TABLE_ID}:seg:a~b`, startNodeId: "a", endNodeId: "b" });
});

test("a straight edge carries no geometry -- absent already means a chord", () => {
  const edges = createBoundaryEdges(TABLE_ID, REFUSE);
  edges.use("a", "b");
  assert.equal("geometry" in edges.all()[0], false);
});

test("an edge declared backwards stores the curve seen from its own start", () => {
  const edges = createBoundaryEdges(TABLE_ID, REFUSE);
  const arc = { kind: "arc", center: [2, 0], clockwise: true };

  edges.use("b", "a", arc);

  const [edge] = edges.all();
  assert.equal(edge.startNodeId, "a", "stored lexicographically, whichever way the caller walked it");
  assert.deepEqual(edge.geometry, reverseGeometry(arc));
});

test("refuse-when-full keeps the shared name even with no room, and lets the engine decide", () => {
  // Two faces already meet along `a~b`: one more use is what the engine
  // refuses, and for ground that refusal is the point.
  const existing = new Map([[`${TABLE_ID}:seg:a~b`, [false, true]]]);
  const edges = createBoundaryEdges(TABLE_ID, REFUSE);
  // The map is deliberately ignored by this policy -- passing it changes nothing.
  void existing;

  const first = edges.use("a", "b");
  const second = edges.use("a", "b");

  assert.equal(first.edgeId, `${TABLE_ID}:seg:a~b`);
  assert.equal(second.edgeId, first.edgeId, "the name never changes; the face is refused instead");
});

test("private-when-full shares while the graph still has room", () => {
  const existing = new Map([[`${TABLE_ID}:seg:a~b`, [false]]]);
  const edges = createBoundaryEdges(TABLE_ID, privateWhenFull(existing));

  const use = edges.use("b", "a");

  assert.equal(use.edgeId, `${TABLE_ID}:seg:a~b`, "the free side faces the other way, so there is room");
  assert.equal(use.reversed, true);
});

test("private-when-full keeps its own edge when the shared one faces the same way", () => {
  const existing = new Map([[`${TABLE_ID}:seg:a~b`, [false]]]);
  const edges = createBoundaryEdges(TABLE_ID, privateWhenFull(existing));

  const use = edges.use("a", "b");

  assert.equal(use.edgeId, `${TABLE_ID}:run-1:seg:a~b`);
  assert.deepEqual(edges.all()[0], { edgeId: `${TABLE_ID}:run-1:seg:a~b`, startNodeId: "a", endNodeId: "b" });
});

test("private-when-full keeps its own edge when the shared one already has two faces", () => {
  const existing = new Map([[`${TABLE_ID}:seg:a~b`, [false, true]]]);
  const edges = createBoundaryEdges(TABLE_ID, privateWhenFull(existing));

  assert.equal(edges.use("b", "a").edgeId, `${TABLE_ID}:run-1:seg:a~b`);
});

test("private-when-full counts what this patch has already claimed, not only the graph", () => {
  const edges = createBoundaryEdges(TABLE_ID, privateWhenFull());

  const first = edges.use("a", "b");
  const second = edges.use("b", "a");
  const third = edges.use("a", "b");

  assert.equal(first.edgeId, `${TABLE_ID}:seg:a~b`);
  assert.equal(second.edgeId, first.edgeId, "opposite directions still fit on one edge");
  assert.equal(third.edgeId, `${TABLE_ID}:run-1:seg:a~b`, "a third face at the same pair takes its own");
});

test("a run that fills even its own private edge takes another rather than colliding", () => {
  const edges = createBoundaryEdges(TABLE_ID, privateWhenFull());

  const ids = [edges.use("a", "b"), edges.use("a", "b"), edges.use("a", "b")].map((use) => use.edgeId);

  assert.equal(new Set(ids).size, 3, "every same-direction use ends up somewhere it fits");
  assert.equal(edges.all().length, 3);
});

test("boundaryUsage records every direction each edge is walked in, holes included", () => {
  const ctx = {
    runtime: {
      getAllRegionTopologies: () => [
        {
          outerLoops: [
            [
              { edgeId: "e1", reversed: false },
              { edgeId: "e2", reversed: true },
            ],
          ],
          holes: [[{ edgeId: "e1", reversed: true }]],
        },
      ],
    },
  };

  const usage = boundaryUsage(ctx);

  assert.deepEqual([...usage.get("e1")].sort(), [false, true]);
  assert.deepEqual([...usage.get("e2")], [true]);
  assert.equal(usage.get("e3"), undefined);
});
