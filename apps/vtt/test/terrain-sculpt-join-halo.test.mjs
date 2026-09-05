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
 * A face straddling a `brushRadius: 4` click's own edge -- two corners
 * (x: 3.7) inside the brush's swept circle, two (x: 4.3) outside it, along
 * the +x axis where that circle's polygon approximation sits exactly on a
 * vertex (so it tracks the true radius closely, unlike a facet midpoint).
 * Reclaiming this quad is the ordinary case `joinHalo` exists for: the brush
 * actually overlaps it, it is not merely nearby.
 */
const SEAM_QUAD = [
  { id: "q0", x: 3.7, z: -0.1 },
  { id: "q1", x: 4.3, z: -0.1 },
  { id: "q2", x: 4.3, z: 0.1 },
  { id: "q3", x: 3.7, z: 0.1 },
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
      generateIrregularQuadGrid: (request) => {
        capture.gridRequests = [...(capture.gridRequests ?? []), request];
        return { vertices: [], quads: [], onContour: [], refinementComplete: true };
      },
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

test("a face inside the search radius but disconnected from the brush is left retained, not unioned as a floating island", () => {
  // A far quad sits entirely inside probeArea (radius 6) but nowhere near
  // swept (radius 4) -- and, critically, nothing bridges it back: it shares
  // no node with SEAM_QUAD or with anything touching swept. Reclaiming it
  // anyway would hand outlineConstraints a second, disconnected outer ring,
  // which is exactly the malformed boundary that produced real holes in the
  // generated mesh once the boundary-outside-brush bug was fixed by simply
  // widening the search radius without also requiring a touching chain.
  // At 90 degrees from SEAM_QUAD, distance 4.9-5.1: outside swept (radius 4)
  // but comfortably inside probeArea's worst-case reach (radius 6, chord 4,
  // ten sides -- nothing on it sits nearer than 6 * cos(pi/10) ~= 5.7).
  const FAR_ISLAND = [
    { id: "f0", x: -0.1, z: 4.9 },
    { id: "f1", x: 0.1, z: 4.9 },
    { id: "f2", x: 0.1, z: 5.1 },
    { id: "f3", x: -0.1, z: 5.1 },
  ];
  const capture = {};
  const ctx = buildCtx(
    [squareTopology(["seam"], "terrain", SEAM_QUAD), squareTopology(["island"], "terrain", FAR_ISLAND)],
    capture,
  );
  terrainSculptTool.onPointerUp(ctx, clickAtOrigin(), paramsWith(1));
  assert.deepEqual(capture.replacedSurfaceKeys, [["seam"]], "only the touching face is reclaimed, not the far island");
  const [{ boundary }] = capture.gridRequests;
  assert.equal(boundary.length, 1, "one connected outer ring, never a disconnected second one");
});

test("with nothing standing nearby, joinHalo never asks the generator for ground beyond the brush", () => {
  const capture = {};
  const ctx = buildCtx([], capture);
  terrainSculptTool.onPointerUp(ctx, clickAtOrigin(), paramsWith(3));
  assert.equal(capture.gridRequests.length, 1);
  const [{ boundary }] = capture.gridRequests;
  assert.equal(boundary.length, 1, "one ring: the brush's own outline, nothing unioned in");
  for (const point of boundary[0]) {
    const distance = Math.hypot(point.x, point.z);
    assert.ok(
      distance <= 4 + 1e-6,
      `boundary point at distance ${distance} from the click reaches past brushRadius 4 -- generated beyond the preview`,
    );
  }
});
