import assert from "node:assert/strict";
import test from "node:test";

import { bezierContourId, regeneratedCorridorIds, retireableRegions, standingRegionsForCloud } from "../src/features/edit-construction/structure-types/path/path-cloud-scope.ts";

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

/** A committed contour face, named the way `bezierContourId` names one. */
function ownedFace(owners, operationId) {
  return {
    surfaceKey: ["@region", `${bezierContourId(new Set(owners), operationId)}:band-0:0`],
    surfaceType: "path",
    physical: true,
    outerLoops: [],
    holes: [],
    nodes: [],
  };
}

test("regeneratedCorridorIds reads a corridor out of its chain's edge id, base alias included", () => {
  const corridors = regeneratedCorridorIds([
    "spine-edge:op-a#road:0",
    "spine-split:spine-edge:op-b:3:1",
  ]);
  assert.ok(corridors.has("op-a#road"));
  assert.ok(corridors.has("op-a"), "the #-suffixed corridor also answers to its base");
  assert.ok(corridors.has("op-b"));
});

test("a face is retired only when every corridor that owns it is being redrawn", () => {
  const face = ownedFace(["op-a", "op-b"], "commit-1");
  assert.deepEqual(
    retireableRegions([face], regeneratedCorridorIds(["spine-edge:op-a:0", "spine-edge:op-b:0"])),
    [face],
    "the ordinary case: the whole cloud is redrawn, so the whole cloud is retired",
  );
});

test("a face whose co-owner lost its chain is left standing instead of deleted", () => {
  // The recurring disappearance, reduced: the face belongs to two corridors,
  // the regeneration only reaches one of them, and retiring it anyway would
  // take op-b's half of the road with it and put nothing back.
  const face = ownedFace(["op-a", "op-b"], "commit-1");
  assert.deepEqual(
    retireableRegions([face], regeneratedCorridorIds(["spine-edge:op-a:0"])),
    [],
    "half a regeneration must not retire a whole face",
  );
});

test("a face that declares no owners is left to the caller's own selection", () => {
  // Legacy `<opId>:band-N:i` faces carry no owner list, so there is nothing
  // to check them against and the gate must not silently drop them.
  const legacy = {
    surfaceKey: ["@region", "corridor-1:band-0:0"],
    surfaceType: "path",
    physical: true,
    outerLoops: [],
    holes: [],
    nodes: [],
  };
  assert.deepEqual(retireableRegions([legacy], new Set()), [legacy]);
});

test("a cloud carrying a junction anchor is still retired, so the road is not doubled", () => {
  // The real id shapes, not tidied ones. `pathCorridorId` appends the subtype
  // (`<op>#road`), and `curveNetwork` mints a junction anchor beneath that
  // again (`spine:<op>#road#junction:<n>`), which `parseSpineControlNodeId`
  // reads back as a corridor named `<op>#road#junction`. That name lands in
  // the face's owner list while no chain id can ever produce it.
  //
  // Comparing the two sets literally retired nothing here, so every stroke
  // over a junction left the standing road under the new one.
  const face = ownedFace(
    ["run-a#road", "run-a#road#junction", "run-a"],
    "commit-1",
  );
  const regenerated = regeneratedCorridorIds(["spine-edge:run-a#road:0", "spine-edge:run-a#road:1"]);
  assert.deepEqual(retireableRegions([face], regenerated), [face]);
});

test("a genuinely foreign corridor is still not retired", () => {
  // The suffix walk must not become a way to satisfy any owner at all: a
  // corridor nobody is redrawing shares no prefix with one that is.
  const face = ownedFace(["run-a#road", "run-b#road"], "commit-1");
  const regenerated = regeneratedCorridorIds(["spine-edge:run-a#road:0"]);
  assert.deepEqual(retireableRegions([face], regenerated), []);
});
