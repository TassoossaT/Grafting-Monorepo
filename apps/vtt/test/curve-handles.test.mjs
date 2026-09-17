import assert from "node:assert/strict";
import test from "node:test";

import {
  contourCurve,
  contourGeometry,
  curveEdgesOf,
  curveHandles,
  curvePick,
  curvePickId,
  isBezierEditTarget,
  planEdgeReshape,
  reshapeCurve,
  resolveCloudTopology,
} from "../src/features/edit-construction/index.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";

/**
 * One curve handle for every curve: a curved wall's boundary edges get the
 * same handles, picks and reshaping a road's spine spans do, and committing
 * the reshape goes through the grabbed edge's own role -- which lets a wall's
 * run curve, carries the run across the panel with it, and keeps a post
 * straight. Driven against the real engine.
 */

function curvedWall(runtime, type = "wall-white") {
  const at = (id, x, y) => ({ id, position: { x, y, z: 0 } });
  runtime.addPatch({
    nodes: [at("b0", 0, 0), at("b1", 4, 0), at("t1", 4, 3), at("t0", 0, 3)],
    edges: [
      { edgeId: "bottom", startNodeId: "b0", endNodeId: "b1", geometry: { kind: "bezier", handle1: [1, -1], handle2: [3, -1] } },
      { edgeId: "post-1", startNodeId: "b1", endNodeId: "t1" },
      { edgeId: "top", startNodeId: "t1", endNodeId: "t0", geometry: { kind: "bezier", handle1: [3, -1], handle2: [1, -1] } },
      { edgeId: "post-0", startNodeId: "t0", endNodeId: "b0" },
    ],
    regions: [{
      regionId: "wall",
      surfaceType: type,
      physical: true,
      boundary: ["bottom", "post-1", "top", "post-0"].map((edgeId) => ({ edgeId, reversed: false })),
    }],
  });
  const face = runtime.getAllRegionTopologies().find((topology) => topology.surfaceType === type);
  return resolveCloudTopology(runtime, face.surfaceKey);
}

test("a curved contour edge gets the same handles and picks a spine span does", () => {
  const { runtime, session } = sessionFixture();
  try {
    curvedWall(runtime);
    const contour = runtime.getCurvedEdges();
    assert.deepEqual(contour.map((edge) => edge.edgeId), ["bottom", "top"]);

    const edges = curveEdgesOf(runtime.getGraphSnapshot(), contour, runtime);
    assert.ok(edges.every((edge) => edge.store === "contour"));
    const handles = curveHandles(edges, runtime);
    assert.equal(handles.length, 6, "two handles and a midpoint per curve");

    const first = handles.find((handle) => handle.id === curvePickId("bottom", 1));
    assert.deepEqual([first.position.x, first.position.z], [1, -1], "the handle sits on the edge's own XZ control point");
    assert.deepEqual(curvePick(curvePickId("bottom", "midpoint")), { edgeId: "bottom", index: "midpoint" });
    assert.ok(isBezierEditTarget(runtime.getGraphSnapshot(), curvePickId("bottom", 2), contour));
  } finally { session.free(); }
});

test("reshaping a wall's bottom run carries its top run and commits as geometry only", () => {
  const { runtime, session } = sessionFixture();
  try {
    const cloud = curvedWall(runtime);
    const bottom = runtime.getCurvedEdges().find((edge) => edge.edgeId === "bottom");
    const reshaped = reshapeCurve(runtime, contourCurve(bottom), 1, { x: 1, y: 0, z: -3 });
    const plan = planEdgeReshape(cloud, "bottom", contourGeometry(reshaped));

    assert.equal(plan.kind, "apply", plan.reason);
    assert.deepEqual(plan.ops.map((op) => [op.kind, op.edgeId]), [["retype-edge", "bottom"], ["retype-edge", "top"]]);
    assert.ok(plan.ops.every((op) => op.kind === "retype-edge"), "a reshape moves no node");

    runtime.applyRegionEdit(plan.ops);
    const after = new Map(runtime.getCurvedEdges().map((edge) => [edge.edgeId, edge]));
    assert.deepEqual(after.get("bottom").handle1.map((v) => Math.round(v * 100) / 100), [1, -3]);
    assert.deepEqual(after.get("top").handle2, after.get("bottom").handle1, "the top run walks the same curve the other way");
    assert.deepEqual(after.get("top").handle1, after.get("bottom").handle2);
  } finally { session.free(); }
});

test("a post, and an edge whose role declares no reshape, keep the curve they have", () => {
  const { runtime, session } = sessionFixture();
  try {
    const wall = curvedWall(runtime);
    const post = planEdgeReshape(wall, "post-1", { kind: "bezier", handle1: [4, 1], handle2: [4, 2] });
    assert.equal(post.kind, "deny");

    const other = sessionFixture();
    try {
      const floor = curvedWall(other.runtime, "platform");
      assert.equal(planEdgeReshape(floor, "bottom", { kind: "bezier", handle1: [1, -2], handle2: [3, -2] }).kind, "deny",
        "a platform has not decided to take curve handles");
    } finally { other.session.free(); }
  } finally { session.free(); }
});
