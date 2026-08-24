import assert from "node:assert/strict";
import test from "node:test";

import { planSpineContour } from "../src/composition/tabletop/tools/paths/spine-contour/index.ts";

const at = (x, z, y = 0) => ({ x, y, z });

test("a straight isolated run produces one region per band, each a clean quad", () => {
  const chain = {
    chainId: "run-1",
    controlPoints: [at(0, 0), at(10, 0)],
    bandOffsets: [-2.1, 0, 2.1],
    miterLimit: 4,
    tolerance: 0.05,
  };
  const result = planSpineContour({
    tableId: "table",
    operationId: "op-1",
    surfaceType: "path",
    chains: [chain],
    changedChainIds: ["run-1"],
    existingNodes: [],
  });

  assert.ok(result !== undefined);
  assert.deepEqual(result.touchedChainIds, ["run-1"]);
  // Two bands (-2.1..0 and 0..2.1), no overlap between them, so no union
  // merges anything -- one region per band.
  assert.equal(result.patch.regions.length, 2);
  for (const region of result.patch.regions) {
    assert.equal(region.boundary.length, 4, "a straight run's band is a clean quad");
    assert.equal(region.holes, undefined, "no hole in an isolated band");
  }
});

test("two roads meeting in a T union into one region, with no rim left in the middle", () => {
  const main = {
    chainId: "main",
    controlPoints: [at(-5, 0), at(5, 0)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };
  // Stops just inside the main road's band (z: 1 -> -4), the way a T's
  // arriving road does -- its own ribbon overlaps main's band rather than
  // merely touching it.
  const branch = {
    chainId: "branch",
    controlPoints: [at(0, 1), at(0, -4)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };

  const result = planSpineContour({
    tableId: "table",
    operationId: "op-t",
    surfaceType: "path",
    chains: [main, branch],
    changedChainIds: ["branch"],
    existingNodes: [],
  });

  assert.ok(result !== undefined);
  assert.deepEqual(new Set(result.touchedChainIds), new Set(["main", "branch"]));
  // Both chains share one band index (0) and their ribbons overlap, so the
  // union merges them into a single face -- no leftover rim splitting the
  // junction into two regions the way the old mouth/wedge machinery had to
  // special-case.
  assert.equal(result.patch.regions.length, 1, "a T merges into one face, not two");
});

test("two roads crossing in an X union into one region", () => {
  const horizontal = {
    chainId: "horizontal",
    controlPoints: [at(-5, 0), at(5, 0)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };
  const vertical = {
    chainId: "vertical",
    controlPoints: [at(0, -5), at(0, 5)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };

  const result = planSpineContour({
    tableId: "table",
    operationId: "op-x",
    surfaceType: "path",
    chains: [horizontal, vertical],
    changedChainIds: ["vertical"],
    existingNodes: [],
  });

  assert.ok(result !== undefined);
  assert.equal(result.patch.regions.length, 1, "an X merges into one face, not two overlapping ones");
});

test("a spine edit only reprocesses chains within reach of the change", () => {
  const edited = {
    chainId: "edited",
    controlPoints: [at(0, 0), at(10, 0)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };
  const nearby = {
    chainId: "nearby",
    controlPoints: [at(11, 0), at(20, 0)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };
  const faraway = {
    chainId: "faraway",
    controlPoints: [at(1000, 0), at(1010, 0)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };

  const result = planSpineContour({
    tableId: "table",
    operationId: "op-dirty",
    surfaceType: "path",
    chains: [edited, nearby, faraway],
    changedChainIds: ["edited"],
    existingNodes: [],
  });

  assert.ok(result !== undefined);
  assert.ok(result.touchedChainIds.includes("edited"));
  assert.ok(result.touchedChainIds.includes("nearby"), "a chain just within reach is still reprocessed");
  assert.ok(!result.touchedChainIds.includes("faraway"), "a chain far outside reach is left alone");
});

test("re-planning an untouched chain welds back onto the same node ids -- zero churn", () => {
  const chain = {
    chainId: "run-1",
    controlPoints: [at(0, 0), at(10, 0)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };
  const first = planSpineContour({
    tableId: "table",
    operationId: "op-1",
    surfaceType: "path",
    chains: [chain],
    changedChainIds: ["run-1"],
    existingNodes: [],
  });
  assert.ok(first !== undefined);

  // The same chain, re-planned as if a wholly unrelated edit elsewhere in
  // the cloud pulled it back into a (differently scoped) dirty region --
  // handed the first run's own nodes as the live table it must weld onto.
  const second = planSpineContour({
    tableId: "table",
    operationId: "op-2",
    surfaceType: "path",
    chains: [chain],
    changedChainIds: ["run-1"],
    existingNodes: first.patch.nodes,
  });
  assert.ok(second !== undefined);

  const firstIds = new Set(first.patch.nodes.map((node) => node.id));
  const secondIds = new Set(second.patch.nodes.map((node) => node.id));
  assert.deepEqual(secondIds, firstIds, "identical geometry welds onto the exact same node ids");
});
