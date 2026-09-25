import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { createPathBrushEffect, pathFormationFor, planPathCloudMutation } from "../src/features/edit-construction/index.ts";
import { pathPointsTool } from "../src/composition/tabletop/tools/paths/path-points-tool.ts";
import { roadSnapTarget } from "../src/composition/tabletop/tools/paths/road-body-target.ts";
import { commitPatchReplacement } from "../src/composition/tabletop/effects/effect-commit.ts";

const point = (x, z, y = 0) => ({ x, y, z });
const roadParams = { shape: "circle", radius: 0.5, rotationDegrees: 0, pathKind: "road", bedWidth: 1.0, shoulderWidth: 0.1, shoulderHeight: 0, miterLimit: 4 };

function slopedTerrain(runtime, session) {
  runtime.getSnapshot = () => ({
    tableId: "test",
    map: {
      nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [
        n.id,
        { position: { x: n.position[0], y: n.position[1], z: n.position[2] } },
      ])),
    },
  });
  const cell = 4;
  const cells = 4;
  const id = (i, j) => `g:${i}:${j}`;
  const nodes = [];
  for (let i = 0; i <= cells; i++) {
    for (let j = 0; j <= cells; j++) {
      const x = -8 + i * cell;
      const z = -8 + j * cell;
      nodes.push({ id: id(i, j), position: { x, y: 0.2 * x, z } });
    }
  }
  const edges = new Map();
  const use = (a, b) => {
    const key = a < b ? `${a}~${b}` : `${b}~${a}`;
    if (!edges.has(key)) edges.set(key, { edgeId: `e:${key}`, startNodeId: a < b ? a : b, endNodeId: a < b ? b : a });
    return { edgeId: edges.get(key).edgeId, reversed: edges.get(key).startNodeId !== a };
  };
  const regions = [];
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const ring = [id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)];
      regions.push({ regionId: `q:${i}:${j}`, boundary: ring.map((a, n) => use(a, ring[(n + 1) % 4])), surfaceType: "terrain", physical: true });
    }
  }
  runtime.addPatch({ nodes, edges: [...edges.values()], regions });
}

function drawRoad(f, samples, operationId) {
  const effect = createPathBrushEffect(
    { brushShape: { kind: "circle", radius: 0.5 }, brushRegion: { samples }, parameters: pathFormationFor(roadParams) },
    { operationId, tableId: "test", initiatedBy: "path-brush" }
  );
  const plan = planPathCloudMutation({
    bezier: f.runtime, field: f.runtime, tableId: "test", snapToGrid: false,
    graphSnapshot: f.runtime.getGraphSnapshot(),
    regionTopologies: f.runtime.getAllRegionTopologies(),
    coverageFor: () => [], effect, tolerance: 0.025,
  });
  assert.equal(plan.kind, "ready");
  const { recorded } = commitPatchReplacement(f.runtime, plan.request, { transactionId: operationId, subtype: effect.parameters.kind });
  assert.ok(recorded);
}

test("moving a road endpoint connects and welds into another road on sloped terrain", () => {
  const f = sessionFixture();
  f.runtime.showPreview = () => {};
  f.runtime.clearPreview = () => {};
  try {
    slopedTerrain(f.runtime, f.session);

    // Draw road 1 with terrain elevations (from x=-8 to x=-1)
    drawRoad(f, [point(-8, 0, -1.6), point(-1, 0, -0.2)], "road:1");

    // Draw road 2 with terrain elevations (from x=1 to x=8)
    drawRoad(f, [point(1, 0, 0.2), point(8, 0, 1.6)], "road:2");

    const snapshot = f.runtime.getGraphSnapshot();
    const nodeA = snapshot.nodes.find((n) => Math.abs(n.position.x - (-1)) < 0.1 && Math.abs(n.position.z) < 0.1);
    const nodeB = snapshot.nodes.find((n) => Math.abs(n.position.x - 1) < 0.1 && Math.abs(n.position.z) < 0.1);
    assert.ok(nodeA, "nodeA (-1, 0) must exist");
    assert.ok(nodeB, "nodeB (1, 0) must exist");

    // Verify snap target identifies nodeB across the elevation delta
    const snap = roadSnapTarget(f.ctx, { point: nodeB.position }, nodeA.id);
    assert.ok(snap, "snap to nodeB must be detected");
    assert.equal(snap.nodeId, nodeB.id);

    // Drag nodeA towards nodeB using pathPointsTool
    const toolParams = { shape: "circle", radius: 0.5, rotationDegrees: 0, pathKind: "road", bedWidth: 1.0, shoulderWidth: 0.1, shoulderHeight: 0, miterLimit: 4 };
    f.calls.feedback = [];

    pathPointsTool.onPointerDown(f.ctx, { nodeId: nodeA.id, point: nodeA.position }, toolParams);
    pathPointsTool.onPointerMove(f.ctx, {
      start: { nodeId: nodeA.id, point: nodeA.position },
      current: { point: nodeB.position },
      samples: [{ nodeId: nodeA.id, point: nodeA.position }, { point: nodeB.position }],
    }, toolParams);
    pathPointsTool.onPointerUp(f.ctx, {
      start: { nodeId: nodeA.id, point: nodeA.position },
      current: { point: nodeB.position },
      samples: [{ nodeId: nodeA.id, point: nodeA.position }, { point: nodeB.position }],
    }, toolParams);

    // Verify that the operation succeeded without rollback
    assert.ok(f.calls.feedback.some((fb) => fb.tone === "success"));

    // Verify that edges were welded together at nodeB
    const endSnapshot = f.runtime.getGraphSnapshot();
    const connectedEdges = endSnapshot.edges.filter((e) => e.curve);
    assert.equal(connectedEdges.length, 2);
    assert.ok(
      connectedEdges.some((e) => e.startNodeId === nodeB.id || e.endNodeId === nodeB.id),
      "road edges must meet at shared junction nodeB"
    );

    // Verify unified road surface and valid surrounding terrain
    const topologies = f.runtime.getAllRegionTopologies();
    const pathTopos = topologies.filter((t) => t.surfaceType === "path");
    const terrainTopos = topologies.filter((t) => t.surfaceType === "terrain");
    assert.equal(pathTopos.length, 1, "roads must be unified into 1 surface region");
    assert.ok(terrainTopos.length > 0, "surrounding terrain faces must exist");
  } finally {
    f.session.free();
  }
});
