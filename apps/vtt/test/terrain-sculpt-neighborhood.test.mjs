import assert from "node:assert/strict";
import test from "node:test";

import { terrainStandingAround } from "../src/composition/tabletop/tools/terrain/terrain-neighborhood.ts";

function topology(id) {
  return { surfaceKey: [id], surfaceType: "ground", nodes: [], outerLoops: [], holes: [] };
}

test("terrain neighbourhood keeps only clouds actually touched by the stroke", () => {
  const queries = [];
  const near = [topology("touched-a"), topology("touched-b")];
  const runtime = {
    getRegionTopologiesInBounds(query) {
      queries.push(query);
      return near;
    },
  };
  const covered = [
    { surfaceKey: ["touched-a"], surfaceType: "ground" },
    { surfaceKey: ["touched-b"], surfaceType: "ground" },
  ];

  const result = terrainStandingAround(runtime, covered, { minX: 0, minZ: 0, maxX: 10, maxZ: 10 }, 2);

  assert.deepEqual(result.map((entry) => entry.surfaceKey), [["touched-a"], ["touched-b"]]);
  assert.equal(queries.length, 1, "cloud resolution and local topology use one Wasm crossing");
  assert.deepEqual(queries[0].seeds, [
    { seed: ["touched-a"], surfaceType: "ground" },
    { seed: ["touched-b"], surfaceType: "ground" },
  ]);
});
