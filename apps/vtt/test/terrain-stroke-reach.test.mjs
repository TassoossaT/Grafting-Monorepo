import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { DEFAULT_TOOL_PARAMS, hasTrait } from "../src/features/edit-construction/index.ts";

/**
 * What one stroke of the terrain brush reads and hands the engine, on a map
 * of hills: only the ground beside the faces it lays again, never the map
 * round it. Read 4 faces past the stroke, a small stroke handed the engine
 * three to seven times the faces it laid, and every stroke cost more the
 * bigger the map.
 */

function setup() {
  const fixture = sessionFixture();
  const { runtime, session } = fixture;
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  runtime.getSnapshot = () => ({
    tableId: "t",
    map: { nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [n.id, { position: { x: n.position[0], y: n.position[1], z: n.position[2] } }])) },
  });
  return fixture;
}

const quiet = (work) => {
  const info = console.info, warn = console.warn, error = console.error;
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  try { return work(); } finally { console.info = info; console.warn = warn; console.error = error; }
};

/** The ground's triangles, each face fanned from its first corner. */
function groundTriangles(runtime) {
  return runtime.getAllRegionTopologies().filter((t) => hasTrait(t.surfaceType, "ground")).flatMap((t) => {
    const ring = t.outerLoops[0].map((use) => t.nodes.find((n) => n.id === use.startNodeId).position);
    return ring.slice(1, -1).map((_, k) => [ring[0], ring[k + 1], ring[k + 2]]);
  });
}

/** Where a ray from `origin` toward `toward` first meets the ground, as the pointer gives it: the face's normal and the ray; `undefined` past it. */
function pointerAt(runtime, origin, toward) {
  const d = toward.map((v, i) => v - origin[i]), length = Math.hypot(...d), dir = d.map((v) => v / length);
  let best;
  for (const [a, b, c] of groundTriangles(runtime)) {
    const e1 = [b.x - a.x, b.y - a.y, b.z - a.z], e2 = [c.x - a.x, c.y - a.y, c.z - a.z];
    const p = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const s = [origin[0] - a.x, origin[1] - a.y, origin[2] - a.z];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (t > 0 && (!best || t < best.t)) best = { t, normal: { x: e1[1] * e2[2] - e1[2] * e2[1], y: e1[2] * e2[0] - e1[0] * e2[2], z: e1[0] * e2[1] - e1[1] * e2[0] } };
  }
  if (!best) return undefined;
  const point = { x: origin[0] + dir[0] * best.t, y: origin[1] + dir[1] * best.t, z: origin[2] + dir[2] * best.t };
  return { point, face: { normal: best.normal, centre: point }, ray: { origin: { x: origin[0], y: origin[1], z: origin[2] }, direction: { x: dir[0], y: dir[1], z: dir[2] } } };
}

function sculpt({ ctx, calls }, samples, params) {
  quiet(() => terrainSculptTool.onPointerUp(ctx, { start: samples[0], current: samples.at(-1), samples }, { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], ...params }));
  const feedback = calls.feedback.at(-1);
  assert.equal(feedback?.tone, "success", JSON.stringify(feedback));
}

test("a stroke hands the engine only the ground beside the faces it lays again", () => {
  const fixture = setup();
  const { runtime } = fixture;
  try {
    for (const [x, z, r, h] of [[0, 0, 8, 4], [12, 6, 6, 5], [-10, 8, 7, 3], [6, -12, 6, 6], [-12, -10, 8, 4], [18, -6, 5, 3], [-4, 16, 6, 5]]) sculpt(fixture, [{ point: { x, y: 0, z } }], { mode: "add", brushRadius: r, elevationStep: h });
    const asked = [];
    const inner = runtime.layerTerrainSurface.bind(runtime);
    runtime.layerTerrainSurface = (request) => {
      asked.push({ patch: request.patch.faces.length, context: request.context.faces.length });
      return inner(request);
    };
    for (const [x, z, mode] of [[0, 0, "add"], [3, 2, "add"], [12, 6, "dig"], [-10, 8, "smooth"], [6, -12, "add"], [-2, -3, "flatten"], [1, 1, "add"], [10, 4, "noise"]]) {
      asked.length = 0;
      sculpt(fixture, [pointerAt(runtime, [x + 3, 30, z + 4], [x, 0, z])], { mode, brushRadius: 4, elevationStep: 2 });
      assert.equal(asked.length, 1, `${mode}: one engine call`);
      const [{ patch, context }] = asked;
      assert.ok(context <= patch, `${mode} at ${x},${z}: ${context} faces of ground round ${patch} laid again`);
    }
  } finally { fixture.session.free(); }
});
