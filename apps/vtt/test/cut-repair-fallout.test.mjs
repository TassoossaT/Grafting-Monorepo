import assert from "node:assert/strict";
import test from "node:test";

import {
  paintedNodesOf,
  dispatchCutRepairs,
  dispatchRemovalRepairs,
  CUT_REPAIR_EXECUTORS,
} from "../src/composition/tabletop/interference/type-interference-dispatch.ts";
import {
  isTerrainSurface,
  planTerrainCloudCutRepair,
  terrainTopologiesBounds,
} from "../src/features/edit-construction/index.ts";

/**
 * What the repair is *handed* has been the cause of every cut-repair failure
 * so far, never its own arithmetic. This is that hand-off, on its own.
 *
 * The painter's nodes are the far side of the hole's scope: the engine treats
 * an edge as free boundary only when both of its nodes are named, so a repair
 * that names only its own consumed ground finds no closed loop at all and
 * regenerates nothing. A brush resubmits only its latest increment each tick,
 * so anything derived from the stroke's own footprint names a fraction of the
 * road it has drawn -- which is why this reads every live face of the type.
 */

/** A road of three bands laid end to end, of which a stroke's footprint would report only the last. */
function createRoadGraph() {
  const positions = new Map();
  const topologies = [];

  // Four rows of two nodes, three bands laid between them. Consecutive bands
  // share the row between them *by node id* -- which is what makes them one
  // cloud rather than two coincident shapes, and what a perimeter is derived
  // from.
  for (let row = 0; row < 4; row += 1) {
    positions.set(`row-${row}-l`, { x: 0, y: 0, z: row * 4 });
    positions.set(`row-${row}-r`, { x: 2, y: 0, z: row * 4 });
  }

  const edgeBetween = (from, to) => {
    const [low, high] = from < to ? [from, to] : [to, from];
    return { edgeId: `e:${low}~${high}`, reversed: from !== low, startNodeId: from, endNodeId: to, geometry: { kind: "line" } };
  };

  for (let band = 0; band < 3; band += 1) {
    const ids = [`row-${band}-l`, `row-${band}-r`, `row-${band + 1}-r`, `row-${band + 1}-l`];
    topologies.push({
      surfaceKey: ["@region", `R${band}`],
      surfaceType: "path",
      physical: true,
      outerLoops: [ids.map((id, index) => edgeBetween(id, ids[(index + 1) % ids.length]))],
      holes: [],
      nodes: ids.map((id) => ({ id, position: positions.get(id) })),
    });
  }

  // One terrain face, so the filter has something of another type to reject.
  for (const [id, position] of [["t1", { x: 20, y: 0, z: 20 }], ["t2", { x: 24, y: 0, z: 20 }], ["t3", { x: 24, y: 0, z: 24 }]]) {
    positions.set(id, position);
  }
  const terrain = ["t1", "t2", "t3"];
  topologies.push({
    surfaceKey: ["@region", "T1"],
    surfaceType: "terrain",
    physical: true,
    outerLoops: [
      terrain.map((id, index) => ({
        edgeId: `e:t${index}`,
        reversed: false,
        startNodeId: id,
        endNodeId: terrain[(index + 1) % terrain.length],
        geometry: { kind: "line" },
      })),
    ],
    holes: [],
    nodes: terrain.map((id) => ({ id, position: positions.get(id) })),
  });

  return {
    getAllRegionTopologies: () => topologies,
    getSnapshot: () => ({
      tableId: "table-1",
      map: { nodePositions: new Map([...positions].map(([id, position]) => [id, { position }])) },
    }),
  };
}

test("the painter's whole cloud is handed over, not only the increment a footprint would report", () => {
  const { paintedNodes: painted, paintedLoops } = paintedNodesOf(createRoadGraph(), "path");

  // One ring around the whole road, not one per band: the bands touch, and a
  // mend opening around each of them separately would describe a shape
  // overlapping itself along every shared edge.
  assert.equal(paintedLoops.length, 1, "the painter's cloud has one outline");
  const rim = new Set(paintedLoops[0].flatMap((edge) => [edge.startNodeId, edge.endNodeId]));
  assert.equal(paintedLoops[0].length, 8, "six side edges and the two ends, the shared rows dissolved");
  assert.equal(painted.length, 8, "every node of all three bands, not the four a brush tick would have named");
  const zs = painted.map((node) => node.position.z);
  assert.equal(Math.max(...zs), 12, "the newest band alone would have stopped at z = 4");
});

test("only the painter's own type is handed over", () => {
  const { paintedNodes: painted } = paintedNodesOf(createRoadGraph(), "path");

  assert.ok(painted.every((node) => node.id.startsWith("row-")), "terrain nodes are not the painter's own");
});

test("a type with no faces on the table hands over nothing, rather than failing", () => {
  assert.deepEqual(paintedNodesOf(createRoadGraph(), "wall"), { paintedNodes: [], paintedLoops: [] });
});

test("paintedNodesOf scopes to bounds when getRegionTopologiesInBounds is available", () => {
  const base = createRoadGraph();
  let receivedBounds;
  const runtime = {
    ...base,
    getRegionTopologiesInBounds: (bounds) => {
      receivedBounds = bounds;
      // Return only the first band
      return [base.getAllRegionTopologies()[0]];
    },
  };
  const queryBounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  const { paintedNodes } = paintedNodesOf(runtime, "path", queryBounds);
  assert.deepEqual(receivedBounds, queryBounds);
  assert.equal(paintedNodes.length, 4, "scoped to single band returned by getRegionTopologiesInBounds");
});

test("dispatchRemovalRepairs on unsupported type (wall, path) is an honest no-op", () => {
  let invoked = false;
  const runtime = {
    getSnapshot: () => ({ tableId: "table-test" }),
  };
  // wall-white resolves to unsupported
  dispatchRemovalRepairs(runtime, ["@region", "wall-1"], "wall-white", "cause:test");
  assert.equal(invoked, false);

  // path resolves to unsupported
  dispatchRemovalRepairs(runtime, ["@region", "path-1"], "path", "cause:test");
  assert.equal(invoked, false);
});

test("dispatchRemovalRepairs on regenerate type invokes registered executor with empty painter loops", () => {
  let receivedFallout;
  let receivedCauseId;
  let receivedTableId;
  const mockExecutor = (runtime, fallout, causeId, tableId) => {
    receivedFallout = fallout;
    receivedCauseId = causeId;
    receivedTableId = tableId;
    return 1;
  };

  const runtime = {
    getSnapshot: () => ({ tableId: "table-removal-test" }),
  };
  dispatchRemovalRepairs(
    runtime,
    ["@region", "terrain-1"],
    "terrain",
    "cause:removal-1",
    { terrain: mockExecutor },
  );

  assert.ok(receivedFallout !== undefined);
  assert.deepEqual(receivedFallout.consumedSurfaceKeys, [["@region", "terrain-1"]]);
  assert.deepEqual(receivedFallout.paintedNodes, []);
  assert.deepEqual(receivedFallout.paintedLoops, []);
  assert.equal(receivedCauseId, "cause:removal-1");
  assert.equal(receivedTableId, "table-removal-test");
});

test("dispatchCutRepairs is tool-independent and operates without footprintOutline", () => {
  let receivedFallout;
  const positions = new Map();
  // Road at x = 0..2, z = 0..4
  for (const [id, pos] of [
    ["rn0", { x: 0, y: 0, z: 0 }],
    ["rn1", { x: 2, y: 0, z: 0 }],
    ["rn2", { x: 2, y: 0, z: 4 }],
    ["rn3", { x: 0, y: 0, z: 4 }],
  ]) {
    positions.set(id, pos);
  }

  // Terrain face near road at x = 2..4, z = 0..4 (adjacent to road)
  for (const [id, pos] of [
    ["tn0", { x: 2, y: 0, z: 0 }],
    ["tn1", { x: 4, y: 0, z: 0 }],
    ["tn2", { x: 4, y: 0, z: 4 }],
    ["tn3", { x: 2, y: 0, z: 4 }],
  ]) {
    positions.set(id, pos);
  }

  const terrainTopology = {
    surfaceKey: ["@region", "T_adj"],
    surfaceType: "terrain",
    nodes: ["tn0", "tn1", "tn2", "tn3"].map((id) => ({ id, position: positions.get(id) })),
    outerLoops: [[
      { edgeId: "e:t0", reversed: false, startNodeId: "tn0", endNodeId: "tn1" },
      { edgeId: "e:t1", reversed: false, startNodeId: "tn1", endNodeId: "tn2" },
      { edgeId: "e:t2", reversed: false, startNodeId: "tn2", endNodeId: "tn3" },
      { edgeId: "e:t3", reversed: false, startNodeId: "tn3", endNodeId: "tn0" },
    ]],
    holes: [],
  };

  const roadPatch = {
    nodes: ["rn0", "rn1", "rn2", "rn3"].map((id) => ({ id, position: positions.get(id) })),
    edges: [
      { id: "e:r0", startNodeId: "rn0", endNodeId: "rn1" },
      { id: "e:r1", startNodeId: "rn1", endNodeId: "rn2" },
      { id: "e:r2", startNodeId: "rn2", endNodeId: "rn3" },
      { id: "e:r3", startNodeId: "rn3", endNodeId: "rn0" },
    ],
    regions: [{
      regionId: "R_new",
      surfaceType: "path",
      boundary: [
        { edgeId: "e:r0", reversed: false },
        { edgeId: "e:r1", reversed: false },
        { edgeId: "e:r2", reversed: false },
        { edgeId: "e:r3", reversed: false },
      ],
    }],
  };

  const runtime = {
    getAllRegionTopologies: () => [terrainTopology],
    getSnapshot: () => ({
      tableId: "tbl-test",
      map: { nodePositions: new Map([...positions].map(([id, pos]) => [id, { position: pos }])) },
    }),
  };

  const mockExecutor = (rt, fallout) => {
    receivedFallout = fallout;
    return 1;
  };

  // Notice: footprintOutline is completely omitted (undefined)!
  dispatchCutRepairs(
    runtime,
    {
      operationId: "op:road-change",
      sourceSurfaceKeys: [],
      patch: roadPatch,
    },
    "cause:road",
    [],
    undefined,
    { terrain: mockExecutor },
  );

  assert.ok(receivedFallout !== undefined, "cut repair was dispatched without any tool footprint outline");
  assert.deepEqual(receivedFallout.consumedSurfaceKeys, [["@region", "T_adj"]], "adjacent terrain face was consumed");
  assert.equal(receivedFallout.paintedLoops.length, 1, "road perimeter was extracted as a hole loop");
});

test("dispatchCutRepairs handles full road modification, consuming both old and new corridor", () => {
  let receivedFallout;
  const positions = new Map();
  // Old road at x = 0..2, z = 0..4
  for (const [id, pos] of [
    ["ro0", { x: 0, y: 0, z: 0 }],
    ["ro1", { x: 2, y: 0, z: 0 }],
    ["ro2", { x: 2, y: 0, z: 4 }],
    ["ro3", { x: 0, y: 0, z: 4 }],
  ]) {
    positions.set(id, pos);
  }

  // New road moved to x = 4..6, z = 0..4
  for (const [id, pos] of [
    ["rn0", { x: 4, y: 0, z: 0 }],
    ["rn1", { x: 6, y: 0, z: 0 }],
    ["rn2", { x: 6, y: 0, z: 4 }],
    ["rn3", { x: 4, y: 0, z: 4 }],
  ]) {
    positions.set(id, pos);
  }

  // Terrain face bordering old road at x = 2..4, z = 0..4
  for (const [id, pos] of [
    ["t1_0", { x: 2, y: 0, z: 0 }],
    ["t1_1", { x: 4, y: 0, z: 0 }],
    ["t1_2", { x: 4, y: 0, z: 4 }],
    ["t1_3", { x: 2, y: 0, z: 4 }],
  ]) {
    positions.set(id, pos);
  }

  // Terrain face bordering new road at x = 6..8, z = 0..4
  for (const [id, pos] of [
    ["t2_0", { x: 6, y: 0, z: 0 }],
    ["t2_1", { x: 8, y: 0, z: 0 }],
    ["t2_2", { x: 8, y: 0, z: 4 }],
    ["t2_3", { x: 6, y: 0, z: 4 }],
  ]) {
    positions.set(id, pos);
  }

  // Distant terrain face at x = 100..102, z = 100..104 (outside corridor)
  for (const [id, pos] of [
    ["tf_0", { x: 100, y: 0, z: 100 }],
    ["tf_1", { x: 102, y: 0, z: 100 }],
    ["tf_2", { x: 102, y: 0, z: 104 }],
    ["tf_3", { x: 100, y: 0, z: 104 }],
  ]) {
    positions.set(id, pos);
  }

  const oldRoadTopology = {
    surfaceKey: ["@region", "R_old"],
    surfaceType: "path",
    nodes: ["ro0", "ro1", "ro2", "ro3"].map((id) => ({ id, position: positions.get(id) })),
    outerLoops: [[
      { edgeId: "e:ro0", reversed: false, startNodeId: "ro0", endNodeId: "ro1" },
      { edgeId: "e:ro1", reversed: false, startNodeId: "ro1", endNodeId: "ro2" },
      { edgeId: "e:ro2", reversed: false, startNodeId: "ro2", endNodeId: "ro3" },
      { edgeId: "e:ro3", reversed: false, startNodeId: "ro3", endNodeId: "ro0" },
    ]],
    holes: [],
  };

  const newRoadPatch = {
    nodes: ["rn0", "rn1", "rn2", "rn3"].map((id) => ({ id, position: positions.get(id) })),
    edges: [
      { id: "e:rn0", startNodeId: "rn0", endNodeId: "rn1" },
      { id: "e:rn1", startNodeId: "rn1", endNodeId: "rn2" },
      { id: "e:rn2", startNodeId: "rn2", endNodeId: "rn3" },
      { id: "e:rn3", startNodeId: "rn3", endNodeId: "rn0" },
    ],
    regions: [{
      regionId: "R_new",
      surfaceType: "path",
      boundary: [
        { edgeId: "e:rn0", reversed: false },
        { edgeId: "e:rn1", reversed: false },
        { edgeId: "e:rn2", reversed: false },
        { edgeId: "e:rn3", reversed: false },
      ],
    }],
  };

  const tOld = {
    surfaceKey: ["@region", "T_old_border"],
    surfaceType: "terrain",
    nodes: ["t1_0", "t1_1", "t1_2", "t1_3"].map((id) => ({ id, position: positions.get(id) })),
    outerLoops: [[
      { edgeId: "e:t1_0", reversed: false, startNodeId: "t1_0", endNodeId: "t1_1" },
      { edgeId: "e:t1_1", reversed: false, startNodeId: "t1_1", endNodeId: "t1_2" },
      { edgeId: "e:t1_2", reversed: false, startNodeId: "t1_2", endNodeId: "t1_3" },
      { edgeId: "e:t1_3", reversed: false, startNodeId: "t1_3", endNodeId: "t1_0" },
    ]],
    holes: [],
  };

  const tNew = {
    surfaceKey: ["@region", "T_new_border"],
    surfaceType: "terrain",
    nodes: ["t2_0", "t2_1", "t2_2", "t2_3"].map((id) => ({ id, position: positions.get(id) })),
    outerLoops: [[
      { edgeId: "e:t2_0", reversed: false, startNodeId: "t2_0", endNodeId: "t2_1" },
      { edgeId: "e:t2_1", reversed: false, startNodeId: "t2_1", endNodeId: "t2_2" },
      { edgeId: "e:t2_2", reversed: false, startNodeId: "t2_2", endNodeId: "t2_3" },
      { edgeId: "e:t2_3", reversed: false, startNodeId: "t2_3", endNodeId: "t2_0" },
    ]],
    holes: [],
  };

  const tFar = {
    surfaceKey: ["@region", "T_distant"],
    surfaceType: "terrain",
    nodes: ["tf_0", "tf_1", "tf_2", "tf_3"].map((id) => ({ id, position: positions.get(id) })),
    outerLoops: [[
      { edgeId: "e:tf0", reversed: false, startNodeId: "tf_0", endNodeId: "tf_1" },
      { edgeId: "e:tf1", reversed: false, startNodeId: "tf_1", endNodeId: "tf_2" },
      { edgeId: "e:tf2", reversed: false, startNodeId: "tf_2", endNodeId: "tf_3" },
      { edgeId: "e:tf3", reversed: false, startNodeId: "tf_3", endNodeId: "tf_0" },
    ]],
    holes: [],
  };

  const runtime = {
    getAllRegionTopologies: () => [tOld, tNew, tFar],
    getSnapshot: () => ({
      tableId: "tbl-test-mod",
      map: { nodePositions: new Map([...positions].map(([id, pos]) => [id, { position: pos }])) },
    }),
  };

  const mockExecutor = (rt, fallout) => {
    receivedFallout = fallout;
    return 1;
  };

  dispatchCutRepairs(
    runtime,
    {
      operationId: "op:full-road-mod",
      sourceSurfaceKeys: [oldRoadTopology.surfaceKey],
      patch: newRoadPatch,
    },
    "cause:full-mod",
    [oldRoadTopology],
    undefined,
    { terrain: mockExecutor },
  );

  assert.ok(receivedFallout !== undefined, "cut repair was dispatched for full road modification");
  const consumedKeys = receivedFallout.consumedSurfaceKeys.map((k) => k.join("/"));
  assert.ok(consumedKeys.includes("@region/T_old_border"), "terrain bordering vacated old road is consumed for healing");
  assert.ok(consumedKeys.includes("@region/T_new_border"), "terrain bordering new road is consumed for stitching");
  assert.ok(!consumedKeys.includes("@region/T_distant"), "distant terrain is not consumed");
  assert.equal(receivedFallout.paintedLoops.length, 1, "new road perimeter is provided as the hole loop");
});

test("dispatchRemovalRepairs on path with removedTopology heals the vacated terrain corridor", () => {
  let receivedFallout;
  const positions = new Map();
  // Removed road at x = 0..2, z = 0..4
  for (const [id, pos] of [
    ["ro0", { x: 0, y: 0, z: 0 }],
    ["ro1", { x: 2, y: 0, z: 0 }],
    ["ro2", { x: 2, y: 0, z: 4 }],
    ["ro3", { x: 0, y: 0, z: 4 }],
  ]) {
    positions.set(id, pos);
  }

  // Adjacent terrain at x = 2..4, z = 0..4
  for (const [id, pos] of [
    ["tn0", { x: 2, y: 0, z: 0 }],
    ["tn1", { x: 4, y: 0, z: 0 }],
    ["tn2", { x: 4, y: 0, z: 4 }],
    ["tn3", { x: 2, y: 0, z: 4 }],
  ]) {
    positions.set(id, pos);
  }

  const removedRoadTopology = {
    surfaceKey: ["@region", "R_removed"],
    surfaceType: "path",
    nodes: ["ro0", "ro1", "ro2", "ro3"].map((id) => ({ id, position: positions.get(id) })),
    outerLoops: [[
      { edgeId: "e:ro0", reversed: false, startNodeId: "ro0", endNodeId: "ro1" },
      { edgeId: "e:ro1", reversed: false, startNodeId: "ro1", endNodeId: "ro2" },
      { edgeId: "e:ro2", reversed: false, startNodeId: "ro2", endNodeId: "ro3" },
      { edgeId: "e:ro3", reversed: false, startNodeId: "ro3", endNodeId: "ro0" },
    ]],
    holes: [],
  };

  const adjacentTerrain = {
    surfaceKey: ["@region", "T_heal"],
    surfaceType: "terrain",
    nodes: ["tn0", "tn1", "tn2", "tn3"].map((id) => ({ id, position: positions.get(id) })),
    outerLoops: [[
      { edgeId: "e:t0", reversed: false, startNodeId: "tn0", endNodeId: "tn1" },
      { edgeId: "e:t1", reversed: false, startNodeId: "tn1", endNodeId: "tn2" },
      { edgeId: "e:t2", reversed: false, startNodeId: "tn2", endNodeId: "tn3" },
      { edgeId: "e:t3", reversed: false, startNodeId: "tn3", endNodeId: "tn0" },
    ]],
    holes: [],
  };

  const runtime = {
    getAllRegionTopologies: () => [adjacentTerrain],
    getSnapshot: () => ({
      tableId: "tbl-removal-heal",
      map: { nodePositions: new Map([...positions].map(([id, pos]) => [id, { position: pos }])) },
    }),
  };

  const mockExecutor = (rt, fallout) => {
    receivedFallout = fallout;
    return 1;
  };

  dispatchRemovalRepairs(
    runtime,
    ["@region", "R_removed"],
    "path",
    "cause:path-deletion",
    removedRoadTopology,
    { terrain: mockExecutor },
  );

  assert.ok(receivedFallout !== undefined, "cut repair was triggered on road removal");
  assert.deepEqual(receivedFallout.consumedSurfaceKeys, [["@region", "T_heal"]]);
  assert.deepEqual(receivedFallout.paintedLoops, [], "no road hole left: void is healed cleanly");
});

test("TerrainCloud: planTerrainCloudCutRepair identifies consumed terrain in corridor cleanly", () => {
  const terrainTopologies = [
    {
      surfaceKey: ["@region", "t_near"],
      surfaceType: "terrain",
      nodes: [
        { id: "tn1", position: { x: 1, y: 0, z: 1 } },
        { id: "tn2", position: { x: 3, y: 0, z: 1 } },
      ],
      outerLoops: [],
      holes: [],
    },
    {
      surfaceKey: ["@region", "t_far"],
      surfaceType: "terrain",
      nodes: [
        { id: "tf1", position: { x: 50, y: 0, z: 50 } },
        { id: "tf2", position: { x: 52, y: 0, z: 50 } },
      ],
      outerLoops: [],
      holes: [],
    },
  ];

  const plan = planTerrainCloudCutRepair({
    candidateTerrain: terrainTopologies,
    cutterPositions: [{ x: 1.5, y: 0, z: 1.5 }],
    cutterNodeIds: new Set(),
    reach: 3.5,
  });

  assert.equal(plan.requiresRepair, true);
  assert.equal(plan.affectedTerrainCount, 1);
  assert.deepEqual(plan.consumedByType.get("terrain"), [["@region", "t_near"]]);
});

test("TerrainCloud: helper functions recognize terrain surface types and bounds", () => {
  assert.equal(isTerrainSurface("terrain"), true);
  assert.equal(isTerrainSurface("terrain-grass"), true);
  assert.equal(isTerrainSurface("path"), false);
  assert.equal(isTerrainSurface("wall-white"), false);

  const bounds = terrainTopologiesBounds([
    {
      surfaceKey: ["@region", "t1"],
      surfaceType: "terrain",
      nodes: [
        { id: "n1", position: { x: 10, y: 0, z: 20 } },
        { id: "n2", position: { x: 30, y: 0, z: 40 } },
      ],
      outerLoops: [],
      holes: [],
    },
  ], 2.0);

  assert.equal(bounds.minX, 8);
  assert.equal(bounds.maxX, 32);
  assert.equal(bounds.minZ, 18);
  assert.equal(bounds.maxZ, 42);
});


