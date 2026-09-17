import assert from "node:assert/strict";
import test from "node:test";
import { enginePort } from "./engine-planar.mjs";

import { edgeOverlayOf } from "../src/composition/tabletop/tools/core/edge-overlay.ts";
import { commitWallContour } from "../src/composition/tabletop/tools/walls/wall-shared.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";

/**
 * A boundary use reports one orientation: its nodes and its curve are both
 * walked the way the face walks them. A panel's top run is walked against the
 * edge's own direction, so pairing that walk with the edge's own handles drew
 * the top of a curved wall as a different, crossed curve while its bottom was
 * right -- the defect this holds closed.
 *
 * The curve is deliberately lopsided: a symmetric one reads the same from
 * either end and would pass whatever the contract said.
 */

/** The `[x, z]` points the overlay drew for one role. */
function drawn(groups, role) {
  const group = groups.find((candidate) => candidate.role === role);
  assert.ok(group !== undefined, `no ${role} overlay`);
  const points = [];
  for (let index = 0; index < group.positions.length; index += 3) {
    points.push([group.positions[index], group.positions[index + 2]]);
  }
  return points;
}

test("a curved wall's top run is drawn as the same curve as its bottom run", () => {
  const { ctx, runtime, session } = sessionFixture();
  try {
    commitWallContour(
      ctx,
      [{ start: { x: 0, y: 0, z: 0 }, end: { x: 4, y: 0, z: 0 }, geometry: { kind: "bezier", handle1: [0.5, -1.5], handle2: [3.5, -0.2] } }],
      { height: 3, wallType: "wall-white" },
      "wall-line",
    );

    const groups = edgeOverlayOf(enginePort, runtime.getAllRegionTopologies(), runtime.getGraphSnapshot(), runtime);
    const bottom = drawn(groups, "panel-bottom-edge");
    const top = drawn(groups, "panel-top-edge");

    assert.ok(bottom.length > 8, "a curved run is tessellated, not drawn as one chord");
    assert.ok(Math.min(...bottom.map(([, z]) => z)) < -0.4, "the bottom run bulges the way its handles say");
    for (const [x, z] of top) {
      const matched = bottom.some(([bx, bz]) => Math.abs(bx - x) < 1e-3 && Math.abs(bz - z) < 1e-3);
      assert.ok(matched, `the top run left the bottom run's curve at ${x.toFixed(2)}, ${z.toFixed(2)}`);
    }
  } finally { session.free(); }
});
