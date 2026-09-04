import assert from "node:assert/strict";
import test from "node:test";

import { fillTerrain } from "../src/composition/tabletop/tools/terrain/terrain-fill.ts";

/**
 * A runtime that records the patch instead of applying it, with a generator
 * whose grid is written by the test.
 */
function runtimeWith(grid, nodePositions = []) {
  const patches = [];
  return {
    patches,
    generateIrregularQuadGrid: () => grid,
    applyRegionEdit: () => ({}),
    addPatch(patch) {
      patches.push(patch);
      return { createdSurfaceKeys: patch.regions.map((r) => [r.regionId]), skippedRegionIds: [], skippedRegionReasons: [] };
    },
    getSnapshot: () => ({ map: { nodePositions: new Map(nodePositions) } }),
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
