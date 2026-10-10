import test from "node:test";
import assert from "node:assert/strict";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { shownGlobalHandles, insideFace } from "../src/features/edit-construction/index.ts";
const hillAt = (cz) => (x, z) => Math.max(0, 8 - 0.35 * ((x - 6) ** 2 + (z - cz) ** 2));
const H = (x, z) => Math.max(hillAt(-8)(x, z), hillAt(8)(x, z));
function ground(runtime, session) {
  runtime.getSnapshot = () => ({ tableId: "t", map: { nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [n.id, { position: { x: n.position[0], y: n.position[1], z: n.position[2] } }])) } });
  const cell = 2, cells = 16, id = (i, j) => `g:${i}:${j}`, nodes = [];
  for (let i = 0; i <= cells; i++) for (let j = 0; j <= cells; j++) { const x = -12 + i * cell, z = -16 + j * cell; nodes.push({ id: id(i, j), position: { x, y: H(x, z), z } }); }
  const edges = new Map();
  const use = (a, b) => { const key = a < b ? `${a}~${b}` : `${b}~${a}`; if (!edges.has(key)) edges.set(key, { edgeId: `e:${key}`, startNodeId: a < b ? a : b, endNodeId: a < b ? b : a }); return { edgeId: edges.get(key).edgeId, reversed: edges.get(key).startNodeId !== a }; };
  const regions = [];
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) { const ring = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]; regions.push({ regionId: `q:${i}:${j}`, boundary: ring.map((a, n) => use(a, ring[(n + 1) % 4])), surfaceType: "terrain", physical: true }); }
  runtime.addPatch({ nodes, edges: [...edges.values()], regions });
}
const Y = 5.6;
const rect = (cz) => [[-1.3, cz - 2.3], [5.3, cz - 2.3], [5.3, cz + 2.3], [-1.3, cz + 2.3]].map(([x, z]) => ({ point: { x, y: Y, z } }));
const inside = (topology, x, z) => insideFace(topology, { x, z });
/** The top of `faces` over a point of the plane, read off their own corners. */
const heightOn = (faces) => ({ x, z }) => {
  let top = -Infinity;
  for (const t of faces) {
    const ring = t.outerLoops[0].map((use) => t.nodes.find((n) => n.id === use.startNodeId).position);
    for (let k = 1; k + 1 < ring.length; k++) {
      const [a, b, c] = [ring[0], ring[k], ring[k + 1]];
      const d = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((b.x - x) * (c.z - z) - (c.x - x) * (b.z - z)) / d, v = ((c.x - x) * (a.z - z) - (a.x - x) * (c.z - z)) / d, w = 1 - u - v;
      if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9) top = Math.max(top, u * a.y + v * b.y + w * c.y);
    }
  }
  return top;
};

for (const moved of [false, true]) {
  test(`a platform half inside a hill has the hill brought down to rest under it when ${moved ? "moved there" : "created there"}`, () => {
    const { runtime, ctx, session, calls } = sessionFixture();
    Object.assign(runtime, { showPreview() {}, clearPreview() {} });
    try {
      ground(runtime, session);
      const originalHeight = heightOn(runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "terrain"));
      commitPlatformContour(ctx, rect(moved ? -8 : 8), { mode: "create", elevation: Y, shape: "rectangle" });
      if (moved) {
        const handle = shownGlobalHandles({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (q) => runtime.cloudFor(q) }).find((h) => h.kind === "pivot");
        assert.ok(handle);
        const params = platformContourTool.defaultParams();
        const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
        const current = { point: { ...handle.position, z: handle.position.z + 16 }, screenX: 100, screenY: 600 };
        platformContourTool.onPointerDown(ctx, start, params);
        platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
        platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
        assert.equal(calls.feedback.at(-1)?.tone, "success");
      }
      const terrain = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "terrain");
      const platform = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform");
      assert.ok(platform);
      assert.ok(Math.abs(Math.min(...platform.nodes.map((n) => n.position.z)) - 5.7) < 1e-6);
      // Where the hill rose through it, every corner of the ground is brought
      // down to just under it; under the part clear of it, the hill's corners
      // stay on the hill as it was. The original mesh, not its parabola.
      const under = (x, z) => x > -1.3 && x < 5.3 && Math.abs(z - 8) < 2.3;
      for (const { position: { x, y, z } } of terrain.flatMap((t) => t.nodes)) {
        if (!under(x, z)) continue;
        const was = originalHeight({ x, z });
        if (was > Y) assert.ok(Math.abs(y - (Y - 0.08)) < 0.05, `the hill brought down to just under it at ${x},${z}: ${y}`);
        if (was < Y - 2.5) assert.ok(Math.abs(y - was) < 0.02, `the ground under the clear part as it was at ${x},${z}: ${y} for ${was}`);
      }
      // Never through it, never a hole -- under it or round it.
      for (let x = -11.9; x < 20; x += 0.5) {
        for (let z = -15.9; z < 16; z += 0.5) {
          const holding = terrain.filter((t) => inside(t, x, z));
          assert.ok(holding.length > 0, `ground is missing at ${x},${z}`);
        }
      }
    } finally {
      session.free();
    }
  });
}
