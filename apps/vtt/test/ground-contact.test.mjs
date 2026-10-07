import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { shownGlobalHandles } from "../src/features/edit-construction/index.ts";

/**
 * The ground rests under a structure where the structure stands on it or in
 * it, and is never cut for it (note 0012) -- against the real engine, on a
 * bowl of terrain rising away from the middle. A floor high over it leaves it
 * whole; one on the bowl's side brings it to rest just under itself only
 * where it is within reach, the ground passing under the rest untouched; one
 * lifted off it leaves it shaped as it was; a ramp run into it has it rest
 * under its foot without losing a corner. Never a hole.
 */

function bowl(runtime, session, heightAt = (x, z) => 0.04 * (x * x + z * z), cells = 10) {
  runtime.getSnapshot = () => ({
    tableId: "t",
    map: { nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [n.id, { position: { x: n.position[0], y: n.position[1], z: n.position[2] } }])) },
  });
  const cell = 2, id = (i, j) => `g:${i}:${j}`, nodes = [];
  for (let i = 0; i <= cells; i++) for (let j = 0; j <= cells; j++) {
    const x = -cells + i * cell, z = -cells + j * cell;
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

function setup(heightAt, cells) {
  const fixture = sessionFixture();
  Object.assign(fixture.runtime, { showPreview() {}, clearPreview() {} });
  bowl(fixture.runtime, fixture.session, heightAt, cells);
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
/**
 * The corners of `face` the ground meets: a ground node standing exactly
 * there, at the corner's height. A floor's outline is sealed -- the ground
 * meets its sides without splitting them or taking its nodes -- so this, not a
 * shared node, is what "the ground comes up to it" means.
 */
const cornersMet = (runtime, face) => {
  const ground = terrain(runtime).flatMap((t) => t.nodes.map((n) => n.position));
  return face.nodes.filter((corner) => ground.some((p) => Math.hypot(p.x - corner.position.x, p.y - corner.position.y, p.z - corner.position.z) < 1e-3));
};
/** How far under a structure's faces the ground comes to rest: `GROUND_REST_SINK`. */
const SINK = 0.08;
/** Every sheet of ground over a point of the plane, lowest first. */
const sheetsAt = (runtime, x, z) => {
  const ys = [];
  for (const t of terrain(runtime)) {
    const ring = t.outerLoops[0].map((use) => t.nodes.find((n) => n.id === use.startNodeId).position);
    for (let k = 1; k + 1 < ring.length; k++) {
      const [a, b, c] = [ring[0], ring[k], ring[k + 1]];
      const d = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((b.x - x) * (c.z - z) - (c.x - x) * (b.z - z)) / d, v = ((c.x - x) * (a.z - z) - (a.x - x) * (c.z - z)) / d, w = 1 - u - v;
      if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9) ys.push(u * a.y + v * b.y + w * c.y);
    }
  }
  return ys.sort((a, b) => a - b);
};
/** Points of the box, off the ground's grid lines. */
const across = ([x0, z0, x1, z1], step = 0.5) => {
  const points = [];
  for (let x = x0 + 0.13; x < x1; x += step) for (let z = z0 + 0.13; z < z1; z += step) points.push([x, z]);
  return points;
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
    assert.equal(cornersMet(runtime, of(runtime, "platform")).length, 0);
  } finally { session.free(); }
}));

test("a floor on the bowl's side brings the ground to rest under it only where it is within reach; the ground passes under the rest untouched", quiet(() => {
  const { runtime, ctx, calls, session } = setup();
  try {
    const bowlAt = (x, z) => 0.04 * (x * x + z * z);
    // At 3 m: well clear of the ground near x = -2.3; the bowl's wall comes within reach past x = 6.1 and rises through it past x = 8.7.
    floorAt(ctx, [-2.3, -1.3, 9.3, 1.3], 3);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const floor = of(runtime, "platform");
    assert.equal(floor.nodes.length, 4, "its four corners: the ground takes nothing of it");
    assert.equal(groundHolding(runtime, floor).length, 0, "no ground holds a node of it");
    for (const [x, z] of across([6.6, -1, 7.8, 1])) {
      const top = sheetsAt(runtime, x, z).at(-1);
      assert.ok(Math.abs(top - (3 - SINK)) < 0.1, `just under it where it came within reach, at ${x.toFixed(2)}: ${top}`);
    }
    // Where it reaches the ground's own edge, the edge stays where it is: a little through it there, never a pit.
    for (const [x, z] of across([7.8, -1, 9.3, 1], 0.25)) {
      const top = sheetsAt(runtime, x, z).at(-1);
      assert.ok(top > 3 - 0.5 && top < 3 + 0.5, `near the ground's edge at ${x.toFixed(2)}: ${top}`);
    }
    for (const [x, z] of across([-2.3, -1.3, 3, 1.3])) {
      const top = sheetsAt(runtime, x, z).at(-1);
      assert.ok(Math.abs(top - bowlAt(x, z)) < 0.1, `untouched where it stands clear, at ${x.toFixed(2)}: ${top} for ${bowlAt(x, z)}`);
    }
    assert.deepEqual(holesIn(runtime, () => false), [], "and never a hole");
  } finally { session.free(); }
}));

test("a floor on the ground lifted off it by its height handle leaves the ground as it was shaped, whole under it", quiet(() => {
  const { runtime, ctx, calls, session } = setup();
  try {
    floorAt(ctx, [-3, -2, 2, 3], 0.3);
    for (const [x, z] of across([-2.5, -1.5, 1.5, 2.5], 1)) assert.ok(Math.abs(sheetsAt(runtime, x, z).at(-1) - (0.3 - SINK)) < 0.1, "at rest under it to begin with");
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
    assert.equal(groundHolding(runtime, floor).length, 0, "no ground holds a node of it");
    assert.ok(groundUnder(runtime, [-2.5, -1.5, 1.5, 2.5]), "the ground stands under it");
    assert.deepEqual(holesIn(runtime, () => false), [], "never a hole");
  } finally { session.free(); }
}));

test("a ramp run into the ground has the ground rest under its foot, keeps its four corners, and the ground passes under its raised end", quiet(async () => {
  const { slopeRampTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { runtime, ctx, calls, session } = setup();
  try {
    // From the bowl's bottom, climbing 3 m over 6: its foot on the ground, its top well clear of it.
    const s = { point: { x: -3, y: 0.36, z: 0 } }, e = { point: { x: 3, y: 0.36, z: 0 } };
    slopeRampTool.onPointerUp(ctx, { start: s, current: e, samples: [s, e] }, { bottomWidth: 2, topWidth: 2, rise: 3 });
    assert.notEqual(calls.feedback.at(-1)?.tone, "error", JSON.stringify(calls.feedback.at(-1)));
    const ramp = of(runtime, "platform-ramp");
    assert.equal(ramp.nodes.length, 4, "its four corners and nothing else");
    assert.equal(groundHolding(runtime, ramp).length, 0, "no ground holds a node of it");
    // Climbing half a metre for every one: 15 cm over its foot 0.3 m in.
    const footY = Math.min(...ramp.nodes.map((n) => n.position.y)) + 0.15;
    for (const z of [-0.6, 0, 0.6]) {
      const top = sheetsAt(runtime, -2.7, z).at(-1);
      assert.ok(top <= footY + 0.02 && top > footY - 0.3, `the ground rests just under its foot: ${top} under ${footY}`);
    }
    assert.ok(Math.abs(sheetsAt(runtime, 2.5, 0).at(-1) - 0.25) < 0.15, "and runs on under its raised end as it was");
    assert.deepEqual(holesIn(runtime, () => false), [], "never a hole");
  } finally { session.free(); }
}));

test("a floor drawn on uneven ground, a little above or below it here and there, rests on it all round: the ground lies just under it everywhere, never through it", quiet(() => {
  const wavy = (x, z) => 0.5 * (Math.sin(x * 0.9) + Math.cos(z * 1.3));
  // Within the reach everywhere: the lowest trough under it is at most 1.5 m down.
  for (const y of [-0.3, 0.2, 0.5]) {
    const { runtime, ctx, calls, session } = setup(wavy);
    try {
      floorAt(ctx, [-2.3, -1.7, 3.7, 2.3], y);
      assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
      const floor = of(runtime, "platform");
      assert.equal(floor.nodes.length, 4, `at ${y}: its four corners`);
      for (const [x, z] of across([-2.3, -1.7, 3.7, 2.3])) {
        const top = sheetsAt(runtime, x, z).at(-1);
        assert.ok(Math.abs(top - (y - SINK)) < 0.1, `at ${y}: just under it at (${x.toFixed(2)}, ${z.toFixed(2)}): ${top}`);
      }
      assert.deepEqual(holesIn(runtime, () => false), [], `at ${y}: never a hole`);
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

test("a floor half run into a hill, half out of it, leaves no basin open under it: the hill is brought down to it only where it rises through it or near it, and runs on under the rest", quiet(() => {
  // A hill peaking at (6, 0), 8 m high, falling away towards the floor's open end.
  const hill = (x, z) => Math.max(0, 8 - 0.35 * ((x - 6) ** 2 + z * z));
  const { runtime, ctx, calls, session } = setup(hill);
  try {
    const y = 5.6;
    const was = new Map(across([-1.3, -2.3, 5.3, 2.3], 0.25).map(([x, z]) => [`${x}:${z}`, sheetsAt(runtime, x, z).at(-1)]));
    const oldGround = terrain(runtime);
    floorAt(ctx, [-1.3, -2.3, 5.3, 2.3], y);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    assert.deepEqual(holesIn(runtime, () => false), [], "no ground missing anywhere");
    for (const [x, z] of across([-1.3, -2.3, 5.3, 2.3], 0.25)) {
      const top = sheetsAt(runtime, x, z).at(-1);
      assert.ok(top <= y + 0.02, `no ground through the floor at (${x.toFixed(2)}, ${z.toFixed(2)}): ${top}`);
      // Well below it -- out of reach -- the hill is as it was.
      assert.ok(was.get(`${x}:${z}`) !== undefined);
    }
    // Out of reach the hill is laid again on its own surface: every corner of it there lies on the hill as it was.
    const before = (x, z) => sheetsAt({ getAllRegionTopologies: () => oldGround }, x, z).at(-1);
    for (const node of terrain(runtime).flatMap((t) => t.nodes)) {
      const { x, y: at, z } = node.position;
      const was = before(x, z);
      if (x > -1.3 && x < 5.3 && z > -2.3 && z < 2.3 && was < y - 2.5) assert.ok(Math.abs(at - was) < 0.02, `untouched out of reach at (${x.toFixed(2)}, ${z.toFixed(2)}): ${at} for ${was}`);
    }
    // Where the hill rose through it, every corner of the ground is brought down to just under it.
    const risen = terrain(runtime).flatMap((t) => t.nodes).filter(({ position: { x, z } }) => x > -1.3 && x < 5.3 && z > -2.3 && z < 2.3 && before(x, z) > y);
    assert.ok(risen.length > 0, "the hill rose through it somewhere");
    for (const { position } of risen) assert.ok(Math.abs(position.y - (y - SINK)) < 0.05, `brought down to just under it where it rose through: ${JSON.stringify(position)}`);
  } finally { session.free(); }
}));


test("a floor moved a long way across the ground leaves the ground it passed over exactly as it was", quiet(() => {
  // Ground 32 m across: a repair takes in two rings of faces round each cut, so the path between has to be longer than that on both sides.
  const { runtime, ctx, calls, session } = setup(() => 0, 16);
  try {
    floorAt(ctx, [-8.3, -1.7, -4.3, 1.7], 0);
    const keyOf = (t) => t.surfaceKey.join(" ");
    const middle = (t) => ({ x: t.nodes.reduce((s, n) => s + n.position.x, 0) / t.nodes.length, z: t.nodes.reduce((s, n) => s + n.position.z, 0) / t.nodes.length });
    // Halfway between where it stood and where it arrived: out of reach of either cut.
    const onPath = (t) => { const { x, z } = middle(t); return x > 0.5 && x < 1.5 && z > -4 && z < 4; };
    const before = new Set(terrain(runtime).filter(onPath).map(keyOf));
    const handle = shownGlobalHandles({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (q) => runtime.cloudFor(q) }).find((h) => h.kind === "pivot");
    const params = platformContourTool.defaultParams();
    const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
    const current = { point: { ...handle.position, x: handle.position.x + 16 }, screenX: 400, screenY: 300 };
    platformContourTool.onPointerDown(ctx, start, params);
    platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
    platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const after = new Set(terrain(runtime).filter(onPath).map(keyOf));
    assert.deepEqual([...after].filter((key) => !before.has(key)), [], "no ground laid again along the way");
    assert.deepEqual([...before].filter((key) => !after.has(key)), [], "none taken away along the way");
    // Now over x = 7.7..11.7: the ground heals where it stood and goes round where it is.
    assert.deepEqual(holesIn(runtime, (x, z) => x > 7.7 && x < 11.7 && z > -1.7 && z < 1.7), [], "no hole where it stood, nor round where it is");
  } finally { session.free(); }
}));

test("a floor standing clear of the ground, moved to where it rests on it, brings the ground to rest only where it arrived: where it stood it had moved nothing, so nothing there is laid again", quiet(() => {
  // A valley 2 m down on the west, level ground on the east.
  const { runtime, ctx, calls, session } = setup((x) => (x < 0 ? -2 : 0));
  try {
    floorAt(ctx, [-8.3, -1.7, -4.3, 1.7], 0.3);
    const keyOf = (t) => t.surfaceKey.join(" ");
    assert.ok(Math.abs(sheetsAt(runtime, -6.3, 0).at(-1) + 2) < 0.05, "the valley floor out of its reach to begin with");
    const middle = (t) => ({ x: t.nodes.reduce((s, n) => s + n.position.x, 0) / t.nodes.length, z: t.nodes.reduce((s, n) => s + n.position.z, 0) / t.nodes.length });
    const whereItStood = (t) => { const { x, z } = middle(t); return x > -10 && x < -2.5 && z > -4 && z < 4; };
    const before = new Set(terrain(runtime).filter(whereItStood).map(keyOf));
    const handle = shownGlobalHandles({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (q) => runtime.cloudFor(q) }).find((h) => h.kind === "pivot");
    const params = platformContourTool.defaultParams();
    const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
    const current = { point: { ...handle.position, x: handle.position.x + 12 }, screenX: 400, screenY: 300 };
    platformContourTool.onPointerDown(ctx, start, params);
    platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
    platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    assert.ok(Math.abs(sheetsAt(runtime, 5.7, 0).at(-1) - (0.3 - SINK)) < 0.1, "at rest under it where it arrived");
    assert.deepEqual(terrain(runtime).filter(whereItStood).map(keyOf).sort(), [...before].sort(), "the valley where it stood is left exactly as it was");
  } finally { session.free(); }
}));
