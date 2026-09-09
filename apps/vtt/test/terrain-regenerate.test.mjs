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
 *
 * The road comes in two shapes because they are the two cases the repair has
 * to tell apart, and getting them backwards is what this whole path was
 * failing at. A road *crossing* the face runs out of it on both sides: it is
 * subtracted, leaving two banks and no hole at all. A road sitting entirely
 * *inside* the face never reaches the rim: it is subtracted too, and what the
 * subtraction leaves is a ring with a hole in it. Either way there is one
 * boolean and one answer -- never a boundary from one derivation and a hole
 * from another.
 */
function field({ road = "crossing" } = {}) {
  const at = {
    n0: { x: 0, y: 1, z: 0 },
    n1: { x: 2, y: 1, z: 0 },
    n2: { x: 4, y: 1, z: 0 },
    n3: { x: 0, y: 1, z: 2 },
    n4: { x: 2, y: 1, z: 2 },
    n5: { x: 4, y: 1, z: 2 },
  };
  // A ribbon spanning L from rim to rim, or an island sitting inside it.
  const roadCorners =
    road === "crossing"
      ? { r0: { x: 0, y: 1, z: 0.5 }, r1: { x: 2, y: 1, z: 0.5 }, r2: { x: 2, y: 1, z: 1.5 }, r3: { x: 0, y: 1, z: 1.5 } }
      : { r0: { x: 0.5, y: 1, z: 0.5 }, r1: { x: 1.5, y: 1, z: 0.5 }, r2: { x: 1.5, y: 1, z: 1.5 }, r3: { x: 0.5, y: 1, z: 1.5 } };
  Object.assign(at, roadCorners);

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
  const roadFace = face(["road", "P"], ["r0", "r1", "r2", "r3"]);

  const requests = [];
  const patches = [];
  const replacements = [];
  const edits = [];
  const nodePositions = new Map(Object.entries(at).map(([id, position]) => [id, { position }]));

  const runtime = {
    getRegionTopology(surfaceKey) {
      const key = surfaceKey.join(" ");
      if (key === "terrain L") return left;
      if (key === "terrain R") return right;
      if (key === "road P") return roadFace;
      return undefined;
    },
    // Seeded, the query answers "terrain connected to what was touched" --
    // which is the only reason the road does not end up in `retained`.
    // Unseeded, it answers "everything in the box", which is how the repair
    // reads the painter's own contour back.
    getRegionTopologiesInBounds(query) {
      return query.seeds !== undefined ? [left, right] : [left, right, roadFace];
    },
    getAllRegionTopologies: () => [left, right, roadFace],
    applyRegionEdit(ops) {
      for (const op of ops) edits.push(op);
      return {};
    },
    getSnapshot: () => ({ tableId: "t", map: { nodePositions } }),
    generateIrregularQuadGrid(request) {
      requests.push(request);
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
      return {
        createdSurfaceKeys: patch.regions.map((region) => region.regionId),
        skippedRegionIds: [],
        skippedRegionReasons: [],
        removedSurfaceKeys: [],
      };
    },
    applyPatchReplacement(request) {
      replacements.push(request);
      patches.push(request.patch);
      return {
        createdSurfaceKeys: request.patch.regions.map((region) => region.regionId),
        skippedRegionIds: [],
        skippedRegionReasons: [],
        removedSurfaceKeys: request.sourceSurfaceKeys,
      };
    },
  };

  const outlineOf = (ids) => ids.map((id) => [at[id].x, at[id].z]);

  const fallout = {
    paintedNodes: ["r0", "r1", "r2", "r3"].map((id) => ({ id, position: at[id] })),
    paintedLoops: [roadFace.outerLoops[0]],
    consumedSurfaceKeys: [["terrain", "L"]],
    footprintOutline: outlineOf(["r0", "r1", "r2", "r3"]),
    painterSurfaceType: "path",
  };

  return { runtime, fallout, requests, patches, replacements, edits, at };
}

/**
 * Every ring the generator was asked to lay ground in, boundary and holes
 * alike. A ring here is a bare array of constraint points -- `{x, z, source?}`
 * -- because that is the shape the port takes.
 */
function ringsOf(request) {
  return [...request.boundary, ...request.holes];
}

/** The constraint point standing exactly where a node does, if any ring has one. */
function pointAt(request, position) {
  for (const ring of ringsOf(request)) {
    for (const point of ring) {
      if (Math.abs(point.x - position.x) < 1e-9 && Math.abs(point.z - position.z) < 1e-9) return point;
    }
  }
  return undefined;
}

test("the consumed face is replaced atomically, in the same call that lays the new ground", () => {
  const context = field();
  const built = repairTerrainCut(context.runtime, context.fallout, "cause-1", "t");

  assert.ok(built > 0, "ground came back");
  assert.equal(context.requests.length, 1, "the generator is asked once");
  assert.equal(context.replacements.length, 1, "one atomic replacement, not a delete followed by a build");
  assert.deepEqual(
    context.replacements[0].sourceSurfaceKeys.map((key) => key.join(" ")),
    ["terrain L"],
    "the covered type replaces its own faces, nobody else's",
  );
  assert.deepEqual(
    context.edits.filter((op) => op.kind === "delete-region"),
    [],
    "nothing is deleted outside the replacement -- a refusal must cost no ground",
  );
});

test("a road that crosses the face is subtracted from the ground, not handed over as a hole", () => {
  const context = field({ road: "crossing" });
  repairTerrainCut(context.runtime, context.fallout, "cause-1", "t");
  const request = context.requests[0];

  assert.equal(request.holes.length, 0, "a ribbon running out of the face is not a hole in it");
  assert.equal(request.boundary.length, 2, "what is left of the face is its two banks");

  // No ring may enclose the middle of the road, or ground would be laid over it.
  const middleOfRoad = { x: 1, z: 1 };
  for (const ring of request.boundary) {
    assert.ok(!encloses(ring, middleOfRoad), "no bank reaches across the road");
  }
});

test("a road sitting inside the face leaves a hole, because that is what the subtraction leaves", () => {
  const context = field({ road: "island" });
  repairTerrainCut(context.runtime, context.fallout, "cause-1", "t");
  const request = context.requests[0];

  assert.equal(request.boundary.length, 1, "the face is still one piece");
  assert.equal(request.holes.length, 1, "with the road taken out of the middle of it");
  assert.ok(encloses(request.holes[0], { x: 1, z: 1 }), "the hole is where the road stands");
});

test("the road's own corners survive the subtraction still naming a node", () => {
  const context = field({ road: "crossing" });
  repairTerrainCut(context.runtime, context.fallout, "cause-1", "t");
  const request = context.requests[0];

  // `polygon-clipping` answers in bare floats and forgets everything else, so
  // a corner coming back out of it without a source is a corner the ground
  // will meet at a coincident *position* rather than at the road's own node.
  for (const id of ["r0", "r1", "r2", "r3"]) {
    const point = pointAt(request, context.at[id]);
    assert.ok(point !== undefined, `the road corner ${id} is still a constraint point`);
    assert.ok(typeof point.source === "number", `the road corner ${id} still names a node`);
  }
});

test("a corner the generator hands back by source is registered as that very node, not a new one", () => {
  const context = field({ road: "crossing" });
  const runtime = {
    ...context.runtime,
    generateIrregularQuadGrid(request) {
      context.requests.push(request);
      const road = pointAt(request, context.at.r0);
      const rim = pointAt(request, context.at.n1);
      return {
        vertices: [
          { x: road.x, z: road.z, source: road.source },
          { x: rim.x, z: rim.z, source: rim.source },
          { x: 1, z: 0.1 },
          { x: 0.2, z: 0.1 },
        ],
        quads: [[0, 1, 2, 3]],
        onContour: [],
        refinementComplete: true,
      };
    },
  };

  repairTerrainCut(runtime, context.fallout, "cause-1", "t");
  const patch = context.patches[0];
  const touched = new Set(patch.edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId]));

  assert.ok(touched.has("r0"), "the new ground shares the road's own node");
  assert.ok(touched.has("n1"), "and the surviving terrain's own node");
  assert.ok(
    !patch.nodes.some((node) => node.id === "r0" || node.id === "n1"),
    "neither is declared again -- declaring one would be a second node at the same identity",
  );
});

test("a rim node the replacement takes with it keeps its position and loses its source", () => {
  const context = field({ road: "island" });
  repairTerrainCut(context.runtime, context.fallout, "cause-1", "t");
  const boundary = context.requests[0].boundary[0];

  // n1 and n4 are shared with the surviving right face and are named; n0 and
  // n3 belong only to the face being replaced, so their positions survive but
  // their identity does not.
  const named = boundary.filter((point) => point.source !== undefined);
  const anonymous = boundary.filter((point) => point.source === undefined);
  assert.ok(named.length >= 2, "the shared rim keeps its identity");
  assert.ok(anonymous.length >= 2, "the rim that died with the face does not invent one");
  for (const point of anonymous) {
    assert.ok(
      [context.at.n0, context.at.n3].some(
        (node) => Math.abs(node.x - point.x) < 1e-9 && Math.abs(node.z - point.z) < 1e-9,
      ),
      "the shape of the rim is unchanged -- only the identity is gone",
    );
  }
});

test("rim and road share one numbering, because the generator answers with one index", () => {
  const context = field();
  repairTerrainCut(context.runtime, context.fallout, "cause-1", "t");
  const request = context.requests[0];
  const sources = ringsOf(request)
    .flatMap((ring) => ring.map((point) => point.source))
    .filter((source) => source !== undefined);

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
  assert.equal(context.requests.length, 0, "nothing is generated on the strength of a stale key");
  assert.equal(context.replacements.length, 0, "and nothing is replaced");
});

test("a repair with no footprint falls back to the hole itself rather than giving up", () => {
  const context = field();
  const { footprintOutline, ...withoutFootprint } = context.fallout;
  const built = repairTerrainCut(context.runtime, withoutFootprint, "cause-1", "t");

  assert.ok(built > 0, "a removal repair has no painter, and still has ground to regrow");
  assert.equal(context.requests.length, 1);
});

test("contour nodes landing on the road's contour are adopted, splitting the road's own edge", () => {
  const context = field({ road: "island" });
  const runtime = {
    ...context.runtime,
    generateIrregularQuadGrid(request) {
      context.requests.push(request);
      // One vertex placed on the first segment of the road hole, so adoption
      // has something real to resolve against.
      const hole = request.holes[0];
      const a = hole[0];
      const b = hole[1];
      return {
        vertices: [
          { x: 0, z: 0, source: 0 },
          { x: 2, z: 0, source: 1 },
          { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
          { x: 0, z: 2 },
        ],
        quads: [[0, 1, 2, 3]],
        onContour: [{ vertex: 2, ringKind: "hole", ring: 0, segment: 0 }],
        refinementComplete: true,
      };
    },
  };

  repairTerrainCut(runtime, context.fallout, "cause-adopt", "t");

  const splits = context.edits.filter((op) => op.kind === "insert-vertex");
  assert.equal(splits.length, 1, "the road's boundary edge is split by adoption");
  assert.ok(
    ["e:r0~r1", "e:r1~r2", "e:r2~r3", "e:r3~r0"].includes(splits[0].edgeId),
    `adoption split a road edge, got ${splits[0].edgeId}`,
  );
  assert.ok(splits[0].nodeId.startsWith("t:cut-cause-adopt"));
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

/** Ray-cast point-in-ring, for asserting what a constraint ring covers. */
function encloses(points, point) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const zi = points[i].z;
    const xj = points[j].x;
    const zj = points[j].z;
    if (zi > point.z !== zj > point.z && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
