import assert from "node:assert/strict";
import test from "node:test";

import { stepTerrain } from "../src/composition/tabletop/tools/terrain/terrain-stepped.ts";

function createMockTopology(surfaceKey, nodes, edges) {
  return {
    surfaceKey,
    surfaceType: "terrain",
    physical: true,
    outerLoops: [edges],
    holes: [],
    nodes: nodes.map((id) => ({
      id,
      position: { x: 0, y: 0, z: 0 },
      surfaceType: "terrain",
      physical: true,
    })),
  };
}

test("stepTerrain excavates affected faces and stitches vertical sidewalls to retained neighbours", () => {
  // 2x2 lattice of vertices:
  // v00(0,0) --- v10(1,0) --- v20(2,0)
  //  |   Q0       |   Q1       |
  // v01(0,1) --- v11(1,1) --- v21(2,1)
  const nodePositions = new Map([
    ["v00", { position: { x: 0, y: 0, z: 0 } }],
    ["v10", { position: { x: 1, y: 0, z: 0 } }],
    ["v20", { position: { x: 2, y: 0, z: 0 } }],
    ["v01", { position: { x: 0, y: 0, z: 1 } }],
    ["v11", { position: { x: 1, y: 0, z: 1 } }],
    ["v21", { position: { x: 2, y: 0, z: 1 } }],
  ]);

  // Q0 retained: [v00, v10, v11, v01]
  const q0 = createMockTopology(
    ["v00", "v10", "v11", "v01"],
    ["v00", "v10", "v11", "v01"],
    [
      { edgeId: "tbl:seg:v00~v10", startNodeId: "v00", endNodeId: "v10", reversed: false, geometry: { kind: "line" } },
      { edgeId: "tbl:seg:v10~v11", startNodeId: "v10", endNodeId: "v11", reversed: false, geometry: { kind: "line" } },
      { edgeId: "tbl:seg:v01~v11", startNodeId: "v11", endNodeId: "v01", reversed: true, geometry: { kind: "line" } },
      { edgeId: "tbl:seg:v00~v01", startNodeId: "v01", endNodeId: "v00", reversed: true, geometry: { kind: "line" } },
    ],
  );

  // Q1 affected (to be excavated): [v10, v20, v21, v11]
  // Note edge "tbl:seg:v10~v11" is shared between Q0 and Q1:
  // Q0 walked it v10 -> v11. Q1 walks it v11 -> v10.
  const q1 = createMockTopology(
    ["v10", "v20", "v21", "v11"],
    ["v10", "v20", "v21", "v11"],
    [
      { edgeId: "tbl:seg:v10~v20", startNodeId: "v10", endNodeId: "v20", reversed: false, geometry: { kind: "line" } },
      { edgeId: "tbl:seg:v20~v21", startNodeId: "v20", endNodeId: "v21", reversed: false, geometry: { kind: "line" } },
      { edgeId: "tbl:seg:v11~v21", startNodeId: "v21", endNodeId: "v11", reversed: true, geometry: { kind: "line" } },
      { edgeId: "tbl:seg:v10~v11", startNodeId: "v11", endNodeId: "v10", reversed: true, geometry: { kind: "line" } },
    ],
  );

  let capturedRequest = null;
  const mockRuntime = {
    getSnapshot: () => ({ map: { nodePositions } }),
    applyPatchReplacement: (req) => {
      capturedRequest = req;
      return {
        affectedSurfaceKeys: [],
        createdSurfaceKeys: req.patch.regions.map((r) => [r.regionId]),
        removedSurfaceKeys: req.sourceSurfaceKeys,
        createdNodeIds: req.patch.nodes.map((n) => n.id),
        removedNodeIds: [],
        skippedRegionIds: [],
        skippedRegionReasons: [],
      };
    },
  };

  let seq = 0;
  const ctx = {
    tableId: "tbl",
    runtime: mockRuntime,
    nextSequence: () => ++seq,
  };

  const outcome = stepTerrain(ctx, "terrain", [q1], [q0], -2.0, "cause-1");

  assert.equal(outcome.floorFaces, 1, "1 floor face created");
  assert.equal(outcome.sidewallFaces, 1, "1 vertical sidewall created along shared edge");
  assert.ok(capturedRequest !== null);
  assert.equal(capturedRequest.patch.regions.length, 2);

  // Check floor node positions have Y = -2.0
  for (const node of capturedRequest.patch.nodes) {
    assert.equal(node.position.y, -2.0);
  }

  // Check that sidewall connects the top edge to the bottom edge
  const wall = capturedRequest.patch.regions.find((r) => r.regionId.includes(":wall:"));
  assert.ok(wall !== null);
  assert.equal(wall.boundary.length, 4);

  // The top edge of the wall should use "tbl:seg:v10~v11" in direction v11 -> v10 (the free side)
  const topUse = wall.boundary.find((u) => u.edgeId === "tbl:seg:v10~v11");
  assert.ok(topUse !== null);
  assert.equal(topUse.reversed, true);
});
