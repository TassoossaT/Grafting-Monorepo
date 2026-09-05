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
    minFaceSize: 1,
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

test("a face inside the search radius but disconnected from the brush is left retained, not reclaimed", () => {
  // A face far from everything -- shares no node with SEAM_QUAD or with
  // anything touching swept, so it can never be reclaimed. A normal
  // faceSize-scale square (side 2), not the sub-cell sliver a tighter one
  // would be: `outlineConstraints`'s own weld (faceSize * 0.5 = 1 here)
  // exists to drop slivers a real stroke's outline leaves behind, and would
  // just as happily collapse a test fixture smaller than that -- this one is
  // sized to survive it, the same as real terrain would.
  const FAR_ISLAND = [
    { id: "f0", x: 9, z: -1 },
    { id: "f1", x: 11, z: -1 },
    { id: "f2", x: 11, z: 1 },
    { id: "f3", x: 9, z: 1 },
  ];
  const capture = {};
  const ctx = buildCtx(
    [squareTopology(["seam"], "terrain", SEAM_QUAD), squareTopology(["island"], "terrain", FAR_ISLAND)],
    capture,
  );
  terrainSculptTool.onPointerUp(ctx, clickAtOrigin(), paramsWith(1));
  assert.deepEqual(capture.replacedSurfaceKeys, [["seam"]], "only the touching face is reclaimed, not the far island");

  // The far island is folded into the outer boundary too (every standing
  // face nearby is, so a reclaimed face's own edges never coincide with a
  // retained neighbour's hole ring -- see the union's own comment). Left
  // there alone it would add real new ground the brush never touched; what
  // makes that safe is that its own footprint is *also* carved back out as a
  // hole, at the exact same four corners, so the two cancel to net zero.
  const [{ boundary, holes }] = capture.gridRequests;
  const asKeySet = (ring) => new Set(ring.map((point) => `${point.x.toFixed(6)}:${point.z.toFixed(6)}`));
  const islandKeys = asKeySet(FAR_ISLAND.map((corner) => ({ x: corner.x, z: corner.z })));
  const boundaryHasIsland = boundary.some((ring) => {
    const keys = asKeySet(ring);
    return [...islandKeys].every((key) => keys.has(key));
  });
  const holeHasIsland = holes.some((ring) => {
    const keys = asKeySet(ring);
    return [...islandKeys].every((key) => keys.has(key));
  });
  assert.ok(boundaryHasIsland, "the island's own footprint is folded into the outer boundary");
  assert.ok(holeHasIsland, "and carved back out as a hole at the same corners, cancelling it to no net ground");
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

test("low irregularity scales the face size up past its nominal value", () => {
  const capture = {};
  const ctx = buildCtx([], capture);
  terrainSculptTool.onPointerUp(ctx, clickAtOrigin(), { ...paramsWith(0), irregularity: 0, faceSize: 2, minFaceSize: 0.1 });
  assert.equal(capture.gridRequests[0].faceSide, 4, "irregularity 0 scales faceSize by 2x");
});

test("high irregularity scales the face size down, floored at minFaceSize", () => {
  const capture = {};
  const ctx = buildCtx([], capture);
  terrainSculptTool.onPointerUp(ctx, clickAtOrigin(), { ...paramsWith(0), irregularity: 1, faceSize: 2, minFaceSize: 1.5 });
  // Unfloored this would be faceSize * 0.5 = 1, but minFaceSize 1.5 wins.
  assert.equal(capture.gridRequests[0].faceSide, 1.5, "the floor beats the irregularity-1 scale");
});

test("high irregularity with a permissive floor reaches the full scaled-down size", () => {
  const capture = {};
  const ctx = buildCtx([], capture);
  terrainSculptTool.onPointerUp(ctx, clickAtOrigin(), { ...paramsWith(0), irregularity: 1, faceSize: 2, minFaceSize: 0.1 });
  assert.equal(capture.gridRequests[0].faceSide, 1, "irregularity 1 scales faceSize by 0.5x when the floor allows it");
});
