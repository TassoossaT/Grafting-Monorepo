import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateProfileHeight,
  distanceSqToSegment2D,
  distanceAndElevationOnPath,
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

test("distanceAndElevationOnPath: calculates 2D distance and interpolates elevation along polyline", () => {
  const path = [
    { x: 0, y: 10, z: 0 },
    { x: 10, y: 20, z: 0 },
  ];

  // Exactly on segment midway:
  const mid = distanceAndElevationOnPath(5, 0, path);
  assert.equal(mid.distance, 0);
  assert.equal(mid.pathY, 15);

  // Perpendicular to segment at (5, 3):
  const perp = distanceAndElevationOnPath(5, 3, path);
  assert.equal(perp.distance, 3);
  assert.equal(perp.pathY, 15);

  // Past the end:
  const pastEnd = distanceAndElevationOnPath(14, 0, path);
  assert.equal(pastEnd.distance, 4);
  assert.equal(pastEnd.pathY, 20);
});

test("calculateProfileHeight: polyline stroke path creates a continuous mountain ridge with zero seam", () => {
  const ridgePath = [
    { x: 0, z: 5 },
    { x: 10, z: 5 },
    { x: 20, z: 5 },
  ];
  const radius = 4;
  const baseHeight = 2;
  const mountainHeight = 6;

  // Along the entire spine of the ridge, height is baseHeight + mountainHeight = 8
  for (const spineX of [0, 5, 10, 15, 20]) {
    const h = calculateProfileHeight(
      { x: spineX, z: 5 },
      baseHeight,
      { kind: "convex", height: mountainHeight },
      ridgePath,
      radius,
    );
    assert.ok(Math.abs(h - 8) < 1e-6, `spine at x=${spineX} expected 8, got ${h}`);
  }

  // At distance = radius (z = 5 + 4 = 9): zero seam, height is exactly baseHeight = 2
  const rimHeight = calculateProfileHeight(
    { x: 10, z: 9 },
    baseHeight,
    { kind: "convex", height: mountainHeight },
    ridgePath,
    radius,
  );
  assert.ok(Math.abs(rimHeight - 2) < 1e-6, `rim expected 2, got ${rimHeight}`);

  // Beyond distance = radius: height is baseHeight = 2
  const outsideHeight = calculateProfileHeight(
    { x: 10, z: 12 },
    baseHeight,
    { kind: "convex", height: mountainHeight },
    ridgePath,
    radius,
  );
  assert.equal(outsideHeight, 2);
});

test("calculateProfileHeight: successive strokes cumulatively elevate to form higher peaks", () => {
  const center = { x: 5, z: 5 };
  const radius = 5;

  // Initial flat terrain height = 1.0
  let height = 1.0;

  // Stroke 1: Add elevation 2.5
  height = calculateProfileHeight({ x: 5, z: 5 }, height, { kind: "convex", height: 2.5 }, center, radius);
  assert.ok(Math.abs(height - 3.5) < 1e-6, `expected 3.5, got ${height}`);

  // Stroke 2: Add elevation 2.5 again over the existing peak
  height = calculateProfileHeight({ x: 5, z: 5 }, height, { kind: "convex", height: 2.5 }, center, radius);
  assert.ok(Math.abs(height - 6.0) < 1e-6, `expected 6.0, got ${height}`);

  // Stroke 3: Add elevation 4.0
  height = calculateProfileHeight({ x: 5, z: 5 }, height, { kind: "convex", height: 4.0 }, center, radius);
  assert.ok(Math.abs(height - 10.0) < 1e-6, `expected 10.0, got ${height}`);

  // Now dig 3.0 out of the peak
  height = calculateProfileHeight({ x: 5, z: 5 }, height, { kind: "concave", depth: 3.0 }, center, radius);
  assert.ok(Math.abs(height - 7.0) < 1e-6, `expected 7.0, got ${height}`);
});

test("executeTerrainCut: matches terrain variants (e.g. terrain-grass) and preserves surfaceType in patch", () => {
  const at = {
    n0: { x: 0, y: 2, z: 0 },
    n1: { x: 4, y: 2, z: 0 },
    n2: { x: 4, y: 2, z: 4 },
    n3: { x: 0, y: 2, z: 4 },
  };

  const grassFace = {
    surfaceKey: ["terrain-grass", "f1"],
    surfaceType: "terrain-grass",
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
    getFootprintCoverage: () => [{ surfaceKey: ["terrain-grass", "f1"], surfaceType: "terrain-grass" }],
    getAllRegionTopologies: () => [grassFace],
    getRegionTopologiesInBounds: () => [grassFace],
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

  // Calling with generic targetSurfaceType: "terrain", standing face is "terrain-grass"
  const outcome = executeTerrainCut(mockRuntime, {
    area: {
      outline: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      center: { x: 2, y: 2, z: 2 },
      radius: 3,
    },
    coveredRegions: [{ surfaceKey: ["terrain-grass", "f1"], surfaceType: "terrain-grass" }],
    targetSurfaceType: "terrain",
    profile: { kind: "convex", height: 3 },
    causeId: "cause-grass-elevate",
    tableId: "t",
  });

  assert.equal(outcome.success, true);
  assert.equal(outcome.removedFaces, 1);
  assert.ok(replacementRequest !== null);
  assert.deepEqual(replacementRequest.sourceSurfaceKeys, [["terrain-grass", "f1"]]);
  assert.equal(replacementRequest.patch.regions[0].surfaceType, "terrain-grass");
});

