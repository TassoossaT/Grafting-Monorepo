import assert from "node:assert/strict";
import test from "node:test";

import { commitWallContour } from "../src/composition/tabletop/tools/walls/wall-shared.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";

/**
 * Every construction tool commits one gesture as one transaction: the weld a
 * wall makes into another wall's side, its panels and whatever they reach
 * undo together as a single history entry. Driven against the real engine.
 */

const line = (x0, z0, x1, z1) => [{ start: { x: x0, y: 0, z: z0 }, end: { x: x1, y: 0, z: z1 }, geometry: { kind: "line" } }];
const PARAMS = { height: 3, wallType: "wall-white" };

test("a wall welding into another wall's side undoes weld and panel together", () => {
  const { ctx, runtime, session } = sessionFixture();
  try {
    commitWallContour(ctx, line(0, 0, 4, 0), PARAMS, "wall-line");
    const standing = runtime.getAllRegionTopologies().map((topology) => topology.nodes.map((node) => node.id).sort());

    commitWallContour(ctx, line(2, 0, 2, 4), PARAMS, "wall-line");
    const after = runtime.getAllRegionTopologies();
    assert.equal(after.length, 2);
    assert.ok(after.some((topology) => topology.nodes.length > 4), "the first wall took the T-junction column into its side");

    const entry = ctx.history.undo();
    assert.equal(entry.kind, "transaction");
    session.undo_region_overlay(entry.transactionId);

    const restored = runtime.getAllRegionTopologies().map((topology) => topology.nodes.map((node) => node.id).sort());
    assert.deepEqual(restored, standing, "one undo removes the second wall and the column it inserted");
  } finally { session.free(); }
});

test("every wall commit is its own history entry", () => {
  const { ctx, session } = sessionFixture();
  try {
    commitWallContour(ctx, line(0, 0, 4, 0), PARAMS, "wall-line");
    commitWallContour(ctx, line(0, 5, 4, 5), PARAMS, "wall-line");
    const second = ctx.history.undo();
    const first = ctx.history.undo();
    assert.ok(first && second && first.transactionId !== second.transactionId);
    assert.equal(ctx.history.undo(), undefined);
  } finally { session.free(); }
});
