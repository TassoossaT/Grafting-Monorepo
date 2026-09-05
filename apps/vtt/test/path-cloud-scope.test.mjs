import assert from "node:assert/strict";
import test from "node:test";

import { standingRegionsForCloud } from "../src/features/edit-construction/structure-types/path/path-cloud-scope.ts";

test("standingRegionsForCloud returns empty when corridorIds and cloudPositions are empty", () => {
  const result = standingRegionsForCloud([], []);
  assert.deepEqual(result, []);
});

test("standingRegionsForCloud walks connected path faces via shared nodes", () => {
  // Region A: seed corridor "corridor-1" with nodes n1, n2, n3, n4
  const regionA = {
    surfaceKey: ["@region", "corridor-1:band-0:0"],
    surfaceType: "path",
    physical: true,
    outerLoops: [],
    holes: [],
    nodes: [
      { id: "n1", position: { x: 0, y: 0, z: 0 } },
      { id: "n2", position: { x: 1, y: 0, z: 0 } },
      { id: "n3", position: { x: 1, y: 0, z: 1 } },
      { id: "n4", position: { x: 0, y: 0, z: 1 } },
    ],
  };

  // Region B: adjoining face sharing nodes n3, n4, but with a different region id ("adjoining-face")
  const regionB = {
    surfaceKey: ["@region", "adjoining-face"],
    surfaceType: "path",
    physical: true,
    outerLoops: [],
    holes: [],
    nodes: [
      { id: "n3", position: { x: 1, y: 0, z: 1 } },
      { id: "n4", position: { x: 0, y: 0, z: 1 } },
      { id: "n5", position: { x: 0, y: 0, z: 2 } },
      { id: "n6", position: { x: 1, y: 0, z: 2 } },
    ],
  };

  // Region C: disconnected path face far away
  const regionC = {
    surfaceKey: ["@region", "disconnected-path"],
    surfaceType: "path",
    physical: true,
    outerLoops: [],
    holes: [],
    nodes: [
      { id: "n100", position: { x: 50, y: 0, z: 50 } },
      { id: "n101", position: { x: 51, y: 0, z: 50 } },
    ],
  };

  // Region D: non-path face sharing nodes with region A
  const regionD = {
    surfaceKey: ["@region", "terrain-face"],
    surfaceType: "terrain",
    physical: true,
    outerLoops: [],
    holes: [],
    nodes: [
      { id: "n1", position: { x: 0, y: 0, z: 0 } },
      { id: "n2", position: { x: 1, y: 0, z: 0 } },
    ],
  };

  const topologies = [regionA, regionB, regionC, regionD];
  const cloud = standingRegionsForCloud(topologies, [], new Set(["corridor-1"]));

  assert.equal(cloud.length, 2);
  const keys = new Set(cloud.map((r) => r.surfaceKey[1]));
  assert.ok(keys.has("corridor-1:band-0:0"), "includes seed face");
  assert.ok(keys.has("adjoining-face"), "includes topologically connected face via shared nodes n3, n4");
  assert.ok(!keys.has("disconnected-path"), "excludes disconnected path face");
  assert.ok(!keys.has("terrain-face"), "excludes non-path face");
});
