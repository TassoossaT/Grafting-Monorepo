import assert from "node:assert/strict";
import test from "node:test";

import {
  cellsInPolygon,
  isRedundantPerimeterWall,
} from "../src/composition/tabletop/tools/house/interior-partition.ts";

const SQUARE = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 4 },
  { x: 0, z: 4 },
];

function contextWith(nodePositions) {
  return {
    runtime: {
      getSnapshot: () => ({ map: { nodePositions: new Map(nodePositions) } }),
    },
  };
}

test("cellsInPolygon rasterizes a 4x4 square at cellSize 2 into exactly 4 cells", () => {
  const { cells, origin } = cellsInPolygon(SQUARE, 2);
  assert.deepEqual(origin, { x: 0, z: 0 });
  const keys = new Set(cells.map((cell) => `${cell.x},${cell.z}`));
  assert.equal(keys.size, 4);
  for (const key of ["0,0", "1,0", "0,1", "1,1"]) assert.ok(keys.has(key), `missing cell ${key}`);
});

test("cellsInPolygon excludes cells outside an irregular (non-rectangular) polygon", () => {
  // An L-shape: the top-right 2x2 quadrant of the square is missing.
  const lShape = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 2 },
    { x: 2, z: 2 },
    { x: 2, z: 4 },
    { x: 0, z: 4 },
  ];
  const { cells } = cellsInPolygon(lShape, 2);
  const keys = new Set(cells.map((cell) => `${cell.x},${cell.z}`));
  assert.ok(!keys.has("1,1"), "the missing quadrant's own cell must not be included");
  assert.equal(keys.size, 3);
});

test("isRedundantPerimeterWall keeps a genuine interior partition that spans wall-to-wall", () => {
  // A wall from (2,0) to (2,4): both ends touch the square's own boundary,
  // but its midpoint (2,2) sits in the open interior -- must be kept.
  const ctx = contextWith([
    ["a-bottom", { position: { x: 2, y: 0, z: 0 } }],
    ["b-bottom", { position: { x: 2, y: 0, z: 4 } }],
    ["b-top", { position: { x: 2, y: 3, z: 4 } }],
    ["a-top", { position: { x: 2, y: 3, z: 0 } }],
  ]);

  const surfaceKey = ["a-bottom", "b-bottom", "b-top", "a-top"];
  assert.equal(isRedundantPerimeterWall(ctx, surfaceKey, SQUARE, 1), false);
});

test("isRedundantPerimeterWall strips a wall that runs along the boundary itself", () => {
  // A short run along the south edge, from (0,0) to (2,0) -- its own
  // midpoint (1,0) sits exactly on the boundary.
  const ctx = contextWith([
    ["a-bottom", { position: { x: 0, y: 0, z: 0 } }],
    ["b-bottom", { position: { x: 2, y: 0, z: 0 } }],
    ["b-top", { position: { x: 2, y: 3, z: 0 } }],
    ["a-top", { position: { x: 0, y: 3, z: 0 } }],
  ]);

  const surfaceKey = ["a-bottom", "b-bottom", "b-top", "a-top"];
  assert.equal(isRedundantPerimeterWall(ctx, surfaceKey, SQUARE, 1), true);
});
