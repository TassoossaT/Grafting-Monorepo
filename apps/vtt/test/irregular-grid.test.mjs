import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTriangleHex,
  createRandom,
  ortho,
  pairTriangles,
  relax,
  weld,
} from "../src/composition/tabletop/tools/terrain/irregular-grid.ts";

const hex = () => buildTriangleHex({ trianglesPerSide: 4, triangleSide: 0.5 });

test("a vertex named in pinnedTargets lands exactly on that position, not merely near it", () => {
  const welded = weld(ortho(pairTriangles(hex(), createRandom(5))));
  // An arbitrary point well outside the mesh's own footprint, so nothing
  // about the mesh's ordinary relaxation could produce it by coincidence.
  const target = { x: 100, y: -50 };
  const pinnedIndex = 0;

  const relaxed = relax(welded, {
    iterations: 12,
    pinnedTargets: new Map([[pinnedIndex, target]]),
  });

  assert.deepEqual(relaxed.vertices[pinnedIndex], target);
});

test("pinnedTargets overrides pinBoundary for the same vertex", () => {
  const welded = weld(ortho(pairTriangles(hex(), createRandom(5))));
  const boundary = [...welded.quads.flat()][0];
  const target = { x: 42, y: 42 };

  const relaxed = relax(welded, {
    iterations: 12,
    pinBoundary: true,
    pinnedTargets: new Map([[boundary, target]]),
  });

  assert.deepEqual(relaxed.vertices[boundary], target);
});

test("a mesh with no pinnedTargets relaxes exactly as it did before the option existed", () => {
  const welded = weld(ortho(pairTriangles(hex(), createRandom(5))));
  const withoutOption = relax(welded, { iterations: 12 });
  const withEmptyMap = relax(welded, { iterations: 12, pinnedTargets: new Map() });

  assert.deepEqual(withEmptyMap.vertices, withoutOption.vertices);
});
