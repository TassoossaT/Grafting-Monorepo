import assert from "node:assert/strict";
import test from "node:test";

import {
  heightFieldOf,
  neighbourhoodReach,
  normalizeTerrainAround,
  repairTerrainCut,
} from "../src/composition/tabletop/tools/terrain/terrain-regenerate.ts";

/**
 * A field of two terrain faces sharing one edge, with a road standing on the
 * left face. The cut consumed the left face; the repair has to regrow it
 * around the road.
 *
 *   n0---n1---n2      the shared edge is n1-n4
 *   |  L  |  R  |     L is consumed, R survives
 *   n3---n4---n5
 */
function field() {
  const at = {
    n0: { x: 0, y: 1, z: 0 },
    n1: { x: 2, y: 1, z: 0 },
    n2: { x: 4, y: 1, z: 0 },
    n3: { x: 0, y: 1, z: 2 },
    n4: { x: 2, y: 1, z: 2 },
    n5: { x: 4, y: 1, z: 2 },
    // The road, a square sitting inside the left face.
    r0: { x: 0.5, y: 1, z: 0.5 },
    r1: { x: 1.5, y: 1, z: 0.5 },
    r2: { x: 1.5, y: 1, z: 1.5 },
    r3: { x: 0.5, y: 1, z: 1.5 },
  };

  const face = (surfaceKey, ids) => ({
    surfaceKey,
    surfaceType: surfaceKey[0] === "road" ? "path" : "terrain",
    physical: true,
    outerLoops: [
      ids.map((id, index) => {
        const next = ids[(index + 1) % ids.length];
        return { edgeId: `e:${id}~${next}`, reversed: false, startNodeId: id, endNodeId: next, geometry: { kind: "line" } };
      }),
    ],
    holes: [],
    nodes: ids.map((id) => ({ id, position: at[id] })),
  });

  const left = face(["terrain", "L"], ["n0", "n1", "n4", "n3"]);
  const right = face(["terrain", "R"], ["n1", "n2", "n5", "n4"]);
  const road = face(["road", "P"], ["r0", "r1", "r2", "r3"]);

  const deleted = [];
  const requests = [];
  const patches = [];
  // Everything is live until a region is deleted; then the nodes only that
  // region used go with it, which is what the repair has to notice.
  const onlyLeft = new Set(["n0", "n3"]);
  const nodePositions = new Map(Object.entries(at).map(([id, position]) => [id, { position }]));

  const runtime = {
    getRegionTopology(surfaceKey) {
      const key = surfaceKey.join(" ");
      if (key === "terrain L") return left;
      if (key === "terrain R") return right;
      if (key === "road P") return road;
      return undefined;
    },
    applyRegionEdit(ops) {
      for (const op of ops) {
        if (op.kind !== "delete-region") continue;
        deleted.push(op.surfaceKey.join(" "));
        for (const id of onlyLeft) nodePositions.delete(id);
      }
      return {};
    },
    getSnapshot: () => ({ tableId: "t", map: { nodePositions } }),
    generateIrregularQuadGrid(request) {
      requests.push(request);
      // Two cells, no contour nodes: this test is about what goes *down*, and
      // the seam machinery has its own tests.
      return {
        vertices: [
          { x: 0, z: 0, source: 0 },
          { x: 2, z: 0, source: 1 },
          { x: 2, z: 2 },
          { x: 0, z: 2 },
        ],
        quads: [[0, 1, 2, 3]],
        onContour: [],
        refinementComplete: true,
      };
    },
    addPatch(patch) {
      patches.push(patch);
      return { createdSurfaceKeys: patch.regions.map((region) => region.regionId), skippedRegionIds: [] };
    },
  };

  const fallout = {
    paintedNodes: ["r0", "r1", "r2", "r3"].map((id) => ({ id, position: at[id] })),
    paintedLoops: [road.outerLoops[0]],
    consumedSurfaceKeys: [["terrain", "L"]],
  };

  return { runtime, fallout, deleted, requests, patches, at };
}

test("the consumed face is deleted, and the hole it leaves is what gets regenerated", () => {
  const context = field();
  const built = repairTerrainCut(context.runtime, context.fallout, "cause-1", "t");

  assert.deepEqual(context.deleted, ["terrain L"], "the covered type deletes its own faces, nobody else's");
  assert.equal(built, 1);
  assert.equal(context.requests.length, 1);
});

test("the road goes down as a hole, so no ground is laid over the top of it", () => {
  const context = field();
  repairTerrainCut(context.runtime, context.fallout, "cause-1", "t");
  const request = context.requests[0];

  assert.equal(request.holes.length, 1, "the painter's own contour");
  const hole = request.holes[0];
  assert.equal(hole.length, 4);
  // Every corner of the road names a source, or the regrown ground would meet
  // it at a coincident position instead of at the same node.
  assert.ok(hole.every((point) => typeof point.source === "number"));
});

test("a rim node the deletion took with it keeps its position and loses its source", () => {
  const context = field();
  repairTerrainCut(context.runtime, context.fallout, "cause-1", "t");
  const boundary = context.requests[0].boundary[0];

  const shared = boundary.filter((point) => point.source !== undefined);
  const orphaned = boundary.filter((point) => point.source === undefined);
  // n1 and n4 are shared with the surviving right face; n0 and n3 died with L.
  assert.equal(shared.length, 2);
  assert.equal(orphaned.length, 2);
  // The shape of the hole is unchanged either way -- only the identity is gone.
  assert.equal(boundary.length, 4);
  for (const point of orphaned) {
    assert.ok([context.at.n0, context.at.n3].some((node) => node.x === point.x && node.z === point.z));
  }
});

test("rim and road share one numbering, because the generator answers with one index", () => {
  const context = field();
  repairTerrainCut(context.runtime, context.fallout, "cause-1", "t");
  const request = context.requests[0];
  const sources = [
    ...request.boundary.flatMap((ring) => ring.map((point) => point.source)),
    ...request.holes.flatMap((ring) => ring.map((point) => point.source)),
  ].filter((source) => source !== undefined);

  assert.equal(new Set(sources).size, sources.length, "no index means two different nodes");
});

test("regrown corners sit at the height of the ground around them, not at zero", () => {
  const context = field();
  repairTerrainCut(context.runtime, context.fallout, "cause-1", "t");
  const patch = context.patches[0];

  // Everything standing here is at y = 1, so anything blended from it is too.
  assert.ok(patch.nodes.length > 0);
  for (const node of patch.nodes) assert.ok(Math.abs(node.position.y - 1) < 1e-9);
});

test("a cut that consumed nothing the engine still knows repairs nothing", () => {
  const context = field();
  const built = repairTerrainCut(
    context.runtime,
    { ...context.fallout, consumedSurfaceKeys: [["terrain", "gone"]] },
    "cause-1",
    "t",
  );
  assert.equal(built, 0);
  assert.deepEqual(context.deleted, [], "nothing is deleted on the strength of a stale key");
});

test("the height field keeps relief instead of averaging it away", () => {
  // A ridge: high on the left, low on the right, far enough apart that a
  // global blend would meet in the middle.
  const anchors = [
    { x: 0, y: 10, z: 0 },
    { x: 1, y: 10, z: 0 },
    { x: 40, y: 0, z: 0 },
    { x: 41, y: 0, z: 0 },
  ];
  const field = heightFieldOf(anchors, 4);
  assert.ok(field.at({ x: 0.5, z: 0 }) > 9, "next to the high side, it is high");
  assert.ok(field.at({ x: 40.5, z: 0 }) < 1, "next to the low side, it is low");
});

test("a point no anchor reaches has no opinion, so the caller's rule decides", () => {
  const field = heightFieldOf([{ x: 0, y: 5, z: 0 }], 2);
  assert.equal(field.at({ x: 100, z: 100 }), undefined);
});

test("sitting exactly on an anchor takes its height rather than dividing by zero", () => {
  const field = heightFieldOf([{ x: 3, y: 7, z: 4 }], 2);
  assert.equal(field.at({ x: 3, z: 4 }), 7);
});

test("the neighbourhood reaches past the brush, or the seam stays on its own rim", () => {
  assert.ok(neighbourhoodReach(2) >= 2, "at least one face clear of anything the stroke touched");
});

test("normalizing consumes its own type and meets every other one", () => {
  const context = field();
  // The whole field, both terrain faces and the road, is in the neighbourhood.
  context.runtime.getFootprintCoverage = () => [
    { surfaceKey: ["terrain", "L"], surfaceType: "terrain" },
    { surfaceKey: ["terrain", "R"], surfaceType: "terrain" },
    { surfaceKey: ["road", "P"], surfaceType: "path" },
  ];

  normalizeTerrainAround(context.runtime, {
    dilatedOutline: [[[[0, 0], [4, 0], [4, 4], [0, 4]]]],
    surfaceType: "terrain",
    faceSide: 2,
    causeId: "cause-1",
    tableId: "t",
    heightOfNewGround: () => 0,
  });

  assert.deepEqual(context.deleted.sort(), ["terrain L", "terrain R"], "the road is met, never consumed");
  const request = context.requests[0];
  assert.equal(request.holes.length, 1, "the road went down as a contour");
  assert.ok(request.holes[0].every((point) => typeof point.source === "number"));
});

test("normalizing where nothing of its own type stands does nothing", () => {
  const context = field();
  context.runtime.getFootprintCoverage = () => [{ surfaceKey: ["road", "P"], surfaceType: "path" }];
  const built = normalizeTerrainAround(context.runtime, {
    dilatedOutline: [[[[0, 0], [4, 0], [4, 4], [0, 4]]]],
    surfaceType: "terrain",
    faceSide: 2,
    causeId: "cause-1",
    tableId: "t",
    heightOfNewGround: () => 0,
  });
  assert.equal(built, 0);
  assert.deepEqual(context.deleted, []);
});
