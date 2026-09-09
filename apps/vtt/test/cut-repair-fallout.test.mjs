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
  pointInOrOnPolygon,
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

test("TerrainCloud: surgical consumption with footprintOutline/coverage does NOT consume innocent terrain 2-3m away", () => {
  // Road polygon at x = 0..2, z = 0..10
  const roadOutline = [
    [0, 0],
    [2, 0],
    [2, 10],
    [0, 10],
  ];

  const terrainTopologies = [
    // Under road (covered): x = 0..2, z = 2..4
    {
      surfaceKey: ["@region", "t_covered"],
      surfaceType: "terrain",
      nodes: [
        { id: "tc1", position: { x: 0, y: 0, z: 2 } },
        { id: "tc2", position: { x: 2, y: 0, z: 2 } },
        { id: "tc3", position: { x: 2, y: 0, z: 4 } },
        { id: "tc4", position: { x: 0, y: 0, z: 4 } },
      ],
      outerLoops: [],
      holes: [],
    },
    // Innocent terrain 2.5m away from road: x = 4.5..6.5, z = 2..4 (outside road!)
    {
      surfaceKey: ["@region", "t_innocent_near"],
      surfaceType: "terrain",
      nodes: [
        { id: "ti1", position: { x: 4.5, y: 0, z: 2 } },
        { id: "ti2", position: { x: 6.5, y: 0, z: 2 } },
        { id: "ti3", position: { x: 6.5, y: 0, z: 4 } },
        { id: "ti4", position: { x: 4.5, y: 0, z: 4 } },
      ],
      outerLoops: [],
      holes: [],
    },
  ];

  const plan = planTerrainCloudCutRepair({
    candidateTerrain: terrainTopologies,
    cutterPositions: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 10 },
      { x: 0, y: 0, z: 10 },
    ],
    cutterNodeIds: new Set(["rn0", "rn1"]),
    footprintOutline: roadOutline,
  });

  assert.equal(plan.requiresRepair, true);
  assert.equal(plan.affectedTerrainCount, 1, "only the covered terrain is affected");
  const consumed = plan.consumedByType.get("terrain")?.map((k) => k.join("/"));
  assert.ok(consumed?.includes("@region/t_covered"), "covered face is consumed");
  assert.ok(!consumed?.includes("@region/t_innocent_near"), "innocent face 2.5m away is preserved, preventing fragmentation!");
});

test("dispatchCutRepairs extracts complete closed paintedLoops from newRoadTopologies despite partial roadInBounds", () => {
  let receivedFallout;
  const positions = new Map();

  // Long existing road spanning from z = -100 to z = 100
  // Sliced in bounds: only parts between z = 0..10 are in bounds
  const partialRoadFace = {
    surfaceKey: ["@region", "R_existing_partial"],
    surfaceType: "path",
    nodes: [
      { id: "ex0", position: { x: 0, y: 0, z: -10 } },
      { id: "ex1", position: { x: 2, y: 0, z: -10 } },
      { id: "ex2", position: { x: 2, y: 0, z: 50 } },
      { id: "ex3", position: { x: 0, y: 0, z: 50 } },
    ],
    outerLoops: [[
      // An open chain representing a slice across a bounding box
      { edgeId: "e:slice0", reversed: false, startNodeId: "ex0", endNodeId: "ex1" },
      { edgeId: "e:slice1", reversed: false, startNodeId: "ex1", endNodeId: "ex2" },
    ]],
    holes: [],
  };

  // The newly created road patch (a clean, closed 4-node quad)
  for (const [id, pos] of [
    ["rn0", { x: 0, y: 0, z: 0 }],
    ["rn1", { x: 2, y: 0, z: 0 }],
    ["rn2", { x: 2, y: 0, z: 4 }],
    ["rn3", { x: 0, y: 0, z: 4 }],
  ]) {
    positions.set(id, pos);
  }

  const newRoadPatch = {
    nodes: ["rn0", "rn1", "rn2", "rn3"].map((id) => ({ id, position: positions.get(id) })),
    edges: [
      { id: "e:rn0", startNodeId: "rn0", endNodeId: "rn1" },
      { id: "e:rn1", startNodeId: "rn1", endNodeId: "rn2" },
      { id: "e:rn2", startNodeId: "rn2", endNodeId: "rn3" },
      { id: "e:rn3", startNodeId: "rn3", endNodeId: "rn0" },
    ],
    regions: [{
      regionId: "R_new_stroke",
      surfaceType: "path",
      boundary: [
        { edgeId: "e:rn0", reversed: false },
        { edgeId: "e:rn1", reversed: false },
        { edgeId: "e:rn2", reversed: false },
        { edgeId: "e:rn3", reversed: false },
      ],
    }],
  };

  const terrainFace = {
    surfaceKey: ["@region", "T_covered_face"],
    surfaceType: "terrain",
    nodes: ["rn0", "rn1", "rn2", "rn3"].map((id) => ({ id, position: positions.get(id) })),
    outerLoops: [[
      { edgeId: "e:t0", reversed: false, startNodeId: "rn0", endNodeId: "rn1" },
      { edgeId: "e:t1", reversed: false, startNodeId: "rn1", endNodeId: "rn2" },
      { edgeId: "e:t2", reversed: false, startNodeId: "rn2", endNodeId: "rn3" },
      { edgeId: "e:t3", reversed: false, startNodeId: "rn3", endNodeId: "rn0" },
    ]],
    holes: [],
  };

  const runtime = {
    getAllRegionTopologies: () => [partialRoadFace, terrainFace],
    getRegionTopologiesInBounds: () => [partialRoadFace, terrainFace],
    getRegionTopology: (key) => {
      if (key[1] === "R_new_stroke") {
        return {
          surfaceKey: key,
          surfaceType: "path",
          nodes: newRoadPatch.nodes,
          outerLoops: [[
            { edgeId: "e:rn0", reversed: false, startNodeId: "rn0", endNodeId: "rn1" },
            { edgeId: "e:rn1", reversed: false, startNodeId: "rn1", endNodeId: "rn2" },
            { edgeId: "e:rn2", reversed: false, startNodeId: "rn2", endNodeId: "rn3" },
            { edgeId: "e:rn3", reversed: false, startNodeId: "rn3", endNodeId: "rn0" },
          ]],
          holes: [],
        };
      }
      return undefined;
    },
    getSnapshot: () => ({
      tableId: "tbl-road-bounds-test",
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
      operationId: "op:road-patch-bounds",
      sourceSurfaceKeys: [],
      patch: newRoadPatch,
      footprintOutline: [[0, 0], [2, 0], [2, 4], [0, 4]],
    },
    "cause:road-bounds",
    [],
    {
      createdSurfaceKeys: [["@region", "R_new_stroke"]],
      deletedSurfaceKeys: [],
      createdEdges: [],
      deletedEdgeIds: [],
    },
    { terrain: mockExecutor },
  );

  assert.ok(receivedFallout !== undefined);
  assert.equal(receivedFallout.paintedLoops.length, 1, "paintedLoops is a closed ring from newRoadTopologies, NOT empty []!");
  assert.equal(receivedFallout.paintedNodes.length, 4, "all 4 nodes of the new road are present");
});

test("adjacent terrain faces bordering the road footprint without centroid inside are not marked as cut", () => {
  // Road outline from x=8 to 12, z=0 to 20
  const roadOutline = [[8, 0], [12, 0], [12, 20], [8, 20]];

  // Terrain face A is inside the road: x=9 to 11, z=5 to 15 (centroid at 10, 10)
  const faceInside = {
    surfaceKey: ["@region", "inside"],
    surfaceType: "terrain",
    nodes: [
      { id: "i1", position: { x: 9, y: 0, z: 5 } },
      { id: "i2", position: { x: 11, y: 0, z: 5 } },
      { id: "i3", position: { x: 11, y: 0, z: 15 } },
      { id: "i4", position: { x: 9, y: 0, z: 15 } },
    ],
  };

  // Terrain face B borders the road: shares vertices on x=8, but centroid is at x=4 (outside!)
  const faceBordering = {
    surfaceKey: ["@region", "bordering"],
    surfaceType: "terrain",
    nodes: [
      { id: "b1", position: { x: 0, y: 0, z: 0 } },
      { id: "b2", position: { x: 8, y: 0, z: 0 } },
      { id: "b3", position: { x: 8, y: 0, z: 20 } },
      { id: "b4", position: { x: 0, y: 0, z: 20 } },
    ],
  };

  const plan = planTerrainCloudCutRepair({
    candidateTerrain: [faceInside, faceBordering],
    cutterPositions: [{ x: 10, y: 0, z: 10 }],
    cutterNodeIds: new Set(), // no replaced geometry
    coverageSurfaceKeys: new Set(),
    footprintOutline: roadOutline,
  });

  const consumedKeys = plan.consumedByType.get("terrain") ?? [];
  assert.equal(consumedKeys.length, 1, "only the face inside the outline is consumed");
  assert.equal(consumedKeys[0]?.[1], "inside", "bordering face outside outline is NOT consumed or fragmented");
});

test("joining multiple path clouds protects foreign road faces from erasure", () => {
  // Road 1 (corridor 1)
  const road1 = {
    surfaceKey: ["@region", "op-1:band-0:0"],
    surfaceType: "path",
    nodes: [
      { id: "contour:op-1:0", position: { x: 0, y: 0, z: 0 } },
      { id: "contour:op-1:1", position: { x: 10, y: 0, z: 0 } },
      { id: "shared-weld", position: { x: 10, y: 0, z: 2 } },
      { id: "contour:op-1:2", position: { x: 0, y: 0, z: 2 } },
    ],
  };

  // Road 2 (corridor 2) which was joined to Road 1 at shared-weld
  const road2 = {
    surfaceKey: ["@region", "op-2:band-0:0"],
    surfaceType: "path",
    nodes: [
      { id: "shared-weld", position: { x: 10, y: 0, z: 2 } },
      { id: "contour:op-2:0", position: { x: 20, y: 0, z: 2 } },
      { id: "contour:op-2:1", position: { x: 20, y: 0, z: 4 } },
      { id: "contour:op-2:2", position: { x: 10, y: 0, z: 4 } },
    ],
  };

  // When a new stroke edits or continues corridor 2 only:
  // planTerrainCloudCutRepair only targets terrain, never path faces!
  const terrainPlan = planTerrainCloudCutRepair({
    candidateTerrain: [road1, road2],
    cutterPositions: [{ x: 15, y: 0, z: 3 }],
    footprintOutline: [[10, 2], [20, 2], [20, 4], [10, 4]],
  });
  assert.equal(terrainPlan.affectedTerrainCount, 0, "path surfaces are never consumed by terrain repair");
});





/**
 * A road regenerates its whole connected component on every stroke, re-minting
 * every node in it -- including the ones a terrain repair split into its edges
 * so the two could share a corner. The terrain holding those corners is mostly
 * nowhere near the stroke that triggered the regeneration, and scoping the
 * search to that stroke's footprint meant it was never looked for: it went on
 * naming nodes that no longer existed, and the ground visibly came away from
 * the road as the network filled in.
 */
test("terrain welded to road the stroke re-mints is repaired, however far from the stroke", () => {
  const consumed = [];
  const positions = new Map();
  const put = (id, x, z) => positions.set(id, { x, y: 0, z });

  // The stroke, down at z = 0.
  for (const [id, x, z] of [["s0", 0, 0], ["s1", 2, 0], ["s2", 2, 4], ["s3", 0, 4]]) put(id, x, z);
  // The far end of the same road component, forty units away, and the corner
  // a previous repair split into its edge for the ground to share.
  for (const [id, x, z] of [["f0", 0, 36], ["f1", 2, 36], ["f2", 2, 40], ["f3", 0, 40]]) put(id, x, z);
  // Terrain standing against that far end, holding "f1" and "f2" with it.
  for (const [id, x, z] of [["g0", 4, 36], ["g1", 4, 40]]) put(id, x, z);

  const loopOf = (ids) =>
    ids.map((id, index) => {
      const next = ids[(index + 1) % ids.length];
      return { edgeId: `e:${id}~${next}`, reversed: false, startNodeId: id, endNodeId: next, geometry: { kind: "line" } };
    });
  const faceOf = (key, type, ids) => ({
    surfaceKey: key,
    surfaceType: type,
    physical: true,
    outerLoops: [loopOf(ids)],
    holes: [],
    nodes: ids.map((id) => ({ id, position: positions.get(id) })),
  });

  // The road faces this stroke replaces: its own, and the far one it re-mints
  // for no reason other than being in the same component.
  const replaced = [
    faceOf(["@region", "road-near"], "path", ["s0", "s1", "s2", "s3"]),
    faceOf(["@region", "road-far"], "path", ["f0", "f1", "f2", "f3"]),
  ];
  // The ground welded to the far end -- it shares f1 and f2 by node id.
  const farGround = faceOf(["terrain", "far"], "terrain", ["f1", "g0", "g1", "f2"]);

  const inBounds = (topology, bounds) =>
    topology.nodes.some(
      (node) =>
        node.position.x >= bounds.minX &&
        node.position.x <= bounds.maxX &&
        node.position.z >= bounds.minZ &&
        node.position.z <= bounds.maxZ,
    );

  const runtime = {
    getAllRegionTopologies: () => [farGround, ...replaced],
    getRegionTopologiesInBounds: (bounds) => [farGround, ...replaced].filter((t) => inBounds(t, bounds)),
    getRegionTopology: () => undefined,
    getSnapshot: () => ({ tableId: "t", map: { nodePositions: positions } }),
  };

  const request = {
    operationId: "op",
    sourceSurfaceKeys: replaced.map((t) => t.surfaceKey),
    patch: { nodes: [], edges: [], regions: [{ regionId: "new", surfaceType: "path", physical: true, boundary: [] }] },
    // Only the stroke. This is what a path actually reports -- see
    // path-cloud-mutation.ts, "the footprint this stroke alone claims".
    footprintOutline: [
      [0, 0],
      [2, 0],
      [2, 4],
      [0, 4],
    ],
  };

  dispatchCutRepairs(runtime, request, "cause", replaced, undefined, {
    terrain: (_runtime, fallout) => {
      consumed.push(...fallout.consumedSurfaceKeys.map((key) => key.join(" ")));
      return 1;
    },
  });

  // The stroke's own footprint reaches z = 4 at most; this ground starts at 36.
  assert.ok(
    !inBounds(farGround, { minX: -2.5, minZ: -2.5, maxX: 4.5, maxZ: 6.5 }),
    "the ground really is outside the stroke's footprint",
  );
  assert.ok(
    consumed.includes("terrain far"),
    `ground holding a node the stroke destroys is repaired, got ${JSON.stringify(consumed)}`,
  );
});
