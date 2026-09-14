import assert from "node:assert/strict";
import test from "node:test";

import { isTerrainSurface } from "../src/features/edit-construction/structure-types/organic/terrain-cloud.ts";
import { executeTerrainCut } from "../src/composition/tabletop/terrain/terrain-cut-executor.ts";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { DEFAULT_TOOL_PARAMS } from "../src/features/edit-construction/tools/tool-types.ts";

test("isTerrainSurface: accepts only terrain/ground variants and rejects structural types", () => {
  assert.equal(isTerrainSurface("terrain"), true);
  assert.equal(isTerrainSurface("terrain-grass"), true);
  assert.equal(isTerrainSurface("terrain-snow"), true);
  assert.equal(isTerrainSurface("ground"), true);

  assert.equal(isTerrainSurface("wall-white"), false);
  assert.equal(isTerrainSurface("wall-gray"), false);
  assert.equal(isTerrainSurface("platform"), false);
  assert.equal(isTerrainSurface("roof"), false);
  assert.equal(isTerrainSurface("path"), false);
  assert.equal(isTerrainSurface("door"), false);
  assert.equal(isTerrainSurface("window"), false);
  assert.equal(isTerrainSurface("floor"), false);
  assert.equal(isTerrainSurface("ceiling"), false);
});

test("executeTerrainCut: ignores non-terrain topologies in bounds and never treats them as retained terrain or affected", () => {
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
    outerLoops: [],
    holes: [],
  };

  const appliedPatches = [];
  const appliedReplacements = [];
  const deletedOps = [];

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
      deletedOps.push(...ops);
    },
  };

  // 1. Calling with targetSurfaceType as a non-terrain type (e.g. wall-white) falls back to "terrain"
  // and does NOT delete or replace the wall.
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
  // Wall should NOT be in removed / replaced
  assert.equal(outcome.removedFaces, 0, "non-terrain faces must not be counted as affected or removed");
  assert.equal(appliedReplacements.length, 0, "must not call applyPatchReplacement on non-terrain faces");
  assert.equal(appliedPatches.length, 1, "adds fresh terrain patch");
  // The generated patch MUST have surfaceType: "terrain", NOT "wall-white"
  assert.equal(appliedPatches[0].regions[0].surfaceType, "terrain", "generated terrain must have terrain surfaceType");
});

test("executeTerrainCut: hole profile never deletes non-terrain faces", () => {
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
    outerLoops: [],
    holes: [],
  };

  const deleted = [];
  const mockRuntime = {
    getFootprintCoverage: () => [{ surfaceKey: ["wall", "w1"], surfaceType: "wall-white" }],
    getAllRegionTopologies: () => [wallTopology],
    getRegionTopologiesInBounds: () => [wallTopology],
    getSnapshot: () => ({ tableId: "t", map: { nodePositions: new Map() } }),
    applyRegionEdit: (ops) => {
      for (const op of ops) {
        if (op.kind === "delete-region") deleted.push(op.surfaceKey.join(" "));
      }
    },
  };

  const outcome = executeTerrainCut(mockRuntime, {
    area: {
      outline: [
        [-1, -1],
        [5, -1],
        [5, 5],
        [-1, 5],
      ],
      radius: 4,
    },
    targetSurfaceType: "terrain",
    profile: { kind: "hole" },
    causeId: "test-cause",
    tableId: "t",
  });

  assert.equal(outcome.success, false, "hole profile on non-terrain surfaces must fail gracefully");
  assert.equal(deleted.length, 0, "no non-terrain regions should be deleted");
});

test("terrainSculptTool: add mode refuses to paint over non-terrain structures (coverage = centroid)", () => {
  const feedbacks = [];
  const mockContext = {
    tableId: "table-1",
    nextSequence: () => 1,
    reportFeedback: (fb) => feedbacks.push(fb),
    runtime: {
      getFootprintCoverage: () => [
        {
          surfaceKey: ["wall", "w1"],
          surfaceType: "wall-white",
          coverage: "centroid",
          nodeIds: ["w0", "w1", "w2", "w3"],
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
    mode: "add",
  });

  assert.equal(feedbacks.length, 1);
  assert.equal(feedbacks[0].tone, "info");
  assert.match(feedbacks[0].message, /terrain cannot be created above "wall-white"/);
});

test("terrainSculptTool: dig mode reports info and does nothing when only non-terrain structures are covered", () => {
  const feedbacks = [];
  const mockContext = {
    tableId: "table-1",
    nextSequence: () => 1,
    reportFeedback: (fb) => feedbacks.push(fb),
    runtime: {
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
