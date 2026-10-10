import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { groundSurfaceOf, insideFace, shownGlobalHandles } from "../src/features/edit-construction/index.ts";

function bowl(runtime, session, heightAt) {
  runtime.getSnapshot = () => ({
    tableId: "t",
    map: { nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [n.id, { position: { x: n.position[0], y: n.position[1], z: n.position[2] } }])) },
  });
  const cell = 2, cells = 10, id = (i, j) => `g:${i}:${j}`, nodes = [];
  for (let i = 0; i <= cells; i++) for (let j = 0; j <= cells; j++) {
    const x = -10 + i * cell, z = -10 + j * cell;
    nodes.push({ id: id(i, j), position: { x, y: heightAt(x, z), z } });
  }
  const edges = new Map();
  const use = (a, b) => {
    const key = a < b ? `${a}~${b}` : `${b}~${a}`;
    if (!edges.has(key)) edges.set(key, { edgeId: `e:${key}`, startNodeId: a < b ? a : b, endNodeId: a < b ? b : a });
    return { edgeId: edges.get(key).edgeId, reversed: edges.get(key).startNodeId !== a };
  };
  const regions = [];
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    const ring = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)];
    regions.push({ regionId: `q:${i}:${j}`, boundary: ring.map((a, n) => use(a, ring[(n + 1) % 4])), surfaceType: "terrain", physical: true });
  }
  runtime.addPatch({ nodes, edges: [...edges.values()], regions });
}

function setup(heightAt) {
  const fixture = sessionFixture();
  Object.assign(runtime(fixture), { showPreview() {}, clearPreview() {} });
  bowl(fixture.runtime, fixture.session, heightAt);
  return fixture;
}
const runtime = (f) => f.runtime;
const floorAt = (ctx, [x0, z0, x1, z1], y) =>
  commitPlatformContour(ctx, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => ({ point: { x, y, z } })), { mode: "create", elevation: y, shape: "rectangle" });
const terrain = (r) => r.getAllRegionTopologies().filter((t) => t.surfaceType === "terrain");
const of = (r, type) => r.getAllRegionTopologies().find((t) => t.surfaceType === type);

test("platform half in hill, moved away: suspended terrain is untouched", async () => {
  const hill = (x, z) => Math.max(0, 8 - 0.35 * ((x - 6) ** 2 + z * z));
  const { runtime: r, ctx, session } = setup(hill);
  try {
    const y = 5.6;
    const box = [-1.3, -2.3, 5.3, 2.3];
    floorAt(ctx, box, y);

    const platformBefore = of(r, "platform");
    assert.equal(platformBefore.nodes.length, 4);

    // Record terrain under the suspended part before move
    const terrainBefore = terrain(r);
    const keyOf = (t) => t.surfaceKey.join(" ");
    const underSuspended = (t) => {
      const cx = t.nodes.reduce((s, n) => s + n.position.x, 0) / t.nodes.length;
      const cz = t.nodes.reduce((s, n) => s + n.position.z, 0) / t.nodes.length;
      // Wholly clear of where it rested: a face reaching the cut line is laid
      // again when the floor leaves, wherever its middle falls.
      return cx >= -1.3 && cx <= 2.0 && cz >= -2.3 && cz <= 2.3 && t.nodes.every((n) => n.position.x <= 2.0);
    };
    const suspendedTerrainBefore = new Set(terrainBefore.filter(underSuspended).map(keyOf));
    assert.ok(suspendedTerrainBefore.size > 0, "some ground stands wholly under the suspended part to begin with");

    // Now move the platform by +10 in X (out of the hill completely)
    const handle = shownGlobalHandles({
      graph: r.getGraphSnapshot(),
      topologies: r.getAllRegionTopologies(),
      cloudFor: (q) => r.cloudFor(q),
    }).find((h) => h.kind === "pivot");
    assert.ok(handle, "pivot handle found");

    const params = platformContourTool.defaultParams();
    const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
    const current = { point: { ...handle.position, x: handle.position.x + 10 }, screenX: 400, screenY: 300 };
    platformContourTool.onPointerDown(ctx, start, params);
    platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
    platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);

    const platformAfter = of(r, "platform");
    assert.equal(platformAfter.nodes.length, 4);

    const terrainAfter = terrain(r);
    const suspendedTerrainAfter = new Set(terrainAfter.filter(underSuspended).map(keyOf));

    const touchedUnderSuspended = [...suspendedTerrainAfter].filter((k) => !suspendedTerrainBefore.has(k));
    const removedUnderSuspended = [...suspendedTerrainBefore].filter((k) => !suspendedTerrainAfter.has(k));
    assert.equal(touchedUnderSuspended.length, 0, "No new faces created under suspended part");
    assert.equal(removedUnderSuspended.length, 0, "No faces removed under suspended part");
  } finally {
    session.free();
  }
});

test("simplifying collinear vertices on platform via remove-vertex", async () => {
  const { runtime: r, ctx, session } = setup(() => 0);
  try {
    const y = 5;
    floorAt(ctx, [0, 0, 4, 4], y);
    const before = of(r, "platform");
    assert.equal(before.nodes.length, 4);

    // Insert an intermediate vertex on edge 0: (0, 0) -> (4, 0) with a point at (2, 0)
    const edge = before.outerLoops[0][0];
    r.applyRegionEdit([{
      kind: "insert-vertex",
      edgeId: edge.edgeId,
      nodeId: "v:mid",
      position: { x: 2, y, z: 0 },
      firstEdgeId: "e:first",
      secondEdgeId: "e:second",
    }], "local", "test:insert");

    const withMid = of(r, "platform");
    assert.equal(withMid.nodes.length, 5);

    // Now remove the vertex via remove-vertex op
    r.applyRegionEdit([{
      kind: "remove-vertex",
      nodeId: "v:mid",
      weldedEdgeId: "e:welded",
    }], "local", "test:remove");

    const afterRemove = of(r, "platform");
    assert.equal(afterRemove.nodes.length, 4);

    // Now insert 3 collinear vertices along edge 0: (0, 0) -> (4, 0)
    const e0 = afterRemove.outerLoops[0][0];
    r.applyRegionEdit([{
      kind: "insert-vertex",
      edgeId: e0.edgeId,
      nodeId: "v:c1",
      position: { x: 1, y, z: 0 },
      firstEdgeId: "e:a1",
      secondEdgeId: "e:b1",
    }], "local", "test:insert1");
    r.applyRegionEdit([{
      kind: "insert-vertex",
      edgeId: "e:b1",
      nodeId: "v:c2",
      position: { x: 2, y, z: 0 },
      firstEdgeId: "e:a2",
      secondEdgeId: "e:b2",
    }], "local", "test:insert2");
    r.applyRegionEdit([{
      kind: "insert-vertex",
      edgeId: "e:b2",
      nodeId: "v:c3",
      position: { x: 3, y, z: 0 },
      firstEdgeId: "e:a3",
      secondEdgeId: "e:b3",
    }], "local", "test:insert3");

    const with3 = of(r, "platform");
    assert.equal(with3.nodes.length, 7);

    // Remove c1, c2, c3 sequentially
    r.applyRegionEdit([{ kind: "remove-vertex", nodeId: "v:c1", weldedEdgeId: "e:w1" }], "local", "test:r1");
    r.applyRegionEdit([{ kind: "remove-vertex", nodeId: "v:c2", weldedEdgeId: "e:w2" }], "local", "test:r2");
    r.applyRegionEdit([{ kind: "remove-vertex", nodeId: "v:c3", weldedEdgeId: "e:w3" }], "local", "test:r3");

    const clean = of(r, "platform");
    assert.equal(clean.nodes.length, 4);
  } finally {
    session.free();
  }
});

test("automatic collinear vertex simplification on platform move", async () => {
  const { runtime: r, ctx, session } = setup(() => 0);
  try {
    const y = 5;
    floorAt(ctx, [0, 0, 4, 4], y);
    const before = of(r, "platform");
    assert.equal(before.nodes.length, 4);

    // Artificially insert 2 extra vertices on one straight edge
    const e0 = before.outerLoops[0][0];
    r.applyRegionEdit([{
      kind: "insert-vertex",
      edgeId: e0.edgeId,
      nodeId: "v:extra1",
      position: { x: 1, y, z: 0 },
      firstEdgeId: "e:x1",
      secondEdgeId: "e:x2",
    }], "local", "setup:extra1");
    r.applyRegionEdit([{
      kind: "insert-vertex",
      edgeId: "e:x2",
      nodeId: "v:extra2",
      position: { x: 2, y, z: 0 },
      firstEdgeId: "e:x3",
      secondEdgeId: "e:x4",
    }], "local", "setup:extra2");

    const withExtra = of(r, "platform");
    assert.equal(withExtra.nodes.length, 6);

    // Now move the platform via pivot handle
    const handle = shownGlobalHandles({
      graph: r.getGraphSnapshot(),
      topologies: r.getAllRegionTopologies(),
      cloudFor: (q) => r.cloudFor(q),
    }).find((h) => h.kind === "pivot");
    assert.ok(handle, "pivot handle found");

    const params = platformContourTool.defaultParams();
    const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
    const current = { point: { ...handle.position, x: handle.position.x + 2 }, screenX: 200, screenY: 300 };
    platformContourTool.onPointerDown(ctx, start, params);
    platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
    platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);

    const afterMove = of(r, "platform");
    assert.equal(afterMove.nodes.length, 4, "Platform collinear vertices were automatically cleaned up on move");
  } finally {
    session.free();
  }
});

// The ground it stood clear of is uncovered by the move, and lies inside the
// stroke the repair lays fresh round where it stood -- a stroke wide enough
// that its rim falls on ground no earlier repair touched, which is what keeps
// repeated edits from piling faces up. So that ground may come back as a new
// mesh; what it may not do is move: it stays covered, at the height it had,
// never drawn up to the floor it stood clear of.
test("platform half in hill, moved slightly (overlapping): the ground it stood clear of stays where it was", async () => {
  const hill = (x, z) => Math.max(0, 8 - 0.35 * ((x - 6) ** 2 + z * z));
  const { runtime: r, ctx, session } = setup(hill);
  try {
    const y = 5.6;
    const box = [-1.3, -2.3, 5.3, 2.3];
    floorAt(ctx, box, y);

    const terrainBefore = terrain(r);
    const keyOf = (t) => t.surfaceKey.join(" ");
    const underSuspended = (t) => {
      const cx = t.nodes.reduce((s, n) => s + n.position.x, 0) / t.nodes.length;
      const cz = t.nodes.reduce((s, n) => s + n.position.z, 0) / t.nodes.length;
      // The region under the old suspended part that remains suspended even after move (+2.0 in X),
      // wholly clear of where it rested.
      return cx >= -1.3 && cx <= 0.7 && cz >= -2.3 && cz <= 2.3 && t.nodes.every((n) => n.position.x <= 0.7);
    };
    const suspendedTerrainBefore = new Set(terrainBefore.filter(underSuspended).map(keyOf));
    assert.ok(suspendedTerrainBefore.size > 0, "some ground stands wholly under the suspended part to begin with");
    const window = [];
    for (let x = -1.2; x <= 0.6; x += 0.3) for (let z = -2.2; z <= 2.2; z += 0.4) window.push({ x, z });
    const heightBefore = groundSurfaceOf(terrainBefore, new Set());

    // Now move the platform slightly by +2 in X (still overlapping the hill and old location)
    const handle = shownGlobalHandles({
      graph: r.getGraphSnapshot(),
      topologies: r.getAllRegionTopologies(),
      cloudFor: (q) => r.cloudFor(q),
    }).find((h) => h.kind === "pivot");
    assert.ok(handle, "pivot handle found");

    const params = platformContourTool.defaultParams();
    const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
    const current = { point: { ...handle.position, x: handle.position.x + 2 }, screenX: 200, screenY: 300 };
    platformContourTool.onPointerDown(ctx, start, params);
    platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
    platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);

    const terrainAfter = terrain(r);
    const heightAfter = groundSurfaceOf(terrainAfter, new Set());
    for (const point of window) {
      assert.ok(terrainAfter.some((t) => insideFace(t, point)), `ground still covers ${point.x.toFixed(1)},${point.z.toFixed(1)}`);
      const was = heightBefore(point), now = heightAfter(point);
      assert.ok(was !== undefined && now !== undefined && Math.abs(now - was) < 0.25, `and lies where it lay at ${point.x.toFixed(1)},${point.z.toFixed(1)}: ${was} -> ${now}`);
    }
  } finally {
    session.free();
  }
});
