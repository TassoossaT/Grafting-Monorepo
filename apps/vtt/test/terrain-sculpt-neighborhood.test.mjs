import assert from "node:assert/strict";
import test from "node:test";

import { terrainStandingAround } from "../src/composition/tabletop/tools/terrain/terrain-neighborhood.ts";

function topology(id) {
  return { surfaceKey: [id], surfaceType: "ground", nodes: [], outerLoops: [], holes: [] };
}

test("terrain neighbourhood keeps only clouds actually touched by the stroke", () => {
  const cloudCalls = [];
  const near = [topology("touched-a"), topology("touched-b"), topology("inside-box-but-untouched")];
  const runtime = {
    cloudFor(request) {
      cloudCalls.push(request);
      return { surfaceKeys: [["touched-a"], ["touched-b"]] };
    },
    getRegionTopologiesInBounds() {
      return near;
    },
  };
  const covered = [
    { surfaceKey: ["touched-a"], surfaceType: "ground" },
    { surfaceKey: ["touched-b"], surfaceType: "ground" },
  ];

  const result = terrainStandingAround(runtime, covered, { minX: 0, minZ: 0, maxX: 10, maxZ: 10 }, 2);

  assert.deepEqual(result.map((entry) => entry.surfaceKey), [["touched-a"], ["touched-b"]]);
  assert.equal(cloudCalls.length, 1, "one connected cloud is expanded once, not once per covered face");
});
