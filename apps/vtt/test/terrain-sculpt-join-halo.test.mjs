import assert from "node:assert/strict";
import test from "node:test";

import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";

/**
 * A square face `a b c d`, as the engine reports one -- copied from
 * terrain-constraints.test.mjs's own fixture, which the same shape already
 * exercises through `perimeterConstraints`.
 */
function squareTopology(surfaceKey, surfaceType, corners) {
  const outer = corners.map((corner, index) => {
    const next = corners[(index + 1) % corners.length];
    return {
      edgeId: `e:${corner.id}~${next.id}`,
      reversed: false,
      startNodeId: corner.id,
      endNodeId: next.id,
      geometry: { kind: "line" },
    };
  });
  return {
    surfaceKey,
    surfaceType,
    physical: true,
    outerLoops: [outer],
    holes: [],
    nodes: corners.map((corner) => ({ id: corner.id, position: { x: corner.x, y: 0, z: corner.z } })),
  };
}

/**
 * A face just outside a `brushRadius: 4` click's own footprint (a circle,
 * chord 4, inscribed -- so nothing on it ever sits farther than 4 from the
 * centre) and, once `joinHalo: 1` widens the fill to radius 6 (chord 4, ten
 * sides -- nothing on it ever sits nearer than `6 * cos(pi/10) ≈ 5.7`),
 * comfortably inside that too. The margin on both sides is about half a unit,
 * regardless of which way the polygon happens to facet.
 */
const SEAM_QUAD = [
  { id: "q0", x: 4.95, z: -0.05 },
  { id: "q1", x: 5.05, z: -0.05 },
  { id: "q2", x: 5.05, z: 0.05 },
  { id: "q3", x: 4.95, z: 0.05 },
];

function paramsWith(joinHalo) {
  return {
    faceSize: 2,
    brushRadius: 4,
    irregularity: 0.7,
    joinHalo,
    heightScale: 0,
    noiseScale: 0.15,
    targetSurface: "terrain",
    seed: 1,
  };
}

function buildCtx(topologies, capture) {
  return {
    runtime: {
      getFootprintCoverage: () => [],
      getRegionTopologiesInBounds: () => topologies,
      generateHeightmap: (columns, rows) => new Float32Array(columns * rows),
      generateIrregularQuadGrid: () => ({ vertices: [], quads: [], onContour: [], refinementComplete: true }),
      addPatch: () => {
        capture.addPatchCalled = true;
        return {
          affectedSurfaceKeys: [], createdSurfaceKeys: [], removedSurfaceKeys: [],
          createdNodeIds: [], removedNodeIds: [], skippedRegionIds: [], skippedRegionReasons: [],
        };
      },
      applyPatchReplacement: (request) => {
        capture.replacedSurfaceKeys = request.sourceSurfaceKeys;
        return {
          affectedSurfaceKeys: [], createdSurfaceKeys: [], removedSurfaceKeys: request.sourceSurfaceKeys,
          createdNodeIds: [], removedNodeIds: [], skippedRegionIds: [], skippedRegionReasons: [],
        };
      },
      applyRegionEdit: () => { throw new Error("this fixture has no contour adoption to apply"); },
      getSnapshot: () => ({ map: { nodePositions: new Map() } }),
    },
    history: {},
    tableId: "table-1",
    snapToGrid: false,
    nextSequence: (() => { let n = 0; return () => (n += 1); })(),
    reportSelection: () => {},
    reportFeedback: () => {},
  };
}

function clickAtOrigin() {
  const point = { x: 0, y: 0, z: 0 };
  return { start: { point }, current: { point }, samples: [{ point }] };
}

test("joinHalo 0 only meets a seam face, never reclaims it", () => {
  const capture = {};
  const ctx = buildCtx([squareTopology(["seam"], "terrain", SEAM_QUAD)], capture);
  terrainSculptTool.onPointerUp(ctx, clickAtOrigin(), paramsWith(0));
  assert.equal(capture.addPatchCalled, true, "nothing consumed, so this is a plain add");
  assert.equal(capture.replacedSurfaceKeys, undefined, "the seam face is never named as replaced");
});

test("joinHalo widens the fill enough to reclaim and regenerate a seam face", () => {
  const capture = {};
  const ctx = buildCtx([squareTopology(["seam"], "terrain", SEAM_QUAD)], capture);
  terrainSculptTool.onPointerUp(ctx, clickAtOrigin(), paramsWith(1));
  assert.deepEqual(capture.replacedSurfaceKeys, [["seam"]], "the seam face is consumed into this generation");
  assert.equal(capture.addPatchCalled, undefined, "a replacement path is taken, not a plain add");
});

test("a mismatched surface type at the seam is never reclaimed, whatever the halo", () => {
  const capture = {};
  const ctx = buildCtx([squareTopology(["seam"], "terrain-grass", SEAM_QUAD)], capture);
  terrainSculptTool.onPointerUp(ctx, clickAtOrigin(), paramsWith(1));
  assert.equal(capture.addPatchCalled, true);
  assert.equal(capture.replacedSurfaceKeys, undefined);
});
