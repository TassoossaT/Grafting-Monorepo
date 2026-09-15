import assert from "node:assert/strict";
import test from "node:test";

import { hasTrait, surfaceTypesWithTrait } from "../src/features/edit-construction/structure-types/registry.ts";
import { executeTerrainCut } from "../src/composition/tabletop/terrain/terrain-cut-executor.ts";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { DEFAULT_TOOL_PARAMS } from "../src/features/edit-construction/tools/tool-types.ts";

test("ground is a declared trait, not a name prefix", () => {
  assert.deepEqual(surfaceTypesWithTrait("ground"), ["terrain", "terrain-grass"]);
  // An undeclared name that merely looks like terrain is not ground.
  assert.equal(hasTrait("terrain-snow", "ground"), false);
  for (const surfaceType of ["wall-white", "wall-gray", "platform", "platform-slope", "roof", "path", "door", "window"]) {
    assert.equal(hasTrait(surfaceType, "ground"), false, `${surfaceType} is not ground`);
  }
});

test("executeTerrainCut: isolates non-terrain structures (never splits edges or mutates vertices of walls/platforms)", () => {
  const wallTopology = {
    surfaceKey: ["wall", "w1"],
    surfaceType: "wall-white",
    physical: true,
    nodes: [
      { id: "w0", position: { x: 0, y: 0, z: 0 } },
      { id: "w1", position: { x: 4, y: 0, z: 0 } },
      { id: "w2", position: { x: 4, y: 3, z: 0 } },
      { id: "w3", position: { x: 0, y: 3, z: 0 } },
    ],
    outerLoops: [
      [
        { startNodeId: "w0", endNodeId: "w1", forward: true },
        { startNodeId: "w1", endNodeId: "w2", forward: true },
        { startNodeId: "w2", endNodeId: "w3", forward: true },
        { startNodeId: "w3", endNodeId: "w0", forward: true },
      ],
    ],
    holes: [],
  };

  const appliedPatches = [];
  const appliedReplacements = [];
  const regionEditOps = [];

  const mockRuntime = {
    getFootprintCoverage: () => [{ surfaceKey: ["wall", "w1"], surfaceType: "wall-white", coverage: "centroid" }],
    getAllRegionTopologies: () => [wallTopology],
    getRegionTopologiesInBounds: () => [wallTopology],
    getSnapshot: () => ({ tableId: "t", map: { nodePositions: new Map() } }),
    generateIrregularQuadGrid: () => ({
      vertices: [
        { x: 1, z: 1 },
        { x: 3, z: 1 },
        { x: 3, z: 3 },
        { x: 1, z: 3 },
      ],
      quads: [[0, 1, 2, 3]],
      onContour: [],
    }),
    addPatch: (patch) => {
      appliedPatches.push(patch);
      return { createdSurfaceKeys: [["terrain", "t1"]], removedSurfaceKeys: [], skippedRegionIds: [] };
    },
    applyPatchReplacement: (req) => {
      appliedReplacements.push(req);
      return { createdSurfaceKeys: [["terrain", "t1"]], removedSurfaceKeys: [], skippedRegionIds: [] };
    },
    applyRegionEdit: (ops) => {
      regionEditOps.push(...ops);
    },
  };

  // Calling with targetSurfaceType as a non-terrain type (e.g. wall-white) falls back to "terrain"
  // and does NOT delete or replace the wall, and does NOT split its edges.
  const outcome = executeTerrainCut(mockRuntime, {
    area: {
      outline: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      radius: 4,
    },
    targetSurfaceType: "wall-white",
    profile: { kind: "convex", height: 2 },
    causeId: "test-cause",
    tableId: "t",
  });

  assert.equal(outcome.success, true);
  assert.equal(outcome.removedFaces, 0, "non-terrain faces must not be counted as affected or removed");
  assert.equal(appliedReplacements.length, 0, "must not call applyPatchReplacement on non-terrain faces");
  assert.equal(appliedPatches.length, 1, "adds fresh terrain patch");
  assert.equal(appliedPatches[0].regions[0].surfaceType, "terrain", "generated terrain must have terrain surfaceType");

  // CRITICAL: verify zero edge splits or vertex mutations on the wall
  const edgeSplits = regionEditOps.filter((op) => op.kind === "split-edge");
  assert.equal(edgeSplits.length, 0, "must never split edges of non-terrain topologies");
});

test("terrainSculptTool: add mode creates terrain successfully even when starting on empty ground", () => {
  const feedbacks = [];
  const addedPatches = [];

  const mockContext = {
    tableId: "table-1",
    nextSequence: () => 1,
    reportFeedback: (fb) => feedbacks.push(fb),
    history: { record() {} },
    runtime: {
      transact: (_id, _origin, work) => ({ value: work(), recorded: true }),
      getFootprintCoverage: () => [],
      getAllRegionTopologies: () => [],
      getRegionTopologiesInBounds: () => [],
      getSnapshot: () => ({ tableId: "table-1", map: { nodePositions: new Map() } }),
      generateHeightmap: () => new Float32Array(100),
      generateIrregularQuadGrid: () => ({
        vertices: [
          { x: 1, z: 1 },
          { x: 3, z: 1 },
          { x: 3, z: 3 },
          { x: 1, z: 3 },
        ],
        quads: [[0, 1, 2, 3]],
        onContour: [],
      }),
      addPatch: (patch) => {
        addedPatches.push(patch);
        return { createdSurfaceKeys: [["terrain", "t1"]], removedSurfaceKeys: [], skippedRegionIds: [] };
      },
      applyPatchReplacement: () => ({ createdSurfaceKeys: [], removedSurfaceKeys: [], skippedRegionIds: [] }),
      applyRegionEdit: () => {},
    },
  };

  const gesture = {
    samples: [
      { point: { x: 2, y: 0, z: 2 } },
      { point: { x: 4, y: 0, z: 2 } },
    ],
  };

  terrainSculptTool.onPointerUp(mockContext, gesture, {
    ...DEFAULT_TOOL_PARAMS["terrain-sculpt"],
    mode: "add",
  });

  assert.equal(feedbacks.length, 1);
  assert.equal(feedbacks[0].tone, "success");
  assert.match(feedbacks[0].message, /Terreno: \d+ faces elevadas/);
  assert.equal(addedPatches.length, 1);
  assert.equal(addedPatches[0].regions[0].surfaceType, "terrain");
});

test("terrainSculptTool: add mode overlapping a wall creates terrain without modifying wall and without error", () => {
  const feedbacks = [];
  const addedPatches = [];
  const regionEditOps = [];

  const wallTopology = {
    surfaceKey: ["wall", "w1"],
    surfaceType: "wall-white",
    physical: true,
    nodes: [
      { id: "w0", position: { x: 0, y: 0, z: 0 } },
      { id: "w1", position: { x: 4, y: 0, z: 0 } },
      { id: "w2", position: { x: 4, y: 3, z: 0 } },
      { id: "w3", position: { x: 0, y: 3, z: 0 } },
    ],
    outerLoops: [
      [
        { startNodeId: "w0", endNodeId: "w1", forward: true },
        { startNodeId: "w1", endNodeId: "w2", forward: true },
        { startNodeId: "w2", endNodeId: "w3", forward: true },
        { startNodeId: "w3", endNodeId: "w0", forward: true },
      ],
    ],
    holes: [],
  };

  const mockContext = {
    tableId: "table-1",
    nextSequence: () => 1,
    reportFeedback: (fb) => feedbacks.push(fb),
    history: { record() {} },
    runtime: {
      transact: (_id, _origin, work) => ({ value: work(), recorded: true }),
      getFootprintCoverage: () => [
        {
          surfaceKey: ["wall", "w1"],
          surfaceType: "wall-white",
          coverage: "centroid",
          nodeIds: ["w0", "w1", "w2", "w3"],
        },
      ],
      getAllRegionTopologies: () => [wallTopology],
      getRegionTopologiesInBounds: () => [wallTopology],
      getSnapshot: () => ({ tableId: "table-1", map: { nodePositions: new Map() } }),
      generateHeightmap: () => new Float32Array(100),
      generateIrregularQuadGrid: () => ({
        vertices: [
          { x: 1, z: 1 },
          { x: 3, z: 1 },
          { x: 3, z: 3 },
          { x: 1, z: 3 },
        ],
        quads: [[0, 1, 2, 3]],
        onContour: [],
      }),
      addPatch: (patch) => {
        addedPatches.push(patch);
        return { createdSurfaceKeys: [["terrain", "t1"]], removedSurfaceKeys: [], skippedRegionIds: [] };
      },
      applyPatchReplacement: () => ({ createdSurfaceKeys: [], removedSurfaceKeys: [], skippedRegionIds: [] }),
      applyRegionEdit: (ops) => {
        regionEditOps.push(...ops);
      },
    },
  };

  const gesture = {
    samples: [
      { point: { x: 2, y: 0, z: 2 } },
      { point: { x: 4, y: 0, z: 2 } },
    ],
  };

  terrainSculptTool.onPointerUp(mockContext, gesture, {
    ...DEFAULT_TOOL_PARAMS["terrain-sculpt"],
    mode: "add",
  });

  assert.equal(feedbacks.length, 1);
  assert.equal(feedbacks[0].tone, "success");
  assert.equal(addedPatches.length, 1);
  assert.equal(addedPatches[0].regions[0].surfaceType, "terrain");

  // Zero edge splits on the wall
  const edgeSplits = regionEditOps.filter((op) => op.kind === "split-edge");
  assert.equal(edgeSplits.length, 0, "must not split wall edges when painting terrain");
});

test("terrainSculptTool: dig mode reports info and does nothing when only non-terrain structures are covered", () => {
  const feedbacks = [];
  const mockContext = {
    tableId: "table-1",
    nextSequence: () => 1,
    reportFeedback: (fb) => feedbacks.push(fb),
    history: { record() {} },
    runtime: {
      transact: (_id, _origin, work) => ({ value: work(), recorded: true }),
      getFootprintCoverage: () => [
        {
          surfaceKey: ["platform", "p1"],
          surfaceType: "platform",
          coverage: "centroid",
          nodeIds: ["p0", "p1", "p2", "p3"],
        },
      ],
      getSnapshot: () => ({ tableId: "table-1", map: { nodePositions: new Map() } }),
    },
  };

  const gesture = {
    samples: [
      { point: { x: 2, y: 0, z: 2 } },
      { point: { x: 3, y: 0, z: 2 } },
    ],
  };

  terrainSculptTool.onPointerUp(mockContext, gesture, {
    ...DEFAULT_TOOL_PARAMS["terrain-sculpt"],
    mode: "dig",
  });

  assert.equal(feedbacks.length, 1);
  assert.equal(feedbacks[0].tone, "info");
  assert.equal(feedbacks[0].message, "Nada a cavar aqui.");
});
