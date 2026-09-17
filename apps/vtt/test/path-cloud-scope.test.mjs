import assert from "node:assert/strict";
import test from "node:test";

import { bezierContourId, standingRegionsForCloud } from "../src/features/edit-construction/structure-types/path/path-cloud-scope.ts";

function face(regionId, surfaceType = "path") {
  return {
    surfaceKey: ["@region", regionId],
    surfaceType,
    physical: true,
    outerLoops: [],
    holes: [],
    nodes: [{ id: `${regionId}:n0`, position: { x: 0, y: 0, z: 0 } }],
  };
}

test("standingRegionsForCloud returns nothing when no corridor is touched", () => {
  assert.deepEqual(standingRegionsForCloud([face(bezierContourId(new Set(["corridor-1"]), "op"))], new Set()), []);
});

test("a cloud owns exactly the path faces whose contour names one of its corridors", () => {
  const own = face(bezierContourId(new Set(["corridor-1"]), "op-1"));
  const joined = face(bezierContourId(new Set(["corridor-1", "corridor-3"]), "op-2"));
  const foreign = face(bezierContourId(new Set(["corridor-2"]), "op-3"));
  const unowned = face("corridor-1:band-0:0");
  const ground = face(bezierContourId(new Set(["corridor-1"]), "op-4"), "terrain");

  const standing = standingRegionsForCloud([own, joined, foreign, unowned, ground], new Set(["corridor-1"]));

  assert.deepEqual(standing.map((topology) => topology.surfaceKey), [own.surfaceKey, joined.surfaceKey],
    "ownership comes from the spine's corridors, never from ids that merely look alike, welded nodes or other types");
});
