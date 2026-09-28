import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { shownGlobalHandles } from "../src/features/edit-construction/index.ts";

/**
 * The ground is cut only where a structure touches it -- against the real
 * engine, on a bowl of terrain rising away from the middle. A floor high over
 * it leaves it whole; one on the bowl's side cuts only where it runs into
 * it, the ground passing under the rest; one lifted off it lets the ground
 * heal; a ramp run into the ground is cut round without losing a corner.
 */

function bowl(runtime, session) {
  runtime.getSnapshot = () => ({
    tableId: "t",
    map: { nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [n.id, { position: { x: n.position[0], y: n.position[1], z: n.position[2] } }])) },
  });
  const cell = 2, cells = 10, id = (i, j) => `g:${i}:${j}`, nodes = [];
  for (let i = 0; i <= cells; i++) for (let j = 0; j <= cells; j++) {
    const x = -10 + i * cell, z = -10 + j * cell;
    nodes.push({ id: id(i, j), position: { x, y: 0.04 * (x * x + z * z), z } });
  }
  const edges = new Map();
  const use = (a, b) => {
    const key = a < b ? `${a}~${b}` : `${b}~${a}`;
    if (!edges.has(key)) edges.set(key, { edgeId: `e:${key}`, startNodeId: a < b ? a : b, endNodeId: a < b ? b : a });
    return { edgeId: edges.get(key).edgeId, reversed: edges.get(key).startNodeId !== a };
  };
  const regions = [];
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    const ring = [id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)];
    regions.push({ regionId: `q:${i}:${j}`, boundary: ring.map((a, n) => use(a, ring[(n + 1) % 4])), surfaceType: "terrain", physical: true });
  }
  runtime.addPatch({ nodes, edges: [...edges.values()], regions });
}

function setup() {
  const fixture = sessionFixture();
  Object.assign(fixture.runtime, { showPreview() {}, clearPreview() {} });
  bowl(fixture.runtime, fixture.session);
  return fixture;
}
const quiet = (body) => async () => {
  const info = console.info, warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try { await body(); } finally { console.info = info; console.warn = warn; }
};
const floorAt = (ctx, [x0, z0, x1, z1], y) =>
  commitPlatformContour(ctx, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => ({ point: { x, y, z } })), { mode: "create", elevation: y, shape: "rectangle" });
const terrain = (runtime) => runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "terrain");
const of = (runtime, type) => runtime.getAllRegionTopologies().find((t) => t.surfaceType === type);
/** Ground faces holding any of `face`'s nodes. */
const groundHolding = (runtime, face) => {
  const ids = new Set(face.nodes.map((n) => n.id));
  return terrain(runtime).filter((t) => t.nodes.some((n) => ids.has(n.id)));
};
/** Whether some ground face stands with its middle inside the box, in plan. */
const groundUnder = (runtime, [x0, z0, x1, z1]) => terrain(runtime).some((t) => {
  const x = t.nodes.reduce((s, n) => s + n.position.x, 0) / t.nodes.length, z = t.nodes.reduce((s, n) => s + n.position.z, 0) / t.nodes.length;
  return x > x0 && x < x1 && z > z0 && z < z1;
});

test("a floor built high over the ground leaves the ground exactly as it was", quiet(() => {
  const { runtime, ctx, calls, session } = setup();
  try {
    const before = terrain(runtime).map((t) => t.surfaceKey.join("|")).sort();
    floorAt(ctx, [-3, -2, 2, 3], 5);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    assert.deepEqual(terrain(runtime).map((t) => t.surfaceKey.join("|")).sort(), before, "not one ground face touched");
    assert.equal(groundHolding(runtime, of(runtime, "platform")).length, 0);
  } finally { session.free(); }
}));

test("a floor on the bowl's side cuts the ground only where it runs into it; the ground passes under the rest", quiet(() => {
  const { runtime, ctx, calls, session } = setup();
  try {
    // At 1 m: clear of the ground near x = -2.3, run into it past x = 5 -- off the ground's own grid lines.
    floorAt(ctx, [-2.3, -1.3, 6.7, 1.3], 1);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const floor = of(runtime, "platform");
    const held = new Set(groundHolding(runtime, floor).flatMap((t) => t.nodes.map((n) => n.id)));
    const joined = floor.nodes.filter((n) => held.has(n.id));
    assert.ok(joined.length >= 2, "the ground is joined to it where it runs into it");
    assert.ok(joined.every((n) => n.position.x > 3), `and only there: ${JSON.stringify(joined.map((n) => n.position))}`);
    assert.ok(groundUnder(runtime, [-2.3, -1.3, 3, 1.3]), "the ground still stands under the part clear of it");
    assert.ok(!groundUnder(runtime, [5.5, -1.1, 6.7, 1.1]), "and none where it runs into it");
  } finally { session.free(); }
}));

test("a floor on the ground lifted off it by its height handle lets the ground heal under it", quiet(() => {
  const { runtime, ctx, calls, session } = setup();
  try {
    floorAt(ctx, [-3, -2, 2, 3], 0.3);
    assert.ok(groundHolding(runtime, of(runtime, "platform")).length > 0, "cut into the ground to begin with");
    assert.ok(!groundUnder(runtime, [-2.5, -1.5, 1.5, 2.5]));
    const handle = shownGlobalHandles({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (q) => runtime.cloudFor(q) }).find((h) => h.kind === "height");
    const params = platformContourTool.defaultParams();
    const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
    const current = { point: handle.position, screenX: 100, screenY: 300 - 4 * 40 };
    platformContourTool.onPointerDown(ctx, start, params);
    platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
    platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const floor = of(runtime, "platform");
    assert.ok(floor.nodes.every((n) => n.position.y > 4), "lifted");
    assert.equal(groundHolding(runtime, floor).length, 0, "the ground let go of it");
    assert.ok(groundUnder(runtime, [-2.5, -1.5, 1.5, 2.5]), "and healed under it");
  } finally { session.free(); }
}));

test("a ramp run into the ground is cut round where it touches it, keeps its four corners, and the ground passes under its raised end", quiet(async () => {
  const { slopeRampTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { runtime, ctx, calls, session } = setup();
  try {
    // From the bowl's bottom, climbing 3 m over 6: its foot on the ground, its top well clear of it.
    const s = { point: { x: -3, y: 0.36, z: 0 } }, e = { point: { x: 3, y: 0.36, z: 0 } };
    slopeRampTool.onPointerUp(ctx, { start: s, current: e, samples: [s, e] }, { bottomWidth: 2, topWidth: 2, rise: 3 });
    assert.notEqual(calls.feedback.at(-1)?.tone, "error", JSON.stringify(calls.feedback.at(-1)));
    const ramp = of(runtime, "platform-ramp");
    assert.equal(ramp.nodes.length, 4, "its four corners and nothing else");
    const foot = ramp.nodes.filter((n) => n.position.y < 1);
    const meets = (p) => terrain(runtime).some((t) => t.nodes.some((n) => Math.hypot(n.position.x - p.x, n.position.y - p.y, n.position.z - p.z) < 1e-3));
    assert.ok(foot.length === 2 && foot.every((n) => meets(n.position)), "the ground comes up to its foot");
    assert.ok(groundUnder(runtime, [1, -0.8, 3, 0.8]), "and runs on under its raised end");
  } finally { session.free(); }
}));
