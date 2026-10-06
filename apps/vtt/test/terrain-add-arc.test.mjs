import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { DEFAULT_TOOL_PARAMS, hasTrait } from "../src/features/edit-construction/index.ts";

/**
 * The terrain brush's add stroke drawn as an arc, against the real engine.
 *
 * `PROBE=1` prints what each stroke left.
 */

const probe = process.env.PROBE === "1" ? (...line) => console.log(...line) : () => {};

function ground(runtime, session, cell, cells, heightAt) {
  runtime.getSnapshot = () => ({
    tableId: "t",
    map: { nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [n.id, { position: { x: n.position[0], y: n.position[1], z: n.position[2] } }])) },
  });
  if (cells === 0) return;
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

function setup(cells, heightAt = () => 0) {
  const fixture = sessionFixture();
  const coverage = (polygon) => JSON.parse(fixture.session.footprint_coverage_json(JSON.stringify({ polygon }))).covered;
  Object.assign(fixture.runtime, {
    showPreview() {},
    clearPreview() {},
    getFootprintCoverage: coverage,
    generateHeightmap: (columns, rows, seed, scale, ox, oz) => new Float32Array(columns * rows).map((_, i) => Math.sin((ox + (i % columns)) * scale * 3 + seed) * Math.cos((oz + Math.floor(i / columns)) * scale * 3) * 0.5),
  });
  ground(fixture.runtime, fixture.session, 2, cells, heightAt);
  return fixture;
}

/** An arc of `angle` radians round the origin, `radius` out, sampled every half metre. */
const arc = (radius, angle, start = 0) => {
  const n = Math.ceil((radius * angle) / 0.5);
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = start + (angle * i) / n;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  });
};

function stroke(ctx, points, tool, heightAt = () => 0) {
  const info = console.info, warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    const samples = points.map(([x, z], i) => ({ point: { x, y: heightAt(x, z), z }, screenX: i * 10, screenY: 0 }));
    terrainSculptTool.onPointerUp(ctx, { start: samples[0], current: samples.at(-1), samples }, tool);
  } finally {
    console.info = info;
    console.warn = warn;
  }
}

/** What the ground looks like after a stroke: faces, torn or overlapping, and how tall. */
function inspect(runtime) {
  const faces = runtime.getAllRegionTopologies().filter((t) => hasTrait(t.surfaceType, "ground"));
  const uses = new Map();
  for (const t of faces) for (const use of t.outerLoops.flat()) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
  const thrice = [...uses.values()].filter((n) => n > 2).length;
  const heights = faces.flatMap((t) => t.nodes.map((n) => n.position.y));
  // Faces lying over each other in plan: a centre inside another face.
  const rings = faces.map((t) => {
    const at = new Map(t.nodes.map((n) => [n.id, n.position]));
    return t.outerLoops[0].map((u) => at.get(u.startNodeId));
  });
  const inside = (ring, x, z) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
    }
    return hit;
  };
  let overlaps = 0;
  rings.forEach((ring, i) => {
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length, cz = ring.reduce((s, p) => s + p.z, 0) / ring.length;
    if (rings.some((other, j) => j !== i && inside(other, cx, cz))) overlaps += 1;
  });
  // Faces turned over: their plan winding against the ground's.
  const windings = rings.map((ring) => {
    let twice = 0;
    for (let i = 0; i < ring.length; i++) twice += ring[i].x * ring[(i + 1) % ring.length].z - ring[(i + 1) % ring.length].x * ring[i].z;
    return Math.sign(twice);
  });
  const majority = Math.sign(windings.reduce((s, w) => s + w, 0));
  const turned = windings.filter((w) => w !== majority).length;
  return { faces: faces.length, thrice, overlaps, turned, lowest: Math.min(...heights), highest: Math.max(...heights) };
}

for (const [name, cells] of [["on empty table", 0], ["over flat ground", 20]]) {
  for (const [shape, points] of [["a half circle", arc(8, Math.PI)], ["a tight three-quarter arc", arc(4, Math.PI * 1.5)], ["an S", [...arc(5, Math.PI, Math.PI).map(([x, z]) => [x + 5, z]), ...arc(5, Math.PI, 0).map(([x, z]) => [x - 5, -z])]]]) {
    test(`an add stroke drawn as ${shape} ${name} lays clean ground`, () => {
      const { runtime, ctx, calls, session } = setup(cells);
      try {
        const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "add" };
        stroke(ctx, points, tool);
        const after = inspect(runtime);
        probe(name, shape, JSON.stringify(calls.feedback.at(-1)), JSON.stringify(after));
        assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
        assert.equal(after.thrice, 0, "no edge held by three faces");
        assert.equal(after.overlaps, 0, "no face lying over another");
        assert.equal(after.turned, 0, "no face turned over");
        assert.ok(after.highest < 12 && after.lowest > -2, `no spike: ${after.lowest.toFixed(2)} .. ${after.highest.toFixed(2)}`);
      } finally { session.free(); }
    });
  }
}

for (const [name, cells, height] of [["over flat ground", 20, () => 0], ["over a hill", 20, (x, z) => 6 * Math.exp(-(x * x + z * z) / 98)]]) {
  for (const [shape, points] of [["a straight drag", Array.from({ length: 37 }, (_, i) => [-9 + i * 0.5, 0])], ["a half circle", arc(8, Math.PI)]]) {
    for (const radius of [6, 2]) {
      test(`a fill drawn as ${shape} ${name} at radius ${radius} keeps one clean mesh`, () => {
        const { runtime, ctx, calls, session } = setup(cells, height);
        try {
          const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "fill", brushRadius: radius };
          const started = performance.now();
          stroke(ctx, points, tool, height);
          const after = inspect(runtime);
          probe("fill", name, shape, radius, `${(performance.now() - started).toFixed(0)} ms`, JSON.stringify(calls.feedback.at(-1)), JSON.stringify(after));
          assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
          assert.equal(after.thrice, 0, "no edge held by three faces");
        } finally { session.free(); }
      });
    }
  }
}

const hill = (x, z) => 6 * Math.exp(-(x * x + z * z) / 98);
for (const [name, cells, height] of [["on empty table", 0, () => 0], ["over flat ground", 20, () => 0], ["over a hill", 20, hill]]) {
  for (const [shape, points] of [["a wide C", arc(10, Math.PI * 1.7)], ["a closed ring", arc(10, Math.PI * 2.05)], ["a half circle", arc(8, Math.PI)]]) {
    for (const radius of [3, 1.5]) {
      test(`an add stroke drawn as ${shape} ${name} at radius ${radius} lays clean ground`, () => {
        const { runtime, ctx, calls, session } = setup(cells, height);
        try {
          const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "add", brushRadius: radius };
          stroke(ctx, points, tool, height);
          const after = inspect(runtime);
          probe("add", name, shape, radius, JSON.stringify(calls.feedback.at(-1)), JSON.stringify(after));
          assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
          assert.equal(after.thrice, 0, "no edge held by three faces");
          assert.equal(after.overlaps, 0, "no face lying over another");
          assert.equal(after.turned, 0, "no face turned over");
          assert.ok(after.highest < 14 && after.lowest > -2, `no spike: ${after.lowest.toFixed(2)} .. ${after.highest.toFixed(2)}`);
        } finally { session.free(); }
      });
    }
  }
}

test("a second add arc over the first lays clean ground", () => {
  const { runtime, ctx, calls, session } = setup(20);
  try {
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "add" };
    stroke(ctx, arc(8, Math.PI), tool);
    const once = inspect(runtime);
    stroke(ctx, arc(8, Math.PI, Math.PI * 0.5), tool, (x, z) => Math.hypot(x, z) < 12 ? 2 : 0);
    const after = inspect(runtime);
    probe("add twice", JSON.stringify(once), JSON.stringify(calls.feedback.at(-1)), JSON.stringify(after));
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    assert.equal(after.thrice, 0);
    assert.equal(after.overlaps, 0);
    assert.equal(after.turned, 0);
  } finally { session.free(); }
});

const steep = (x, z) => 10 * Math.exp(-(x * x + z * z) / 50);
for (const [shape, points] of [["a straight drag across the flank", Array.from({ length: 25 }, (_, i) => [5, -6 + i * 0.5])], ["an arc round the flank", arc(6, Math.PI, -Math.PI / 2).map(([x, z]) => [x + 2, z])], ["an arc hugging the hill", arc(5, Math.PI * 1.2, -Math.PI * 0.6)]]) {
  for (const radius of [6, 3, 1.5]) {
    test(`an add stroke drawn as ${shape} of a steep hill at radius ${radius} lays clean ground`, () => {
      const { runtime, ctx, calls, session } = setup(20, steep);
      try {
        const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "add", brushRadius: radius };
        stroke(ctx, points, tool, steep);
        const after = inspect(runtime);
        probe("steep", shape, radius, JSON.stringify(calls.feedback.at(-1)), JSON.stringify(after));
        assert.equal(after.overlaps, 0, "no face lying over another");
        assert.equal(after.turned, 0, "no face turned over");
      } finally { session.free(); }
    });
  }
}

/** A hand's arc: sampled every few centimetres, wobbling, some samples repeated. */
const handArc = (radius, angle, start = 0, step = 0.08) => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const n = Math.ceil((radius * angle) / step);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (angle * i) / n, r = radius + rand() * 0.06;
    out.push([r * Math.cos(a) + rand() * 0.03, r * Math.sin(a) + rand() * 0.03]);
    if (i % 9 === 0) out.push(out.at(-1));
  }
  return out;
};
for (const [name, cells, height] of [["on empty table", 0, () => 0], ["over flat ground", 20, () => 0], ["on a steep hill", 20, steep]]) {
  for (const [shape, points] of [["a hand-drawn half circle", handArc(8, Math.PI)], ["a hand-drawn tight arc", handArc(3, Math.PI * 1.5, 0, 0.04)]]) {
    for (const radius of [6, 2]) {
      test(`an add stroke drawn as ${shape} ${name} at radius ${radius} lays clean ground (hand)`, () => {
        const { runtime, ctx, calls, session } = setup(cells, height);
        try {
          const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "add", brushRadius: radius };
          const started = performance.now();
          stroke(ctx, points, tool, height);
          const after = inspect(runtime);
          probe("hand", name, shape, radius, points.length, `${(performance.now() - started).toFixed(0)} ms`, JSON.stringify(calls.feedback.at(-1)), JSON.stringify(after));
          assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
          assert.equal(after.overlaps, 0, "no face lying over another");
          assert.equal(after.turned, 0, "no face turned over");
        } finally { session.free(); }
      });
    }
  }
}
