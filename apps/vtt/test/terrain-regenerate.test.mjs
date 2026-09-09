import assert from "node:assert/strict";
import test from "node:test";

import {
  heightFieldOf,
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
    getAllRegionTopologies: () => [],
    getRegionTopologiesInBounds: () => [],
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

test("road loops preserve all constraint points and boundary edges for seamless cut repair stitching", () => {
  const context = field();
  const denseNodes = [];
  const denseEdges = [];
  const count = 40;
  for (let i = 0; i < count; i += 1) {
    const id = `dense_r${i}`;
    const nextId = `dense_r${(i + 1) % count}`;
    const angle = (i / count) * 2 * Math.PI;
    const pos = { x: 1 + 0.3 * Math.cos(angle), y: 1, z: 1 + 0.3 * Math.sin(angle) };
    denseNodes.push({ id, position: pos });
    denseEdges.push({
      edgeId: `e:${id}~${nextId}`,
      reversed: false,
      startNodeId: id,
      endNodeId: nextId,
      geometry: { kind: "line" },
    });
  }

  const denseFallout = {
    paintedNodes: denseNodes,
    paintedLoops: [denseEdges],
    consumedSurfaceKeys: [["terrain", "L"]],
  };

  repairTerrainCut(context.runtime, denseFallout, "cause-dense", "t");
  const request = context.requests[context.requests.length - 1];
  assert.ok(request, "a request was sent to the generator");
  const hole = request.holes[0];
  assert.equal(hole.length, count, `hole points should retain all ${count} road boundary vertices`);
  assert.ok(hole.every((point) => typeof point.source === "number"), "every hole point must have a valid source index");
});

test("a road loop that only grazes the rim's bounding box, without the rim's shape actually containing it, is dropped rather than handed to the generator", () => {
  const context = field();
  // A second, unrelated road square sitting well clear of the consumed L
  // face (x in [0,2], z in [0,2]) but still inside the bounding-box margin
  // the old filter alone would have let through.
  const foreignAt = {
    f0: { x: 4.5, y: 1, z: 0.5 },
    f1: { x: 5.5, y: 1, z: 0.5 },
    f2: { x: 5.5, y: 1, z: 1.5 },
    f3: { x: 4.5, y: 1, z: 1.5 },
  };
  const foreignIds = ["f0", "f1", "f2", "f3"];
  const foreignLoop = foreignIds.map((id, index) => {
    const next = foreignIds[(index + 1) % foreignIds.length];
    return { edgeId: `e:${id}~${next}`, reversed: false, startNodeId: id, endNodeId: next, geometry: { kind: "line" } };
  });

  const fallout = {
    paintedNodes: [...context.fallout.paintedNodes, ...foreignIds.map((id) => ({ id, position: foreignAt[id] }))],
    paintedLoops: [...context.fallout.paintedLoops, foreignLoop],
    consumedSurfaceKeys: context.fallout.consumedSurfaceKeys,
  };

  repairTerrainCut(context.runtime, fallout, "cause-foreign", "t");
  const request = context.requests[context.requests.length - 1];

  assert.equal(request.holes.length, 1, "only the road loop the rim's own shape contains is kept");
  const hole = request.holes[0];
  assert.equal(hole.length, 4);
  for (const point of hole) {
    assert.ok(
      ["r0", "r1", "r2", "r3"].some((id) => Math.abs(context.at[id].x - point.x) < 1e-9 && Math.abs(context.at[id].z - point.z) < 1e-9),
      "the surviving hole is the road actually standing on the consumed face, not the foreign one",
    );
  }
});

test("contour nodes landing on road hole boundary edges are adopted to split the road edge", () => {
  const context = field();
  let splitOps = [];
  const runtime = {
    ...context.runtime,
    applyRegionEdit(ops) {
      context.runtime.applyRegionEdit(ops);
      for (const op of ops) {
        if (op.kind === "insert-vertex") splitOps.push(op);
      }
      return {};
    },
    generateIrregularQuadGrid(request) {
      context.requests.push(request);
      return {
        vertices: [
          { x: 0, z: 0, source: 0 },
          { x: 2, z: 0, source: 1 },
          { x: 1.0, z: 0.5 }, // point on road top edge r0-r1
          { x: 0, z: 2 },
        ],
        quads: [[0, 1, 2, 3]],
        onContour: [
          { vertex: 2, ringKind: "hole", ring: 0, segment: 0 },
        ],
        refinementComplete: true,
      };
    },
  };

  const built = repairTerrainCut(runtime, context.fallout, "cause-adopt", "t");
  assert.equal(built, 1);
  assert.equal(splitOps.length, 1, "road boundary edge should be split by adoption");
  assert.equal(splitOps[0].edgeId, "e:r0~r1");
  assert.ok(splitOps[0].nodeId.startsWith("cause-adopt:regen-"));
  assert.ok(splitOps[0].nodeId.endsWith(":v2"));
});
