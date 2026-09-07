import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateProfileHeight,
} from "../src/features/edit-construction/structure-types/structural-cut.ts";
import {
  executeTerrainCut,
} from "../src/composition/tabletop/tools/terrain/terrain-cut-executor.ts";

test("calculateProfileHeight: concave profile reduces height smoothly to depth at center", () => {
  const center = { x: 10, z: 10 };
  const radius = 5;
  const baseHeight = 10;

  // At center: height should be baseHeight - depth
  const centerHeight = calculateProfileHeight(
    { x: 10, z: 10 },
    baseHeight,
    { kind: "concave", depth: 3 },
    center,
    radius,
  );
  assert.ok(Math.abs(centerHeight - 7) < 1e-6, `expected 7, got ${centerHeight}`);

  // At perimeter: height should be exactly baseHeight (zero seam)
  const rimHeight = calculateProfileHeight(
    { x: 15, z: 10 },
    baseHeight,
    { kind: "concave", depth: 3 },
    center,
    radius,
  );
  assert.ok(Math.abs(rimHeight - 10) < 1e-6, `expected 10, got ${rimHeight}`);

  // Beyond perimeter: height should be baseHeight
  const outsideHeight = calculateProfileHeight(
    { x: 20, z: 10 },
    baseHeight,
    { kind: "concave", depth: 3 },
    center,
    radius,
  );
  assert.equal(outsideHeight, baseHeight);

  // Midway: smooth transition between baseHeight - depth and baseHeight
  const midHeight = calculateProfileHeight(
    { x: 12.5, z: 10 },
    baseHeight,
    { kind: "concave", depth: 3 },
    center,
    radius,
  );
  assert.ok(midHeight > 7 && midHeight < 10, `expected between 7 and 10, got ${midHeight}`);
});

test("calculateProfileHeight: convex profile raises height smoothly to height at center", () => {
  const center = { x: 0, z: 0 };
  const radius = 4;
  const baseHeight = 2;

  // At center: height should be baseHeight + height
  const centerHeight = calculateProfileHeight(
    { x: 0, z: 0 },
    baseHeight,
    { kind: "convex", height: 2.5 },
    center,
    radius,
  );
  assert.ok(Math.abs(centerHeight - 4.5) < 1e-6, `expected 4.5, got ${centerHeight}`);

  // At perimeter: height should be exactly baseHeight
  const rimHeight = calculateProfileHeight(
    { x: 4, z: 0 },
    baseHeight,
    { kind: "convex", height: 2.5 },
    center,
    radius,
  );
  assert.ok(Math.abs(rimHeight - 2) < 1e-6, `expected 2, got ${rimHeight}`);
});

test("calculateProfileHeight: regenerate and hole leave baseHeight unchanged", () => {
  const center = { x: 0, z: 0 };
  const radius = 5;
  const baseHeight = 3.5;

  assert.equal(
    calculateProfileHeight({ x: 0, z: 0 }, baseHeight, { kind: "regenerate" }, center, radius),
    baseHeight,
  );
  assert.equal(
    calculateProfileHeight({ x: 0, z: 0 }, baseHeight, { kind: "hole" }, center, radius),
    baseHeight,
  );
});

test("executeTerrainCut: hole profile deletes affected faces", () => {
  const deleted = [];
  const at = {
    n0: { x: 0, y: 0, z: 0 },
    n1: { x: 4, y: 0, z: 0 },
    n2: { x: 4, y: 0, z: 4 },
    n3: { x: 0, y: 0, z: 4 },
  };

  const face = {
    surfaceKey: ["terrain", "f1"],
    surfaceType: "terrain",
    physical: true,
    outerLoops: [],
    holes: [],
    nodes: Object.entries(at).map(([id, position]) => ({ id, position })),
  };

  const mockRuntime = {
    getFootprintCoverage: () => [{ surfaceKey: ["terrain", "f1"], surfaceType: "terrain" }],
    getAllRegionTopologies: () => [face],
    getRegionTopologiesInBounds: () => [face],
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

  assert.equal(outcome.success, true);
  assert.equal(outcome.removedFaces, 1);
  assert.deepEqual(deleted, ["terrain f1"]);
});

test("executeTerrainCut: concave profile replaces affected faces atomically with depressed grid", () => {
  const at = {
    n0: { x: 0, y: 5, z: 0 },
    n1: { x: 4, y: 5, z: 0 },
    n2: { x: 4, y: 5, z: 4 },
    n3: { x: 0, y: 5, z: 4 },
  };

  const face = {
    surfaceKey: ["terrain", "f1"],
    surfaceType: "terrain",
    physical: true,
    outerLoops: [
      [
        { edgeId: "e:n0~n1", reversed: false, startNodeId: "n0", endNodeId: "n1", geometry: { kind: "line" } },
        { edgeId: "e:n1~n2", reversed: false, startNodeId: "n1", endNodeId: "n2", geometry: { kind: "line" } },
        { edgeId: "e:n2~n3", reversed: false, startNodeId: "n2", endNodeId: "n3", geometry: { kind: "line" } },
        { edgeId: "e:n3~n0", reversed: false, startNodeId: "n3", endNodeId: "n0", geometry: { kind: "line" } },
      ],
    ],
    holes: [],
    nodes: Object.entries(at).map(([id, position]) => ({ id, position })),
  };

  const nodePositions = new Map(Object.entries(at).map(([id, position]) => [id, { position }]));
  let replacementRequest = null;

  const mockRuntime = {
    getFootprintCoverage: () => [{ surfaceKey: ["terrain", "f1"], surfaceType: "terrain" }],
    getAllRegionTopologies: () => [face],
    getRegionTopologiesInBounds: () => [face],
    getSnapshot: () => ({ tableId: "t", map: { nodePositions } }),
    generateIrregularQuadGrid: () => ({
      vertices: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 4 },
        { x: 0, z: 4 },
        { x: 2, z: 2 },
      ],
      quads: [[0, 1, 4, 3]],
      onContour: [],
      refinementComplete: true,
    }),
    applyPatchReplacement: (request) => {
      replacementRequest = request;
      return {
        createdSurfaceKeys: request.patch.regions.map((r) => r.regionId),
        removedSurfaceKeys: request.sourceSurfaceKeys,
        skippedRegionIds: [],
      };
    },
  };

  const outcome = executeTerrainCut(mockRuntime, {
    area: {
      outline: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      center: { x: 2, y: 5, z: 2 },
      radius: 3,
    },
    targetSurfaceType: "terrain",
    profile: { kind: "concave", depth: 2 },
    causeId: "cause-concave",
    tableId: "t",
  });

  assert.equal(outcome.success, true);
  assert.equal(outcome.removedFaces, 1);
  assert.ok(replacementRequest !== null);
  assert.deepEqual(replacementRequest.sourceSurfaceKeys, [["terrain", "f1"]]);
  const centerNode = replacementRequest.patch.nodes.find((n) => Math.abs(n.position.x - 2) < 0.1 && Math.abs(n.position.z - 2) < 0.1);
  assert.ok(centerNode !== undefined, "center node should exist in patch");
  assert.ok(centerNode.position.y < 4.0, `expected depressed height around 3, got ${centerNode.position.y}`);
});
