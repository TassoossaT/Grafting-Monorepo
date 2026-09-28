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

function bowl(runtime, session, heightAt = (x, z) => 0.04 * (x * x + z * z)) {
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
    // Counter-clockwise in plan, as the ground the generator lays winds: a seam against the other way refuses every cell.
    const ring = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)];
    regions.push({ regionId: `q:${i}:${j}`, boundary: ring.map((a, n) => use(a, ring[(n + 1) % 4])), surfaceType: "terrain", physical: true });
  }
  runtime.addPatch({ nodes, edges: [...edges.values()], regions });
}

function setup(heightAt) {
  const fixture = sessionFixture();
  Object.assign(fixture.runtime, { showPreview() {}, clearPreview() {} });
  bowl(fixture.runtime, fixture.session, heightAt);
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

test("a floor on the bowl's side cuts the ground only where the ground rises through it; the ground passes under the rest", quiet(() => {
  const { runtime, ctx, calls, session } = setup();
  try {
    // At 3 m: well clear of the ground near x = -2.3; the bowl's wall rises through it past x = 8.7 -- off the ground's own grid lines.
    floorAt(ctx, [-2.3, -1.3, 9.3, 1.3], 3);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const floor = of(runtime, "platform");
    const held = new Set(groundHolding(runtime, floor).flatMap((t) => t.nodes.map((n) => n.id)));
    const joined = floor.nodes.filter((n) => held.has(n.id));
    assert.ok(joined.length >= 2, "the ground is joined to it where it runs into it");
    assert.ok(joined.every((n) => n.position.x > 8), `and only there: ${JSON.stringify(joined.map((n) => n.position))}`);
    assert.ok(groundUnder(runtime, [-2.3, -1.3, 7, 1.3]), "the ground still stands under the part clear of it, however near it comes");
    assert.ok(!groundUnder(runtime, [8.9, -1.1, 9.3, 1.1]), "and none where it rises through it");
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

test("a floor drawn on uneven ground, a little above or below it here and there, rests on it all round: the ground meets every side and none is left under it", quiet(() => {
  const wavy = (x, z) => 0.5 * (Math.sin(x * 0.9) + Math.cos(z * 1.3));
  // Within the reach everywhere: the lowest trough under it is at most 1.5 m down.
  for (const y of [-0.3, 0.2, 0.5]) {
    const { runtime, ctx, calls, session } = setup(wavy);
    try {
      floorAt(ctx, [-2.3, -1.7, 3.7, 2.3], y);
      assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
      const floor = of(runtime, "platform");
      const held = new Set(groundHolding(runtime, floor).flatMap((t) => t.nodes.map((n) => n.id)));
      const sides = floor.outerLoops[0];
      assert.ok(sides.every((use) => held.has(use.startNodeId) && held.has(use.endNodeId)), `at ${y}: the ground meets every side`);
      assert.ok(!groundUnder(runtime, [-2.3, -1.7, 3.7, 2.3]), `at ${y}: none left under it`);
    } finally { session.free(); }
  }
}));

/** A plateau at 0 that drops 3 m into a valley past x = 1..3 -- where a bridge leaves the ground. */
const cliff = (x) => (x < 1 ? 0 : x > 3 ? -3 : -1.5 * (x - 1));
const insidePlan = (t, x, z) => {
  const ring = t.outerLoops[0].map((use) => t.nodes.find((n) => n.id === use.startNodeId).position);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
/** Points with no ground over them, sampled off the ground's grid lines, but where `rests` says a structure takes the ground. */
const holesIn = (runtime, rests) => {
  const ground = terrain(runtime), holes = [];
  for (let x = -9.37; x < 10; x += 0.5) for (let z = -9.37; z < 10; z += 0.5) {
    if (!rests(x, z) && !ground.some((t) => insidePlan(t, x, z))) holes.push([+x.toFixed(2), +z.toFixed(2)]);
  }
  return holes;
};

test("a floor half on the plateau, half out over the valley -- a bridge leaving the ground -- leaves no hole in the ground, and its far end is not joined to it", quiet(() => {
  const { runtime, ctx, calls, session } = setup((x) => cliff(x));
  try {
    floorAt(ctx, [-4.3, -1.7, 6.7, 2.3], 0);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    // The floor rests where it is within 1.5 m of the ground: up to x = 2.
    const holes = holesIn(runtime, (x, z) => x > -4.3 && x < 2.3 && z > -1.7 && z < 2.3);
    assert.deepEqual(holes, [], "the ground stands everywhere the floor does not rest, under its raised end too");
    const floor = of(runtime, "platform");
    const held = new Set(groundHolding(runtime, floor).flatMap((t) => t.nodes.map((n) => n.id)));
    assert.ok(floor.nodes.filter((n) => n.position.x > 4).every((n) => !held.has(n.id)), "its end over the valley is joined to no ground");
  } finally { session.free(); }
}));

test("a floor moved step by step out over the valley leaves no hole where it stood, and the ground lets go of the end that went out over the drop", quiet(() => {
  const { runtime, ctx, calls, session } = setup((x) => cliff(x));
  try {
    floorAt(ctx, [-6.3, -1.7, -0.3, 2.3], 0);
    for (const step of [2.5, 2.5]) {
      const handle = shownGlobalHandles({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (q) => runtime.cloudFor(q) }).find((h) => h.kind === "pivot");
      const params = platformContourTool.defaultParams();
      const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
      const current = { point: { ...handle.position, x: handle.position.x + step }, screenX: 200, screenY: 300 };
      platformContourTool.onPointerDown(ctx, start, params);
      platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
      platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
      assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    }
    // Now over x = -1.3..4.7: resting up to x = 2, out over the valley past it.
    const holes = holesIn(runtime, (x, z) => x > -1.3 && x < 2.3 && z > -1.7 && z < 2.3);
    assert.deepEqual(holes, [], "no hole where it stood, nor under its raised end");
    const floor = of(runtime, "platform");
    const held = new Set(groundHolding(runtime, floor).flatMap((t) => t.nodes.map((n) => n.id)));
    assert.ok(floor.nodes.filter((n) => n.position.x > 3).every((n) => !held.has(n.id)), "nothing out over the drop is joined to the ground");
  } finally { session.free(); }
}));

test("a floor half run into a hill, half out of it, leaves no basin open under it: the ground is cut only where it rises through the floor, and runs on under the rest", quiet(() => {
  // A hill peaking at (6, 0), 8 m high, falling away towards the floor's open end.
  const hill = (x, z) => Math.max(0, 8 - 0.35 * ((x - 6) ** 2 + z * z));
  const { runtime, ctx, calls, session } = setup(hill);
  try {
    const y = 5.6;
    floorAt(ctx, [-1.3, -2.3, 5.3, 2.3], y);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const ground = terrain(runtime), basin = [];
    for (let x = -1.23; x < 5.3; x += 0.25) for (let z = -2.23; z < 2.3; z += 0.25) {
      // Well below the floor -- clear of where the hill crosses it -- the ground must still be there.
      if (hill(x, z) < y - 0.6 && !ground.some((t) => insidePlan(t, x, z))) basin.push([+x.toFixed(2), +z.toFixed(2)]);
    }
    assert.deepEqual(basin, [], "no ground missing under the floor where the hill does not reach it");
    assert.ok(!groundUnder(runtime, [4.5, -0.8, 5.3, 0.8]), "and none left where the hill rises through it");
  } finally { session.free(); }
}));

test("where the ground ends under a floor run half out of a hill, its edge lies on the floor's underside all along: no gap below it, no ground through it", quiet(() => {
  const hill = (x, z) => Math.max(0, 8 - 0.35 * ((x - 6) ** 2 + z * z));
  const { runtime, ctx, calls, session } = setup(hill);
  try {
    const y = 5.6, box = [-1.3, -2.3, 5.3, 2.3];
    floorAt(ctx, box, y);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const ground = terrain(runtime);
    const uses = new Map();
    for (const t of ground) for (const use of t.outerLoops.flat()) {
      const key = [use.startNodeId, use.endNodeId].sort().join("|");
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
    const at = new Map(ground.flatMap((t) => t.nodes.map((n) => [n.id, n.position])));
    const under = (p) => p.x > box[0] + 0.05 && p.x < box[2] - 0.05 && p.z > box[1] + 0.05 && p.z < box[3] - 0.05;
    // The ground's own edge -- walked by one ground face only -- where it runs under the floor.
    const edge = [...uses].filter(([, count]) => count === 1).flatMap(([key]) => key.split("|")).map((id) => at.get(id)).filter((p) => p && under(p));
    assert.ok(edge.length >= 2, "the ground ends under the floor");
    for (const p of edge) assert.ok(Math.abs(p.y - y) < 0.02, `on the floor's underside: ${JSON.stringify(p)}`);
    assert.ok([...at.values()].every((p) => !under(p) || p.y <= y + 0.02), "no ground rises through the floor");
  } finally { session.free(); }
}));
