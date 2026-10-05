import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { DEFAULT_TOOL_PARAMS, hasTrait } from "../src/features/edit-construction/index.ts";

/**
 * Tunnels and earth bridges through the terrain brush, against the real
 * engine: the shape's pieces stand as one sealed structure and the ground
 * under open sky is regenerated round it by the ground's own repair.
 *
 * `PROBE=1` prints the counts behind each assertion.
 */

const probe = process.env.PROBE === "1" ? (...line) => console.log(...line) : () => {};

/** Square ground of `cells` x `cells` faces `cell` wide, centred on the origin. */
function ground(runtime, session, cell, cells, heightAt) {
  runtime.getSnapshot = () => ({
    tableId: "t",
    map: { nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [n.id, { position: { x: n.position[0], y: n.position[1], z: n.position[2] } }])) },
  });
  const origin = (-cell * cells) / 2, id = (i, j) => `g:${i}:${j}`, nodes = [];
  for (let i = 0; i <= cells; i++) for (let j = 0; j <= cells; j++) {
    const x = origin + i * cell, z = origin + j * cell;
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

const hill = (x, z) => 6 * Math.exp(-(x * x + z * z) / (2 * 7 * 7));

function setup(heightAt) {
  const fixture = sessionFixture();
  const coverage = (polygon) => JSON.parse(fixture.session.footprint_coverage_json(JSON.stringify({ polygon }))).covered;
  Object.assign(fixture.runtime, { showPreview() {}, clearPreview() {}, getFootprintCoverage: coverage });
  ground(fixture.runtime, fixture.session, 2, 20, heightAt);
  return fixture;
}

function stroke(ctx, points, params) {
  const info = console.info, warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    const samples = points.map(([x, z], i) => ({ point: { x, y: params.heightAt(x, z), z }, screenX: i * 10, screenY: 0 }));
    terrainSculptTool.onPointerUp(ctx, { start: samples[0], current: samples.at(-1), samples }, params.tool);
  } finally {
    console.info = info;
    console.warn = warn;
  }
}

const shaped = (runtime) => runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "solid-ground");
const terrain = (runtime) => runtime.getAllRegionTopologies().filter((t) => hasTrait(t.surfaceType, "ground"));

/** Points along a straight drag from `a` to `b`, every half metre. */
const drag = ([ax, az], [bx, bz]) => {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
  return Array.from({ length: n + 1 }, (_, i) => [ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
};

test("a tunnel stroke into the hill stands as a sealed structure the ground is regenerated round", () => {
  const { runtime, ctx, calls, session } = setup(hill);
  try {
    const before = terrain(runtime).length;
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "tunnel", brushRadius: 1.8, faceSize: 2 };
    // From the foot of the hill, through it, out the other side.
    stroke(ctx, drag([-16, 0], [16, 0]), { tool, heightAt: hill });
    const feedback = calls.feedback.at(-1);
    probe("feedback", feedback, "terrain before", before, "after", terrain(runtime).length, "shaped", shaped(runtime).length);
    assert.equal(feedback?.tone, "success", JSON.stringify(feedback));
    const faces = shaped(runtime);
    assert.ok(faces.length > 20, `the tunnel's own faces stand: ${faces.length}`);
    // Its ceiling hangs over its floor: ground over ground.
    const under = faces.flatMap((t) => t.nodes).filter((n) => Math.abs(n.position.x) < 2 && Math.abs(n.position.z) < 1);
    const heights = under.map((n) => n.position.y).sort((a, b) => a - b);
    probe("heights over the middle of the tunnel", heights.map((y) => y.toFixed(2)).join(" "));
    assert.ok(heights.at(-1) - heights[0] > 2.5, `a ceiling over a floor in the middle of the hill: ${heights[0]?.toFixed(2)} .. ${heights.at(-1)?.toFixed(2)}`);
    // No ground left inside the tunnel's plan, where the hill over it is the structure's.
    const groundInside = terrain(runtime).filter((t) => {
      const x = t.nodes.reduce((s, n) => s + n.position.x, 0) / t.nodes.length, z = t.nodes.reduce((s, n) => s + n.position.z, 0) / t.nodes.length;
      return Math.abs(x) < 3 && Math.abs(z) < 1;
    });
    assert.equal(groundInside.length, 0, "the hill over the tunnel is laid once, by the structure");
    assert.ok(terrain(runtime).length > 100, "the ground round it stands");
  } finally { session.free(); }
});

test("a second stroke reaching the first tunnel joins it into one zone, laid again", () => {
  const { runtime, ctx, calls, session } = setup(hill);
  try {
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "tunnel", brushRadius: 1.6, faceSize: 2 };
    stroke(ctx, drag([-16, 0], [2, 0]), { tool, heightAt: hill });
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const first = new Set(shaped(runtime).map((t) => t.surfaceKey.join(" ")));
    stroke(ctx, drag([0, -16], [0, 0]), { tool, heightAt: hill });
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const second = shaped(runtime);
    probe("first", first.size, "joined", second.length);
    assert.ok(second.every((t) => !first.has(t.surfaceKey.join(" "))), "the first zone's faces were replaced by the joined one");
  } finally { session.free(); }
});

test("an earth bridge stroke over flat ground stands as a sealed structure", () => {
  const flat = () => 0;
  const { runtime, ctx, calls, session } = setup(flat);
  try {
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "bridge", brushRadius: 1.2, faceSize: 2, elevationStep: 3 };
    stroke(ctx, drag([-10, 0], [10, 0]), { tool, heightAt: flat });
    const feedback = calls.feedback.at(-1);
    probe("feedback", feedback, "shaped", shaped(runtime).length);
    assert.equal(feedback?.tone, "success", JSON.stringify(feedback));
    const top = Math.max(...shaped(runtime).flatMap((t) => t.nodes.map((n) => n.position.y)));
    assert.ok(top > 3, `the deck stands over the ground: ${top.toFixed(2)}`);
  } finally { session.free(); }
});

/** How far each corner on the structure's outline is from the nearest ground edge: the seam the regeneration closed. */
function seamGaps(runtime) {
  const faces = shaped(runtime);
  const uses = new Map();
  for (const t of faces) for (const loop of [...t.outerLoops, ...t.holes]) for (const use of loop) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
  const at = new Map(faces.flatMap((t) => t.nodes.map((n) => [n.id, n.position])));
  const rim = new Set(faces.flatMap((t) => [...t.outerLoops, ...t.holes].flat().filter((use) => uses.get(use.edgeId) === 1).flatMap((use) => [use.startNodeId, use.endNodeId])));
  const groundEdges = terrain(runtime).flatMap((t) => {
    const p = new Map(t.nodes.map((n) => [n.id, n.position]));
    return t.outerLoops.flat().map((use) => [p.get(use.startNodeId), p.get(use.endNodeId)]);
  });
  const toSegment = (q, a, b) => {
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, l = d.x * d.x + d.y * d.y + d.z * d.z;
    const t = l > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * d.x + (q.y - a.y) * d.y + (q.z - a.z) * d.z) / l)) : 0;
    return Math.hypot(q.x - a.x - d.x * t, q.y - a.y - d.y * t, q.z - a.z - d.z * t);
  };
  const gaps = [...rim].map((id) => at.get(id)).filter((q) => Math.abs(q.x) < 19 && Math.abs(q.z) < 19).map((q) => ({ q, gap: Math.min(...groundEdges.map(([a, b]) => toSegment(q, a, b))) }));
  probe("worst edge gaps", [...gaps].sort((a, b) => b.gap - a.gap).slice(0, 4).map(({ q, gap }) => `(${q.x.toFixed(1)},${q.y.toFixed(2)},${q.z.toFixed(1)}) ${gap.toFixed(2)}`).join("  "));
  return gaps.map(({ gap }) => gap);
}

function seamGapsWhere(runtime) {
  const faces = shaped(runtime);
  const uses = new Map();
  for (const t of faces) for (const loop of [...t.outerLoops, ...t.holes]) for (const use of loop) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
  const at = new Map(faces.flatMap((t) => t.nodes.map((n) => [n.id, n.position])));
  const rim = new Set(faces.flatMap((t) => [...t.outerLoops, ...t.holes].flat().filter((use) => uses.get(use.edgeId) === 1).flatMap((use) => [use.startNodeId, use.endNodeId])));
  const groundNodes = terrain(runtime).flatMap((t) => t.nodes.map((n) => n.position));
  return [...rim].map((id) => at.get(id)).filter((q) => Math.abs(q.x) < 19 && Math.abs(q.z) < 19)
    .map((q) => ({ q, gap: Math.min(...groundNodes.map((p) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z))) }))
    .sort((a, b) => b.gap - a.gap);
}

test("the ground regenerated round a tunnel comes up to its outline", () => {
  const { runtime, ctx, calls, session } = setup(hill);
  try {
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "tunnel", brushRadius: 1.8, faceSize: 2 };
    stroke(ctx, drag([-16, 0], [16, 0]), { tool, heightAt: hill });
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const gaps = seamGaps(runtime).sort((a, b) => a - b);
    const where = seamGapsWhere(runtime);
    probe("worst gaps at", where.slice(0, 6).map(({ q, gap }) => `(${q.x.toFixed(1)},${q.y.toFixed(2)},${q.z.toFixed(1)}) ${gap.toFixed(3)}`).join("  "));
    probe("rim corners", gaps.length, "median gap", gaps[gaps.length >> 1]?.toFixed(3), "worst", gaps.at(-1)?.toFixed(3), "over 5 cm", gaps.filter((g) => g > 0.05).length);
    assert.ok(gaps.length > 0);
    // The ground meets the collar's edge as it meets a floor's sealed side:
    // along it, its own corners cutting the edge's bends. Measured 2026-10-05
    // at 4.8 cm median and 24 cm at the worst bend -- the bound holds that,
    // it does not call it closed.
    assert.ok(gaps[gaps.length >> 1] < 0.08, `median gap ${gaps[gaps.length >> 1]?.toFixed(3)}`);
    assert.ok(gaps.at(-1) < 0.4, `worst gap ${gaps.at(-1)?.toFixed(3)}`);
  } finally { session.free(); }
});

test("probe: which outline corners the ground holds", () => {
  if (process.env.PROBE !== "1") return;
  const { runtime, ctx, session } = setup(hill);
  try {
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "tunnel", brushRadius: 1.8, faceSize: 2 };
    const warn = console.warn; const logs = []; 
    stroke(ctx, drag([-16, 0], [16, 0]), { tool, heightAt: hill });
    const faces = shaped(runtime);
    const uses = new Map();
    for (const t of faces) for (const use of t.outerLoops.flat()) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
    const at = new Map(faces.flatMap((t) => t.nodes.map((n) => [n.id, n.position])));
    const rim = [...new Set(faces.flatMap((t) => t.outerLoops.flat().filter((use) => uses.get(use.edgeId) === 1).flatMap((use) => [use.startNodeId, use.endNodeId])))];
    const groundNodes = terrain(runtime).flatMap((t) => t.nodes);
    const sharedIds = rim.filter((id) => groundNodes.some((n) => n.id === id)).length;
    const samePlace = rim.filter((id) => { const q = at.get(id); return groundNodes.some((n) => Math.hypot(n.position.x - q.x, n.position.y - q.y, n.position.z - q.z) < 1e-3); }).length;
    const samePlan = rim.filter((id) => { const q = at.get(id); return groundNodes.some((n) => Math.hypot(n.position.x - q.x, n.position.z - q.z) < 1e-3); }).length;
    console.log("rim", rim.length, "shared ids", sharedIds, "ground node at same 3D point", samePlace, "same plan point", samePlan);
  } finally { session.free(); }
});

test("a raise stroke over a tunnel's zone raises the hill over it and keeps the tunnel", () => {
  const { runtime, ctx, calls, session } = setup(hill);
  try {
    const tunnel = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "tunnel", brushRadius: 1.8, faceSize: 2 };
    stroke(ctx, drag([-16, 0], [16, 0]), { tool: tunnel, heightAt: hill });
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const topBefore = Math.max(...shaped(runtime).flatMap((t) => t.nodes.map((n) => n.position.y)));
    const raise = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "add", brushRadius: 3, faceSize: 2, elevationStep: 1.5 };
    stroke(ctx, drag([-1, 0], [1, 0]), { tool: raise, heightAt: hill });
    const feedback = calls.feedback.at(-1);
    probe("raise feedback", feedback);
    assert.equal(feedback?.tone, "success", JSON.stringify(feedback));
    assert.match(feedback.message, /escavado refeito/);
    const faces = shaped(runtime);
    const topAfter = Math.max(...faces.flatMap((t) => t.nodes.map((n) => n.position.y)));
    probe("top", topBefore.toFixed(2), "->", topAfter.toFixed(2));
    assert.ok(topAfter > topBefore + 1, `the hill over the tunnel rose: ${topBefore.toFixed(2)} -> ${topAfter.toFixed(2)}`);
    const under = faces.flatMap((t) => t.nodes).filter((n) => Math.abs(n.position.x) < 2 && Math.abs(n.position.z) < 1).map((n) => n.position.y);
    assert.ok(Math.min(...under) < 0.5, "the tunnel's floor is still there under it");
  } finally { session.free(); }
});

test("probe: how much of the ground a tunnel stroke replaces", () => {
  if (process.env.PROBE !== "1") return;
  const { runtime, ctx, session } = setup(hill);
  try {
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "tunnel", brushRadius: 1.8, faceSize: 2 };
    stroke(ctx, drag([-8, 0], [0, 0]), { tool, heightAt: hill });
    const ground = terrain(runtime);
    const original = ground.filter((t) => t.surfaceKey.some((part) => part.startsWith("q:")));
    const replacedFar = ground.filter((t) => !t.surfaceKey.some((part) => part.startsWith("q:"))).filter((t) => {
      const x = t.nodes.reduce((s, n) => s + n.position.x, 0) / t.nodes.length, z = t.nodes.reduce((s, n) => s + n.position.z, 0) / t.nodes.length;
      return Math.abs(z) > 8 || x > 8 || x < -16;
    });
    console.log("ground faces", ground.length, "original kept", original.length, "of 400", "new faces far from the stroke", replacedFar.length, "keys sample", ground.find((t) => !t.surfaceKey.some((p) => p.startsWith("q:")))?.surfaceKey);
  } finally { session.free(); }
});

test("a tunnel stroke is ghosted as the volume it carves: a sphere under the pointer, a capsule along the drag", () => {
  const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "tunnel", brushRadius: 1.8, faceSize: 2 };
  assert.equal(terrainSculptTool.previewOnHover(tool), true, "shown before the stroke starts");
  assert.equal(terrainSculptTool.previewOnHover({ ...tool, mode: "add" }), false, "the other modes keep their own ghost");
  const at = (x, z) => ({ point: { x, y: hill(x, z), z } });
  const hover = terrainSculptTool.previewFor({ start: at(-8, 0), current: at(-8, 0), samples: [at(-8, 0)] }, tool, {});
  assert.equal(hover.kind, "segments");
  const ys = [];
  for (let i = 1; i < hover.positions.length; i += 3) ys.push(hover.positions[i]);
  const centre = (Math.max(...ys) + Math.min(...ys)) / 2;
  assert.ok(Math.abs(centre - (hill(-8, 0) + 1.8 * 0.7)) < 1e-3, "the sphere stands where the tunnel's axis starts");
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 3.6) < 1e-3, "as wide as the tunnel");
  const samples = drag([-8, 0], [0, 0]).map(([x, z]) => at(x, z));
  const drawn = terrainSculptTool.previewFor({ start: samples[0], current: samples.at(-1), samples }, tool, {});
  assert.ok(drawn.positions.length > hover.positions.length * 2, "a capsule along the drag");
});
