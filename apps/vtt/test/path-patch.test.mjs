import assert from "node:assert/strict";
import test from "node:test";

import { pathPatch } from "../src/composition/tabletop/tools/paths/path-patch.ts";
import { parseStationNodeId } from "../src/features/edit-construction/structure-types/path/station-node-id.ts";

test("path subtype declares its own shared quad patch from a graph-neutral sweep", () => {
  // Three stations of a five-slot road profile: rim, rib, spine, rib, rim.
  const vertices = [];
  for (const x of [0, 1, 2]) {
    for (const [z, y] of [[-1, 0.2], [-0.5, 0], [0, 0], [0.5, 0], [1, 0.2]]) {
      vertices.push({ x, y, z });
    }
  }
  const quads = [];
  for (const station of [0, 1]) {
    for (const slot of [0, 1, 2, 3]) {
      const current = station * 5 + slot;
      const next = (station + 1) * 5 + slot;
      quads.push([current, next, next + 1, current + 1]);
    }
  }

  const formation = pathPatch(
    "table-1",
    "path-1",
    "path",
    {
      referenceLine: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      vertices,
      quads,
      boundary: [0, 5, 10, 11, 12, 13, 14, 9, 4, 3, 2, 1],
    },
    5,
    2,
  );

  assert.equal(formation.patch.nodes.length, 15);
  assert.equal(formation.patch.edges.length, 22);
  assert.equal(formation.patch.regions.length, 8);
  assert.equal(formation.boundary.length, 12);
  assert.deepEqual(formation.outline[0], [0, -1]);

  // Every interior edge is walked twice, once by each band it separates, and
  // every rim edge exactly once -- the outline and the boundary agree.
  const uses = new Map();
  for (const region of formation.patch.regions) {
    for (const use of region.boundary) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
  }
  assert.equal([...uses.values()].filter((count) => count === 1).length, 12);
  assert.equal([...uses.values()].filter((count) => count === 2).length, 10);
});

test("the spine is a real shared chain, addressable from the node ids alone", () => {
  const vertices = [];
  for (const x of [0, 1]) {
    for (const z of [-1, 0, 1]) vertices.push({ x, y: 0, z });
  }
  const formation = pathPatch(
    "table-1",
    "path-1",
    "path",
    {
      referenceLine: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      vertices,
      quads: [[0, 3, 4, 1], [1, 4, 5, 2]],
      boundary: [0, 3, 4, 5, 2, 1],
    },
    3,
    1,
  );

  const spine = formation.patch.nodes.filter((node) => parseStationNodeId(node.id)?.across === 0);
  assert.equal(spine.length, 2, "one spine node per station");
  assert.deepEqual(spine.map((node) => node.position.z), [0, 0]);

  // The chain between the two spine nodes is one edge, used by both bands --
  // the seam that makes the travel line stored rather than forgotten.
  const spineIds = new Set(spine.map((node) => node.id));
  const seam = formation.patch.edges.filter(
    (edge) => spineIds.has(edge.startNodeId) && spineIds.has(edge.endNodeId),
  );
  assert.equal(seam.length, 1);
  const uses = formation.patch.regions.filter((region) =>
    region.boundary.some((use) => use.edgeId === seam[0].edgeId),
  );
  assert.equal(uses.length, 2, "both bands meet along the spine");
});
