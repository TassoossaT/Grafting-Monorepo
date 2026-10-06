import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { DEFAULT_TOOL_PARAMS, hasTrait } from "../src/features/edit-construction/index.ts";

/**
 * The brush's everyday strokes -- a layer laid, taken off, the ground
 * levelled -- from the bare table on, against the real engine: the session
 * that once refused a cloud laid apart from another, wiped a hill a second
 * stroke was laid over, and laid finer with every stroke.
 *
 * `PROBE=1` prints what each stroke left.
 */

const probe = process.env.PROBE === "1" ? (...line) => console.log(...line) : () => {};

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

const groundOf = (runtime) => runtime.getAllRegionTopologies().filter((t) => hasTrait(t.surfaceType, "ground"));

/** The ground's height under a point: its nearest corner, or the table. */
function heightAt(runtime, x, z) {
  let best = 0, nearest = 1.5;
  for (const t of groundOf(runtime)) for (const n of t.nodes) {
    const d = Math.hypot(n.position.x - x, n.position.z - z);
    if (d < nearest) { nearest = d; best = n.position.y; }
  }
  return best;
}

const quiet = (work) => {
  const info = console.info, warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try { return work(); } finally { console.info = info; console.warn = warn; }
};

function stroke({ runtime, ctx, calls }, points, params = {}) {
  const samples = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const [a, b] = [points[k], points[k + 1]];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    for (let i = 0; i < n; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / n, z = a[1] + ((b[1] - a[1]) * i) / n;
      samples.push({ point: { x, y: heightAt(runtime, x, z), z }, screenX: 0, screenY: 0 });
    }
  }
  const [x, z] = points.at(-1);
  samples.push({ point: { x, y: heightAt(runtime, x, z), z }, screenX: 0, screenY: 0 });
  quiet(() => terrainSculptTool.onPointerUp(ctx, { start: samples[0], current: samples.at(-1), samples }, { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], ...params }));
  const feedback = calls.feedback.at(-1);
  assert.equal(feedback?.tone, "success", JSON.stringify(feedback));
  return feedback;
}

/** One mesh, every face up: no edge held by three faces, no face turned over in plan, and how many open borders. */
function meshOf(runtime) {
  const ground = groundOf(runtime);
  const uses = new Map();
  let turned = 0;
  for (const t of ground) {
    for (const use of t.outerLoops.flat()) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
    const ring = t.outerLoops[0].map((use) => t.nodes.find((n) => n.id === use.startNodeId).position);
    let area = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; area += a.x * b.z - b.x * a.z; }
    if (area <= 0) turned++;
  }
  const adjacent = new Map();
  for (const t of ground) for (const use of t.outerLoops.flat()) if (uses.get(use.edgeId) === 1) {
    for (const [a, b] of [[use.startNodeId, use.endNodeId], [use.endNodeId, use.startNodeId]]) adjacent.set(a, [...(adjacent.get(a) ?? []), b]);
  }
  const seen = new Set();
  let borders = 0;
  for (const start of adjacent.keys()) {
    if (seen.has(start)) continue;
    borders++;
    const stack = [start];
    seen.add(start);
    while (stack.length) for (const next of adjacent.get(stack.pop())) if (!seen.has(next)) { seen.add(next); stack.push(next); }
  }
  const ys = ground.flatMap((t) => t.nodes.map((n) => n.position.y));
  return { faces: ground.length, thrice: [...uses.values()].filter((n) => n > 2).length, turned, borders, top: Math.max(...ys) };
}

test("layers laid from the bare table on: apart, over and across one another, each one mesh and every face up", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    const steps = [
      ["a hill on the bare table", [[-10, 0], [10, 0]], {}, 1],
      ["a second, apart from it", [[30, 20], [45, 20]], {}, 2],
      ["over the first", [[-5, -5], [5, 5]], {}, 2],
      ["across both, joining them", [[8, 4], [32, 18]], {}, 1],
      ["a trench dug across", [[-8, -3], [8, 3]], { mode: "dig" }, 1],
      ["levelled", [[-4, 0], [4, 0]], { mode: "flatten" }, 1],
      ["off the hill onto the table", [[0, 0], [0, -25]], {}, 1],
    ];
    let first;
    for (const [name, points, params, borders] of steps) {
      stroke(fixture, points, params);
      const mesh = meshOf(runtime);
      probe(name, JSON.stringify(mesh));
      first ??= mesh.top;
      assert.equal(mesh.thrice, 0, `${name}: one mesh`);
      assert.equal(mesh.turned, 0, `${name}: every face up`);
      assert.equal(mesh.borders, borders, `${name}: ${borders} open border(s)`);
      if (name === "over the first") assert.ok(mesh.top > first * 1.8, `${name}: the layer adds to the hill under it (${mesh.top.toFixed(2)})`);
    }
  } finally { fixture.session.free(); }
});

test("strokes over the same ground lay it no finer each time", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    stroke(fixture, [[-10, 0], [10, 0]], { brushRadius: 8 });
    const counts = [];
    for (let i = 0; i < 8; i++) {
      stroke(fixture, [[-6 + i, -4], [-2 + i, 4]], { brushRadius: 4 });
      counts.push(meshOf(runtime).faces);
    }
    probe("faces after each stroke", counts.join(" "));
    assert.ok(counts.at(-1) < counts[0] * 1.5, `the ground keeps its face size: ${counts.join(" ")}`);
  } finally { fixture.session.free(); }
});
