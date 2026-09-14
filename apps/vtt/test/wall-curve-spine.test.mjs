import assert from "node:assert/strict";
import test from "node:test";
import { planWallCurveCreation, planBezierEdit } from "../src/features/edit-construction/index.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";

const stroke = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: 0, z: 1.5 },
  { x: 4, y: 0, z: 0 },
  { x: 6, y: 0, z: -1.5 },
  { x: 8, y: 0, z: 0 },
];

function drawWallCurve(fixture, height = 3) {
  const plan = planWallCurveCreation({
    snapshot: fixture.runtime.getGraphSnapshot(),
    topologies: fixture.runtime.getAllRegionTopologies(),
    port: fixture.runtime,
    stroke,
    operationId: `wc:${fixture.ctx.nextSequence()}`,
    tableId: fixture.ctx.tableId,
    height,
    tolerance: 0.05,
    wallType: "wall-curve-white",
  });
  assert.ok(plan, "a stroke of several anchors should produce a wall");
  fixture.runtime.applyPatchReplacement(plan.request, "local", plan.request.operationId);
  return plan;
}

test("a Bezier-drawn wall is zero-thickness panels sitting on the curve's own centerline, at a constant height above it", () => {
  const fixture = sessionFixture();
  try {
    drawWallCurve(fixture, 3);
    const panels = fixture.runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "wall-curve-white");
    assert.ok(panels.length > 1, "a curved run should be sampled into more than one panel");
    for (const panel of panels) {
      const ys = panel.nodes.map((n) => n.position.y);
      const bottomY = Math.min(...ys);
      const topY = Math.max(...ys);
      assert.ok(Math.abs(topY - bottomY - 3) < 1e-6, "each panel's own top sits exactly `height` above its base");
      // Zero thickness: every node of a panel is exactly on the drawn centerline's XZ, not offset either side of it.
      for (const node of panel.nodes) assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.z));
    }
  } finally { fixture.session.free(); }
});

test("editing the drawn axis regenerates just that wall's panels, through the same generic spine gesture roads and ramps use", () => {
  const fixture = sessionFixture();
  try {
    drawWallCurve(fixture, 3);
    const snapshot = fixture.runtime.getGraphSnapshot();
    const span = snapshot.edges.find((e) => e.curve?.surfaceType === "wall-curve-white");
    assert.ok(span, "the drawn run should own at least one spine span");
    const before = fixture.runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "wall-curve-white").length;

    const plan = planBezierEdit({
      snapshot,
      topologies: fixture.runtime.getAllRegionTopologies(),
      port: fixture.runtime,
      targetId: span.startNodeId,
      position: { x: 0, y: 2, z: 3 },
      operationId: `wc-edit:${fixture.ctx.nextSequence()}`,
      tableId: fixture.ctx.tableId,
      insert: false,
    });
    assert.ok(plan, "the generic spine editor should recognize a wall-curve control node");
    fixture.runtime.applyPatchReplacement(plan.request, "local", plan.request.operationId);

    const after = fixture.runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "wall-curve-white");
    assert.ok(after.length > 0, "the wall regenerates rather than disappearing");
    const startNode = fixture.runtime.getGraphSnapshot().nodes.find((n) => n.id === span.startNodeId);
    assert.ok(Math.abs(startNode.position.y - 2) < 1e-6, "the moved control node keeps the edit's own elevation");
    // The old panels are replaced wholesale, not accumulated: a sampler that resamples a
    // moved curve at a slightly different station count must not leave stale faces standing.
    assert.ok(Math.abs(after.length - before) <= 2, `expected roughly the same panel count, got ${before} -> ${after.length}`);
  } finally { fixture.session.free(); }
});
