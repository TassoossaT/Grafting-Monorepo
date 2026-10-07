import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { pathBrushTool as roadTool } from "../src/composition/tabletop/tools/paths/path-brush-tool.ts";
import { commitPathCloudIntent } from "../src/composition/tabletop/path/path-cloud-transaction.ts";
import { createPathBrushEffect, DEFAULT_TOOL_PARAMS, hasTrait, pathFormationFor } from "../src/features/edit-construction/index.ts";

/**
 * The terrain brush's ball, against the real engine: added and dug on the bare
 * table, on flat ground, on a hillside and into it -- one tool for both, never erasing:
 * so a ball rolled over the ground's edge only ever adds to it.
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

test("a ball added on the bare table rests ground on it, as high as asked; dug there it does nothing", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    sculpt(fixture, [{ point: { x: 0, y: 0, z: 0 } }], { mode: "add", brushRadius: 4, elevationStep: 2 });
    const top = sheetsAt(runtime, 0, 0).at(-1);
    assert.ok(Math.abs(top - 2) < 0.25, `a cap of earth 2 m high: ${top}`);
    assert.equal(sheetsAt(runtime, 6, 0).length, 0, "no wider than the ball where it meets the table");
  } finally { fixture.session.free(); }
});

for (const [label, radius, height] of [["a cap", 4, 2], ["a whole ball", 2, 3.4]]) {
  test(`${label} rolled across the ground's edge onto the bare table only ever adds ground: nothing it covered goes`, () => {
    const fixture = setup();
    try {
      const { runtime } = fixture;
      stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 8, elevationStep: 2 });
      const before = covered(runtime);
      const heightBefore = (x, z) => sheetsAt(runtime, x, z).at(-1) ?? 0;
      const along = [[2, 0], [6, 0], [10, 0], [14, 0]].map(([x, z]) => [x, z, heightBefore(x, z)]);
      // Along the edge too, round it.
      stroke(fixture, [0, 0], [14, 0], { mode: "add", brushRadius: radius, elevationStep: height });
      stroke(fixture, [7, -7], [7, 7], { mode: "add", brushRadius: radius, elevationStep: height });
      // A click on the edge itself, and a drag in from the bare table.
      stroke(fixture, [-4.6, -2], [-4.6, -2], { mode: "add", brushRadius: radius, elevationStep: height });
      stroke(fixture, [-12, 8], [-2, 2], { mode: "add", brushRadius: radius, elevationStep: height });
      const after = new Set(covered(runtime).map(([x, z]) => `${x}:${z}`));
      assert.deepEqual(before.filter(([x, z]) => !after.has(`${x}:${z}`)), [], "every point that had ground still has it");
      for (const [x, z, was] of along) assert.ok((sheetsAt(runtime, x, z).at(-1) ?? 0) > was + 0.5, `added to where it rolled, at ${x}: ${sheetsAt(runtime, x, z).at(-1)} over ${was}`);
    } finally { fixture.session.free(); }
  });
}

test("a ball set on a hillside's flank stands out of it sideways", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 12, elevationStep: 10 });
    // Pointed at the flank level from the side: the ball stands out of the slope, not up.
    const sample = pointerAt(runtime, [30, 3, 0.01], [0, 3, 0.01]);
    assert.ok(sample, "the pointer meets the flank");
    const flank = sample.point.x;
    sculpt(fixture, [sample], { mode: "add", brushRadius: 2.5, elevationStep: 4.5 });
    const out = pointerAt(runtime, [30, 3, 0.01], [0, 3, 0.01]);
    assert.ok(out && out.point.x > flank + 1.5, `the flank comes out to meet the pointer sooner: ${flank.toFixed(2)} -> ${out?.point.x.toFixed(2)}`);
  } finally { fixture.session.free(); }
});

test("balls dug into a hillside one after another bore a tunnel into it", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 14, elevationStep: 12 });
    const dug = [];
    for (let ball = 0; ball < 4; ball++) {
      // Each ball set where the pointer now meets the hill: the back of the hole the last one dug.
      const sample = pointerAt(runtime, [30, 3.5, 0.01], [0, 3.5, 0.01]);
      assert.ok(sample, `the pointer meets the hill for ball ${ball + 1}`);
      dug.push(sample.point.x);
      sculpt(fixture, [sample], { mode: "dig", brushRadius: 1.8, elevationStep: 3.2 });
    }
    assert.ok(dug.every((x, k) => k === 0 || x < dug[k - 1] - 0.5), `each ball reaches further in: ${dug.map((x) => x.toFixed(1))}`);
    // Along the way in, the hill stands over the hole: a floor, a ceiling and the hill's top.
    const roofed = dug.slice(1).filter((x) => sheetsAt(runtime, x, 0.01).length >= 3);
    assert.ok(roofed.length >= 2, `roofed over along the way in: ${dug.map((x) => sheetsAt(runtime, x, 0.01).map((y) => y.toFixed(1)).join("/"))}`);
  } finally { fixture.session.free(); }
});

test("a ball dug along flat ground lays a trench as deep as asked", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    stroke(fixture, [0, 0], [0, 0], { mode: "add", brushRadius: 14, elevationStep: 3 });
    const was = [-2, 2].map((x) => sheetsAt(runtime, x, 0).at(-1));
    stroke(fixture, [-4, 0], [4, 0], { mode: "dig", brushRadius: 3, elevationStep: 1.5 });
    [-2, 2].forEach((x, k) => {
      const now = sheetsAt(runtime, x, 0).at(-1);
      assert.ok(Math.abs(was[k] - now - 1.5) < 0.3, `1.5 m down at ${x}: ${was[k]} -> ${now}`);
    });
  } finally { fixture.session.free(); }
});
