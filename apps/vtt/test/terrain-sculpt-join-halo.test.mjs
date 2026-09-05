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

/** Even-odd point-in-ring test, XZ -- a minimal stand-in for the engine's own. */
function pointInRing(ring, x, z) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [ax, az] = ring[index];
    const [bx, bz] = ring[previous];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/**
 * A footprint query answered from the same fixtures `getRegionTopologiesInBounds`
 * serves, rather than hard-coded empty -- `terrain-sculpt-tool` now seeds its
 * neighbourhood query from this, so a fixture where it always reports nothing
 * would make every stroke look seedless and hide exactly the bug these tests
 * guard against.
 */
function footprintCoverageOf(topologies, ring) {
  return topologies
    .filter((topology) => topology.nodes.some((node) => pointInRing(ring, node.position.x, node.position.z)))
    .map((topology) => ({
      surfaceKey: topology.surfaceKey,
      surfaceType: topology.surfaceType,
      physical: true,
      // Never "centroid" here: these fixtures exist to exercise the seam/halo
      // logic, not the separate raise-on-self-overlap path, which only acts
      // on a "centroid" coverage.
      coverage: "overlap",
      centroid: topology.nodes[0].position,
      nodeIds: topology.nodes.map((node) => node.id),
    }));
}

function buildCtx(topologies, capture) {
  return {
    runtime: {
      getFootprintCoverage: (ring) => footprintCoverageOf(topologies, ring),
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

test("a face outside the halo and disconnected from the brush is left completely alone", () => {
  // A face far from everything -- shares no node with SEAM_QUAD, and none of
  // its own corners land inside this stroke's `probeArea` either. A normal
  // faceSize-scale square (side 2), not the sub-cell sliver a tighter one
  // would be: `outlineConstraints`'s own weld (faceSize * 0.5 = 1 here)
  // exists to drop slivers a real stroke's outline leaves behind, and would
  // just as happily collapse a test fixture smaller than that -- this one is
  // sized to survive it, the same as real terrain would.
  //
  // **This used to be folded in anyway**, on the reasoning that every
  // standing face the (padded) search radius reached had to join the outer
  // union or a reclaimed neighbour's edge might coincide with its hole ring.
  // Reproduced against the real engine: two mounds with a genuine gap
  // between their own painted edges, neither touching nor overlapping
  // either one's halo, still folded into each other's `fillArea` union this
  // way -- and lost faces re-adopting against it on every later repaint of
  // the *other* mound, never stabilizing. A face this disconnected has to be
  // left out of the union entirely, not merely out of `replacedSurfaceKeys`.
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
  assert.ok(!boundaryHasIsland, "the island's own footprint never enters the outer boundary -- it is untouched");
  assert.ok(!holeHasIsland, "and is never carved out as a hole either -- there is nothing here for it to cancel");
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

test("a lone neighbour outside the halo, touching nothing, is left alone even though the lookup still runs", () => {
  // x 9-11 sits outside even the joinHalo-2 probe's own reach (brushRadius 4
  // + faceSize 2 * joinHalo 2 = 8), so nothing here is ever handed over as a
  // seed -- `covered` and the halo's own coverage are both empty, and this
  // fixture has nothing for it to touch either. The engine call still has to
  // go out regardless (an earlier version skipped it outright on an empty
  // seed list, which is its own bug -- see the next test for the real seam
  // that regression actually broke), but a lone, disconnected face the scan
  // merely turns up sharing its padded box is not reason enough to fold it
  // into this stroke's own boundary or holes.
  const RETAINED_NEIGHBOUR = [
    { id: "n0", x: 9, z: -1 },
    { id: "n1", x: 11, z: -1 },
    { id: "n2", x: 11, z: 1 },
    { id: "n3", x: 9, z: 1 },
  ];
  const capture = {};
  const ctx = buildCtx([squareTopology(["neighbour"], "terrain", RETAINED_NEIGHBOUR)], capture);
  terrainSculptTool.onPointerUp(ctx, clickAtOrigin(), paramsWith(2));
  const [{ boundary, holes }] = capture.gridRequests;
  assert.equal(boundary.length, 1, "the neighbour never enters the outer boundary -- it is untouched");
  assert.equal(holes.length, 0, "and is never carved out as a hole either");
});

test("a seam stroke covering neither of two already-touching pieces still carves out their shared edge", () => {
  // The real crash this pair of pieces guards against: a stroke landing in
  // the gap between two pieces that already touch *each other* covers
  // neither directly, so `covered` and the halo's own footprint coverage are
  // both empty for both of them. `NEAR_HALF` pokes one corner (x: 5) inside
  // this joinHalo-2 stroke's own probe (brushRadius 4 + faceSize 2 * 2 = 8,
  // so anything at x <= 8 qualifies) -- that is what seeds it. `FAR_HALF`
  // shares node ids "m1"/"m2" with it at x: 7 -- the two already-touching
  // pieces -- and reaches out to x: 13, well past the probe on its own.
  // Dropping `FAR_HALF` here is exactly what used to plant a face on an
  // edge two existing faces already shared: "already used 2 times".
  const NEAR_HALF = [
    { id: "m0", x: 5, z: -1 },
    { id: "m1", x: 7, z: -1 },
    { id: "m2", x: 7, z: 1 },
    { id: "m3", x: 5, z: 1 },
  ];
  const FAR_HALF = [
    { id: "m1", x: 7, z: -1 },
    { id: "m4", x: 13, z: -1 },
    { id: "m5", x: 13, z: 1 },
    { id: "m2", x: 7, z: 1 },
  ];
  const capture = {};
  const ctx = buildCtx(
    [squareTopology(["near"], "terrain", NEAR_HALF), squareTopology(["far"], "terrain", FAR_HALF)],
    capture,
  );
  terrainSculptTool.onPointerUp(ctx, clickAtOrigin(), paramsWith(2));
  const [{ boundary, holes }] = capture.gridRequests;
  // The two pieces share an edge, so `outwardPerimeterRings` cancels it and
  // walks their combined outline as one ring -- not two: `swept`'s own
  // circle plus that one merged rectangle.
  assert.equal(boundary.length, 2, "the merged, already-touching pair folds into the outer boundary as one ring");
  assert.equal(holes.length, 1, "and carves back out as one hole -- dropping it is what caused the crash");
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
