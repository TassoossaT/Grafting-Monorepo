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

test("standingRegionsForCloud does not traverse into or consume a foreign path corridor sharing weld nodes", () => {
  const road1 = {
    surfaceKey: ["@region", "corridor-1:band-0:0"],
    surfaceType: "path",
    physical: true,
    outerLoops: [],
    holes: [],
    nodes: [
      { id: "contour:corridor-1:0", position: { x: 0, y: 0, z: 0 } },
      { id: "contour:corridor-1:1", position: { x: 10, y: 0, z: 0 } },
      { id: "shared-weld-node", position: { x: 10, y: 0, z: 2 } },
      { id: "contour:corridor-1:2", position: { x: 0, y: 0, z: 2 } },
    ],
  };

  const road2 = {
    surfaceKey: ["@region", "corridor-2:band-0:0"],
    surfaceType: "path",
    physical: true,
    outerLoops: [],
    holes: [],
    nodes: [
      { id: "shared-weld-node", position: { x: 10, y: 0, z: 2 } },
      { id: "contour:corridor-2:0", position: { x: 20, y: 0, z: 2 } },
      { id: "contour:corridor-2:1", position: { x: 20, y: 0, z: 4 } },
      { id: "contour:corridor-2:2", position: { x: 10, y: 0, z: 4 } },
    ],
  };

  const standing = standingRegionsForCloud([road1, road2], [], new Set(["corridor-2"]));
  assert.equal(standing.length, 1, "only road2's face is returned");
  assert.equal(standing[0]?.surfaceKey[1], "corridor-2:band-0:0");
});
