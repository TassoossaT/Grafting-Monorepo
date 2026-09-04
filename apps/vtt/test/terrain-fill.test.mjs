import assert from "node:assert/strict";
import test from "node:test";

import { fillTerrain } from "../src/composition/tabletop/tools/terrain/terrain-fill.ts";

/**
 * A runtime that records the patch instead of applying it, with a generator
 * whose grid is written by the test.
 */
function runtimeWith(grid, nodePositions = [], regionTopologies = []) {
  const patches = [];
  const replacements = [];
  const edits = [];
  return {
    patches,
    replacements,
    edits,
    generateIrregularQuadGrid: () => grid,
    applyRegionEdit(ops) {
      edits.push(...ops);
      return {};
    },
    addPatch(patch) {
      patches.push(patch);
      return { createdSurfaceKeys: patch.regions.map((r) => [r.regionId]), skippedRegionIds: [], skippedRegionReasons: [] };
    },
    applyPatchReplacement(request) {
      replacements.push(request);
      patches.push(request.patch);
      return {
        createdSurfaceKeys: request.patch.regions.map((r) => [r.regionId]),
        removedSurfaceKeys: request.sourceSurfaceKeys,
        affectedSurfaceKeys: [],
        createdNodeIds: [],
        removedNodeIds: [],
        skippedRegionIds: [],
        skippedRegionReasons: [],
      };
    },
    getSnapshot: () => ({ map: { nodePositions: new Map(nodePositions) } }),
    getAllRegionTopologies() {
      throw new Error("a local terrain fill must not serialize the whole map");
    },
    getRegionTopologiesInBounds: () => regionTopologies,
  };
}

test("two corners never resolve to one node, so two faces cannot claim one edge", () => {
  // The shape of the bug this guards. `old` is a ring corner, so the corner
  // carrying it as a `source` already exists; a second corner lands close
  // enough to snap onto the same node. Left alone, the two collapse and the
  // mesh's two distinct edges become one walked twice the same way.
  const grid = {
    vertices: [
      { x: 0, z: 0, source: 0 },   // carries the ring corner itself
      { x: 0.1, z: 0 },            // near enough to snap onto it
      { x: 4, z: 0 },
      { x: 4, z: 4 },
      { x: 0, z: 4 },
      { x: 8, z: 0 },
      { x: 8, z: 4 },
    ],
    // Two faces meeting only at corner 2. Their edges are distinct -- unless
    // corners 0 and 1 collapse onto one node, and then both walk it to 2.
    quads: [[0, 2, 3, 4], [1, 5, 6, 2]],
    onContour: [
      // Reported as landing on the ring's only segment, a hair from its start.
      { vertex: 1, ringKind: "boundary", ring: 0, segment: 0 },
    ],
    refinementComplete: true,
  };
  const ring = {
    points: [
      { x: 0, z: 0, source: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 4 },
      { x: 0, z: 4 },
    ],
    edges: [undefined, undefined, undefined, undefined],
  };

  const runtime = runtimeWith(grid, [["old", { position: { x: 0, y: 0, z: 0 } }]]);
  fillTerrain(runtime, {
    what: "teste",
    mint: "m",
    tableId: "t",
    causeId: "c",
    seed: 1,
    faceSide: 2,
    surfaceType: "terrain",
    boundary: [ring],
    holes: [],
    sources: ["old"],
    heightAt: () => 0,
  });

  const patch = runtime.patches[0];
  assert.ok(patch !== undefined, "a patch was built");

  // No directed edge is walked twice the same way -- that is exactly what the
  // engine reports as "no room on edge, its one free side faces the other way".
  const walked = new Set();
  for (const region of patch.regions) {
    for (const use of region.boundary) {
      const key = `${use.edgeId}:${use.reversed}`;
      assert.ok(!walked.has(key), `edge ${use.edgeId} walked the same way twice`);
      walked.add(key);
    }
  }

  // And the corner that lost the claim still exists, as its own new node,
  // rather than vanishing and costing the face.
  const declared = new Set(patch.nodes.map((node) => node.id));
  assert.ok(declared.has("m:v1"), "the losing corner is declared as new geometry");

  // The point of it: the two corners are two nodes, not one.
  const corners = patch.regions.map((region) => region.boundary[0].edgeId);
  assert.notEqual(corners[0], corners[1], "the two faces leave their shared corner by different edges");
});

test("a generated sheet walks a retained contour on its already-free side", () => {
  const grid = {
    vertices: [
      { x: 0, z: 0, source: 0 },
      { x: 2, z: 0 },
      { x: 4, z: 0, source: 1 },
      { x: 0, z: -2 },
      { x: 2, z: -2 },
      { x: 4, z: -2 },
    ],
    quads: [[3, 4, 1, 0], [4, 5, 2, 1]],
    onContour: [{ vertex: 1, ringKind: "hole", ring: 0, segment: 0 }],
    refinementComplete: true,
  };
  const boundary = {
    points: [{ x: -1, z: -3 }, { x: 5, z: -3 }, { x: 5, z: 1 }, { x: -1, z: 1 }],
    edges: [],
  };
  const retained = {
    // The old face uses n0 -> n1. Its free side is n1 -> n0.
    points: [
      { x: 4, z: 0, source: 1 },
      { x: 0, z: 0, source: 0 },
      { x: 0, z: 4, source: 3 },
      { x: 4, z: 4, source: 2 },
    ],
    edges: [
      { edgeId: "t:seg:n0~n9", reversed: true, startNodeId: "n9", endNodeId: "n0", geometry: { kind: "line" } },
      undefined,
      undefined,
      undefined,
    ],
  };
  const positions = ["n0", "n9", "n2", "n3"].map((id, index) => [id, {
    position: { x: index === 1 || index === 2 ? 4 : 0, y: 0, z: index >= 2 ? 4 : 0 },
  }]);
  const runtime = runtimeWith(grid, positions, [{
    surfaceKey: ["retained"],
    outerLoops: [[
      { edgeId: "t:seg:n9~z:v1", reversed: true, startNodeId: "n9", endNodeId: "z:v1", geometry: { kind: "line" } },
      { edgeId: "t:seg:n0~z:v1", reversed: true, startNodeId: "z:v1", endNodeId: "n0", geometry: { kind: "line" } },
    ]],
    holes: [],
  }]);

  fillTerrain(runtime, {
    what: "teste",
    mint: "z",
    tableId: "t",
    causeId: "c",
    seed: 1,
    faceSide: 2,
    surfaceType: "terrain",
    boundary: [boundary],
    holes: [retained],
    sources: ["n0", "n9", "n2", "n3"],
    replaceSurfaceKeys: [["old"]],
    heightAt: () => 0,
  });

  assert.equal(runtime.replacements.length, 1, "terrain replacement is one atomic transaction");
  const split = runtime.replacements[0].patch.regions
    .flatMap((region) => region.boundary)
    .find((use) => use.edgeId === "t:seg:n9~z:v1");
  assert.equal(split?.reversed, false, "the fragment takes the side opposite the retained face");
});

test("a contour midpoint falls back to splitting when its nearby endpoint is already claimed", () => {
  const grid = {
    vertices: [
      { x: 0, z: 0, source: 0 },
      { x: 0.3, z: 0 },
      { x: 0.6, z: 0, source: 1 },
      { x: 0, z: -1 },
      { x: 0.3, z: -1 },
      { x: 0.6, z: -1 },
    ],
    quads: [[3, 4, 1, 0], [4, 5, 2, 1]],
    onContour: [{ vertex: 1, ringKind: "hole", ring: 0, segment: 0 }],
    refinementComplete: true,
  };
  const retained = {
    points: [
      { x: 0, z: 0, source: 0 },
      { x: 0.6, z: 0, source: 1 },
      { x: 0.6, z: 1, source: 2 },
      { x: 0, z: 1, source: 3 },
    ],
    edges: [
      { edgeId: "t:seg:n0~n1", reversed: false, startNodeId: "n0", endNodeId: "n1", geometry: { kind: "line" } },
      undefined,
      undefined,
      undefined,
    ],
  };
  const runtime = runtimeWith(grid, [
    ["n0", { position: { x: 0, y: 0, z: 0 } }],
    ["n1", { position: { x: 0.6, y: 0, z: 0 } }],
  ]);

  fillTerrain(runtime, {
    what: "teste",
    mint: "m",
    tableId: "t",
    causeId: "c",
    seed: 1,
    faceSide: 2,
    surfaceType: "terrain",
    boundary: [{ points: [{ x: -1, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -1, z: 2 }], edges: [] }],
    holes: [retained],
    sources: ["n0", "n1", "n2", "n3"],
    heightAt: () => 0,
  });

  assert.equal(runtime.edits.length, 1, "the rejected snap still splits the retained contour");
  assert.equal(runtime.edits[0].kind, "insert-vertex");
  assert.equal(runtime.edits[0].edgeId, "t:seg:n0~n1");
  assert.equal(runtime.edits[0].nodeId, "m:v1");
});
