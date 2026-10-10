import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { commitPlatformContour, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { DEFAULT_TOOL_PARAMS, hasTrait, shownGlobalHandles } from "../src/features/edit-construction/index.ts";

/**
 * Ground in layers -- a tunnel's floor under its ceiling -- edited against the
 * real engine (note 0012): what is done on one layer never touches the other,
 * and the ground stays one mesh.
 *
 * `PROBE=1` prints what each step left.
 */

const probe = process.env.PROBE === "1" ? (...line) => console.log(...line) : () => {};
const hill = (x, z) => 6 * Math.exp(-(x * x + z * z) / 98);

function setup() {
  const fixture = sessionFixture();
  const { runtime, session } = fixture;
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  runtime.getSnapshot = () => ({
    tableId: "t",
    map: { nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [n.id, { position: { x: n.position[0], y: n.position[1], z: n.position[2] } }])) },
  });
  const cell = 2, cells = 20, origin = -20, id = (i, j) => `g:${i}:${j}`, nodes = [];
  for (let i = 0; i <= cells; i++) for (let j = 0; j <= cells; j++) {
    const x = origin + i * cell, z = origin + j * cell;
    nodes.push({ id: id(i, j), position: { x, y: hill(x, z), z } });
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
  return fixture;
}

const quiet = (work) => {
  const info = console.info, warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try { return work(); } finally { console.info = info; console.warn = warn; }
};

function stroke(ctx, from, to, params) {
  const n = Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.5);
  const samples = Array.from({ length: n + 1 }, (_, i) => {
    const x = from[0] + ((to[0] - from[0]) * i) / n, z = from[1] + ((to[1] - from[1]) * i) / n;
    return { point: { x, y: hill(x, z), z }, screenX: i * 10, screenY: 0 };
  });
  quiet(() => terrainSculptTool.onPointerUp(ctx, { start: samples[0], current: samples.at(-1), samples }, { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], ...params }));
}

const groundOf = (runtime) => runtime.getAllRegionTopologies().filter((t) => hasTrait(t.surfaceType, "ground"));
const centre = (t) => t.nodes.reduce((s, n) => ({ x: s.x + n.position.x / t.nodes.length, y: s.y + n.position.y / t.nodes.length, z: s.z + n.position.z / t.nodes.length }), { x: 0, y: 0, z: 0 });

/** One mesh: no edge held by three faces. */
function thrice(runtime) {
  const uses = new Map();
  for (const t of groundOf(runtime)) for (const use of t.outerLoops.flat()) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
  return [...uses.values()].filter((n) => n > 2).length;
}

/** A tunnel through the hill, and the faces of its ceiling and of its floor over the middle. */
function tunnel(runtime, ctx, calls) {
  stroke(ctx, [-16, 0], [16, 0], { mode: "carve", brushRadius: 1.8, faceSize: 2 });
  assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
  const middle = groundOf(runtime).filter((t) => { const c = centre(t); return Math.abs(c.x) < 3 && Math.abs(c.z) < 1.2; });
  const floor = Math.min(...middle.map((t) => centre(t).y));
  const ceiling = middle.filter((t) => centre(t).y > floor + 2);
  return { floor, ceiling: new Set(ceiling.map((t) => t.surfaceKey.join(" "))) };
}

test("a floor laid on a tunnel's floor cuts the floor round it and leaves the ceiling over it alone", () => {
  const { runtime, ctx, calls, session } = setup();
  try {
    const { floor, ceiling } = tunnel(runtime, ctx, calls);
    probe("tunnel floor", floor.toFixed(2), "ceiling faces over the middle", ceiling.size);
    assert.ok(ceiling.size > 0, "the tunnel has a ceiling over its middle");
    const y = floor + 0.1;
    quiet(() => commitPlatformContour(ctx, [[-1, -0.6], [1, -0.6], [1, 0.6], [-1, 0.6]].map(([x, z]) => ({ point: { x, y, z } })), { mode: "create", elevation: y, shape: "rectangle" }));
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const now = new Set(groundOf(runtime).map((t) => t.surfaceKey.join(" ")));
    const kept = [...ceiling].filter((key) => now.has(key)).length;
    probe("ceiling faces kept", kept, "of", ceiling.size, "thrice", thrice(runtime));
    assert.equal(kept, ceiling.size, "every face of the ceiling stands as it was");
    assert.equal(thrice(runtime), 0, "one mesh");
  } finally { session.free(); }
});

test("a floor moved along a tunnel's floor never touches the ceiling", () => {
  const { runtime, ctx, calls, session } = setup();
  try {
    const { floor, ceiling } = tunnel(runtime, ctx, calls);
    const y = floor + 0.1;
    quiet(() => commitPlatformContour(ctx, [[-1, -0.6], [1, -0.6], [1, 0.6], [-1, 0.6]].map(([x, z]) => ({ point: { x, y, z } })), { mode: "create", elevation: y, shape: "rectangle" }));
    const handle = shownGlobalHandles({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (q) => runtime.cloudFor(q) }).find((h) => h.kind === "pivot");
    assert.ok(handle, "the floor's move handle");
    const params = platformContourTool.defaultParams();
    const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
    const current = { point: { ...handle.position, x: handle.position.x + 1.5 }, screenX: 160, screenY: 300 };
    quiet(() => {
      platformContourTool.onPointerDown(ctx, start, params);
      platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
      platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
    });
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const now = new Set(groundOf(runtime).map((t) => t.surfaceKey.join(" ")));
    const kept = [...ceiling].filter((key) => now.has(key)).length;
    probe("after the move: ceiling faces kept", kept, "of", ceiling.size, "thrice", thrice(runtime));
    assert.equal(kept, ceiling.size, "every face of the ceiling stands as it was");
    assert.equal(thrice(runtime), 0, "one mesh");
  } finally { session.free(); }
});

test("a layer of earth laid along a tunnel's floor raises the floor and never the ceiling", () => {
  const { runtime, ctx, calls, session } = setup();
  try {
    const { floor, ceiling } = tunnel(runtime, ctx, calls);
    const samples = Array.from({ length: 9 }, (_, i) => ({ point: { x: -2 + i * 0.5, y: floor, z: 0 }, screenX: i * 10, screenY: 0 }));
    quiet(() => terrainSculptTool.onPointerUp(ctx, { start: samples[0], current: samples.at(-1), samples }, { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "add", brushRadius: 1, elevationStep: 0.5 }));
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const now = new Set(groundOf(runtime).map((t) => t.surfaceKey.join(" ")));
    const kept = [...ceiling].filter((key) => now.has(key)).length;
    probe("after the layer: ceiling faces kept", kept, "of", ceiling.size, "thrice", thrice(runtime));
    assert.equal(kept, ceiling.size, "every face of the ceiling stands as it was");
    assert.equal(thrice(runtime), 0, "one mesh");
  } finally { session.free(); }
});
