import assert from "node:assert/strict";
import test from "node:test";

import { pathPatch } from "../src/composition/tabletop/tools/paths/path-patch.ts";

test("path subtype declares its own shared quad patch from a graph-neutral sweep", () => {
  const vertices = [];
  for (const x of [0, 1, 2]) {
    for (const [z, y] of [[-1, 0.2], [-0.5, 0], [0.5, 0], [1, 0.2]]) {
      vertices.push({ x, y, z });
    }
  }
  const formation = pathPatch("table-1", "path-1", "path", {
    referenceLine: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    vertices,
    quads: [
      [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3],
      [4, 8, 9, 5], [5, 9, 10, 6], [6, 10, 11, 7],
    ],
    boundary: [0, 4, 8, 9, 10, 11, 7, 3, 2, 1],
  });

  assert.equal(formation.patch.nodes.length, 12);
  assert.equal(formation.patch.edges.length, 17);
  assert.equal(formation.patch.regions.length, 6);
  assert.equal(formation.boundary.length, 10);
  assert.deepEqual(formation.outline[0], [0, -1]);

  const uses = new Map();
  for (const region of formation.patch.regions) {
    for (const use of region.boundary) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
  }
  assert.equal([...uses.values()].filter((count) => count === 1).length, 10);
  assert.equal([...uses.values()].filter((count) => count === 2).length, 7);
});
