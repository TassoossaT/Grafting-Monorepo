import test from "node:test";
import assert from "node:assert/strict";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { shownGlobalHandles, groundSurfaceOf, insideFace } from "../src/features/edit-construction/index.ts";
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

for (const moved of [false, true]) {
  test(`a platform half inside a hill keeps its cut clear when ${moved ? "moved there" : "created there"}`, () => {
    const { runtime, ctx, session, calls } = sessionFixture();
    Object.assign(runtime, { showPreview() {}, clearPreview() {} });
    try {
      ground(runtime, session);
      const originalHeight = groundSurfaceOf(runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "terrain"), new Set());
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
      // These points were covered by a reconstructed quad reaching up to the
      // hill's 8 m peak. Checking nodes alone misses the crossing face.
      for (const dz of [-1.73, 1.77]) {
        assert.ok(!terrain.some((t) => inside(t, 5.27, 8 + dz)), "a ground face crosses the east cut");
      }
      // Read the original mesh, not its generating parabola: between nodes
      // they have different heights, including at the platform's corners.
      for (let x = -1.23; x < 5.3; x += 0.25) {
        for (let z = 5.77; z < 10.3; z += 0.25) {
          const y = originalHeight({ x, z });
          const covered = terrain.some((t) => inside(t, x, z));
          if (y > Y + 0.3) assert.ok(!covered, `ground remains in the cut at ${x},${z}`);
          if (y < Y - 0.6) assert.ok(covered, `ground under the clear part is missing at ${x},${z}`);
        }
      }
      for (let x = -11.9; x < 20; x += 0.5) {
        for (let z = -15.9; z < 16; z += 0.5) {
          if (x > -1.3 && x < 5.3 && Math.abs(z - 8) < 2.3) continue;
          assert.ok(terrain.some((t) => inside(t, x, z)), `ground outside the platform is missing at ${x},${z}`);
        }
      }
    } finally {
      session.free();
    }
  });
}
