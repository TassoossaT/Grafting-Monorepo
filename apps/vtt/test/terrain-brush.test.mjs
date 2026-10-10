import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { pathBrushTool as roadTool } from "../src/composition/tabletop/tools/paths/path-brush-tool.ts";
import { commitPathCloudIntent } from "../src/composition/tabletop/path/path-cloud-transaction.ts";
import { createPathBrushEffect, DEFAULT_TOOL_PARAMS, hasTrait, pathFormationFor } from "../src/features/edit-construction/index.ts";

/**
 * The terrain brush, a terrain editor's (Flax's sculpt tools), against the
 * real engine: Adicionar, Remover, Suavizar, Aplainar and Ruído, with
 * strength, falloff and its kinds -- and a stroke over the ground's edge only
 * ever adds to it, never erases.
 */

function setup() {
  const fixture = sessionFixture();
  const { runtime, session } = fixture;
  // The engine's own coverage query: a road cuts the ground it covers.
  const coverage = (polygon) => JSON.parse(session.footprint_coverage_json(JSON.stringify({ polygon }))).covered.map((entry) => ({
    ...entry,
    centroid: Array.isArray(entry.centroid) ? { x: entry.centroid[0], y: entry.centroid[1], z: entry.centroid[2] } : entry.centroid,
  }));
  Object.assign(runtime, { showPreview() {}, clearPreview() {}, getFootprintCoverage: coverage });
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

/** Every sheet of ground over a point of the plane, lowest first. */
function sheetsAt(runtime, x, z) {
  const ys = [];
  for (const [a, b, c] of groundTriangles(runtime)) {
    const d = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((b.x - x) * (c.z - z) - (c.x - x) * (b.z - z)) / d, v = ((c.x - x) * (a.z - z) - (a.x - x) * (c.z - z)) / d, w = 1 - u - v;
    if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9) ys.push(u * a.y + v * b.y + w * c.y);
  }
  return ys.sort((a, b) => a - b);
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

/** A stroke over the ground's top, a sample every half metre. */
function stroke(fixture, from, to, params) {
  const n = Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.5));
  const samples = Array.from({ length: n + 1 }, (_, i) => {
    const x = from[0] + ((to[0] - from[0]) * i) / n, z = from[1] + ((to[1] - from[1]) * i) / n;
    return { point: { x, y: sheetsAt(fixture.runtime, x, z).at(-1) ?? 0, z } };
  });
  sculpt(fixture, samples, params);
}

/** Points of the plane with ground over them, a sample every metre. */
function covered(runtime, extent = 24) {
  const points = [];
  for (let x = -extent + 0.37; x < extent; x += 1) for (let z = -extent + 0.37; z < extent; z += 1) if (sheetsAt(runtime, x, z).length > 0) points.push([x, z]);
  return points;
}

const top = (runtime, x, z) => sheetsAt(runtime, x, z).at(-1);

test("Adicionar on the bare table rests ground on it, as high as asked, no wider than the brush", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    sculpt(fixture, [{ point: { x: 0, y: 0, z: 0 } }], { mode: "add", brushRadius: 4, elevationStep: 2 });
    assert.ok(Math.abs(top(runtime, 0, 0) - 2) < 0.25, `2 m high: ${top(runtime, 0, 0)}`);
    assert.equal(sheetsAt(runtime, 6, 0).length, 0, "no wider than the brush");
  } finally { fixture.session.free(); }
});

for (const [label, radius, height] of [["a low stroke", 4, 2], ["a stroke taller than it is wide", 2, 4]]) {
  test(`${label} over the ground's edge onto the bare table only ever adds ground: nothing it covered goes`, () => {
    const fixture = setup();
    try {
      const { runtime } = fixture;
      stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 8, elevationStep: 2 });
      const before = covered(runtime);
      const along = [[2, 0], [6, 0], [10, 0]].map(([x, z]) => [x, z, top(runtime, x, z) ?? 0]);
      // Across the edge, along it, a click on it, and a drag in from the bare table.
      stroke(fixture, [0, 0], [12, 0], { mode: "add", brushRadius: radius, elevationStep: height });
      stroke(fixture, [7, -7], [7, 7], { mode: "add", brushRadius: radius, elevationStep: height });
      stroke(fixture, [-7.6, -2], [-7.6, -2], { mode: "add", brushRadius: radius, elevationStep: height });
      stroke(fixture, [-14, 8], [-2, 2], { mode: "add", brushRadius: radius, elevationStep: height });
      const after = new Set(covered(runtime).map(([x, z]) => `${x}:${z}`));
      assert.deepEqual(before.filter(([x, z]) => !after.has(`${x}:${z}`)), [], "every point that had ground still has it");
      for (const [x, z, was] of along) assert.ok((top(runtime, x, z) ?? 0) > was + 0.5, `added to where it ran, at ${x}: ${top(runtime, x, z)} over ${was}`);
    } finally { fixture.session.free(); }
  });
}

test("Remover along flat ground lays a trench as deep as asked", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 14, elevationStep: 3 });
    const was = [-2, 2].map((x) => top(runtime, x, 0));
    stroke(fixture, [-4, 0], [4, 0], { mode: "dig", brushRadius: 3, elevationStep: 1.5, falloff: 0.5 });
    [-2, 2].forEach((x, k) => assert.ok(Math.abs(was[k] - top(runtime, x, 0) - 1.5) < 0.3, `1.5 m down at ${x}: ${was[k]} -> ${top(runtime, x, 0)}`));
  } finally { fixture.session.free(); }
});

test("the falloff type shapes the stroke between its middle and its rim: a dome over a ramp over a spike", () => {
  const heights = {};
  for (const falloffType of ["spherical", "linear", "tip"]) {
    const fixture = setup();
    try {
      stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 14, elevationStep: 0.5, falloff: 0 });
      const base = top(fixture.runtime, 4.5, 0);
      stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 6, elevationStep: 2, falloff: 0.5, falloffType });
      heights[falloffType] = top(fixture.runtime, 4.5, 0) - base;
    } finally { fixture.session.free(); }
  }
  assert.ok(heights.spherical > heights.linear + 0.2 && heights.linear > heights.tip + 0.2, JSON.stringify(heights));
});

test("Suavizar takes a ridge most of the way down, the ground past the brush as it was", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 16, elevationStep: 0.5, falloff: 0 });
    stroke(fixture, [-6, 0], [6, 0], { mode: "add", brushRadius: 1.5, elevationStep: 2.5, falloff: 0.3 });
    const ridge = top(runtime, 0, 0), beside = top(runtime, 0, 3), far = top(runtime, 0, 12);
    stroke(fixture, [-6, 0], [6, 0], { mode: "smooth", brushRadius: 5, strength: 1, falloff: 0.3, filterRadius: 0.8 });
    assert.ok(top(runtime, 0, 0) < ridge - 1, `the ridge comes down: ${ridge} -> ${top(runtime, 0, 0)}`);
    assert.ok(top(runtime, 0, 3) > beside, `the ground beside it comes up: ${beside} -> ${top(runtime, 0, 3)}`);
    assert.ok(Math.abs(top(runtime, 0, 12) - far) < 1e-6, "past the brush untouched");
  } finally { fixture.session.free(); }
});

test("Aplainar at half strength takes a mound halfway down to the height the stroke starts at", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 16, elevationStep: 0.5, falloff: 0 });
    stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 5, elevationStep: 3, falloff: 0.5 });
    const level = top(runtime, -10, 0), peak = top(runtime, 0, 0);
    stroke(fixture, [-10, 0], [10, 0], { mode: "flatten", brushRadius: 4, strength: 0.5, falloff: 0, elevationStep: 4 });
    const now = top(runtime, 0, 0);
    assert.ok(Math.abs(now - (level + peak) / 2) < 0.35, `halfway from ${peak} to ${level}: ${now}`);
  } finally { fixture.session.free(); }
});

test("Ruído roughens level ground under the brush only", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 16, elevationStep: 0.5, falloff: 0 });
    const far = top(runtime, 0, 12);
    stroke(fixture, [-5, 0], [5, 0], { mode: "noise", brushRadius: 4, strength: 1, falloff: 0.2, heightScale: 1.5, noiseScale: 0.5 });
    const inside = [-4, -2, 0, 2, 4].flatMap((x) => [-1, 1].map((z) => top(runtime, x, z)));
    const spread = Math.max(...inside) - Math.min(...inside);
    assert.ok(spread > 0.4, `rough under the brush: ${inside.map((y) => y.toFixed(2))}`);
    assert.ok(Math.abs(top(runtime, 0, 12) - far) < 1e-6, "past it untouched");
  } finally { fixture.session.free(); }
});

/** Where a ray from the side, level at `y` along +x at `z`, first meets the ground: the cliff's face there. */
const faceAt = (runtime, y, z = 0) => pointerAt(runtime, [-40, y, z], [40, y, z]);

/** A cliff: a plateau `height` high and `radius` round at the origin, its flank near upright. */
function cliff(fixture, radius = 6, height = 8) {
  sculpt(fixture, [{ point: { x: 0, y: 0, z: 0 } }], { mode: "add", brushRadius: radius, elevationStep: height, falloff: 0.2 });
}

test("Adicionar painted on a cliff's flank grows it out sideways -- painted again on the tip, a ledge with nothing under it", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    cliff(fixture);
    const before = faceAt(runtime, 5).point.x;
    for (let k = 0; k < 4; k++) sculpt(fixture, [faceAt(runtime, 5)], { mode: "add", brushRadius: 2, elevationStep: 1.5 });
    const after = faceAt(runtime, 5).point.x;
    assert.ok(after < before - 1, `the flank at 5 m came out from ${before.toFixed(2)} to ${after.toFixed(2)}`);
    // A ledge: ground over a point past the old foot, with no ground under it down to the table.
    const x = before - 2;
    const sheets = sheetsAt(runtime, x, 0);
    assert.ok(sheets.length >= 2 && sheets[0] > 1, `a ledge over the bare table at x ${x.toFixed(2)}: ${sheets.map((y) => y.toFixed(2))}`);
  } finally { fixture.session.free(); }
});

test("Remover painted on a cliff's flank digs into it sideways -- dug again, a hole on into the hill", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    cliff(fixture);
    const before = faceAt(runtime, 4).point.x;
    for (let k = 0; k < 4; k++) sculpt(fixture, [faceAt(runtime, 4)], { mode: "dig", brushRadius: 2, elevationStep: 1.5 });
    const after = faceAt(runtime, 4).point.x;
    assert.ok(after > before + 2, `the flank at 4 m went in from ${before.toFixed(2)} to ${after.toFixed(2)}`);
    // The hill still stands over the hole: ground over it above, and under it below.
    const sheets = sheetsAt(runtime, before + 1.5, 0);
    assert.ok(sheets.length >= 3, `the hill over the hole and its floor under it: ${sheets.map((y) => y.toFixed(2))}`);
    assert.ok(Math.abs(top(runtime, 0, 0) - 8) < 0.5, `the plateau's top stays where it was: ${top(runtime, 0, 0)}`);
  } finally { fixture.session.free(); }
});
