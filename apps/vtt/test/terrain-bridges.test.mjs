import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { pathBrushTool as roadTool } from "../src/composition/tabletop/tools/paths/path-brush-tool.ts";
import { commitPathCloudIntent } from "../src/composition/tabletop/path/path-cloud-transaction.ts";
import { createPathBrushEffect, DEFAULT_TOOL_PARAMS, hasTrait, pathFormationFor } from "../src/features/edit-construction/index.ts";

/**
 * Earth bridges against the real engine: one built ball by ball from both
 * ends, which closed into a wall and refused the balls laid on it, and roads
 * laid under one and over it, the second refused whichever came first.
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

test("an arch built ball by ball from both ends stays hollow once closed, and takes balls laid on it", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    stroke(fixture, [0, 0], [0, 0], { brushRadius: 26 });
    const base = sheetsAt(runtime, 0, 0).at(-1);
    const arc = (degrees, side) => [side * 18 * Math.cos((degrees * Math.PI) / 180), base + 18 * Math.sin((degrees * Math.PI) / 180), 0];
    // Each ball set on the side of the last one that faces where the arch
    // goes on -- a ball's width further round each time; where the pointer
    // finds no ground the step is passed over, as a missed click.
    for (const side of [-1, 1]) {
      let last;
      for (let degrees = 180; degrees > 91; degrees -= (6 / 18) * (180 / Math.PI) * 1.1) {
        const at = arc(degrees, side);
        const sample = last ? pointerAt(runtime, at, last) : pointerAt(runtime, [at[0], at[1] + 20, 0.01], at);
        if (sample) sculpt(fixture, [sample], { mode: "fill", brushRadius: 6 });
        last = at;
      }
    }
    sculpt(fixture, [pointerAt(runtime, [0, base + 30, 0.01], [0, base, 0])], { mode: "fill", brushRadius: 6 });
    const middle = sheetsAt(runtime, 0, 0);
    assert.ok(middle.length >= 3, `ground, underside and top over the middle: ${middle.map((y) => y.toFixed(1))}`);
    for (const x of [-6, 6]) sculpt(fixture, [pointerAt(runtime, [x, base + 40, 6], [x, base + 10, 0])], { mode: "fill", brushRadius: 6 });
    assert.ok(sheetsAt(runtime, 0, 0).length >= 3, "still hollow");
  } finally { fixture.session.free(); }
});

function road(fixture, coordinates) {
  const curves = fixture.runtime.curveBatch({ tolerance: 0.025, commands: [{ kind: "automatic", points: coordinates }] })[0].curves;
  const effect = createPathBrushEffect({
    brushShape: { kind: "circle", radius: 0.025 },
    brushRegion: { samples: coordinates.map(([x, y, z]) => ({ x, y, z })) },
    authoredCurves: curves,
    curveMode: "automatic",
    parameters: pathFormationFor({ ...roadTool.defaultParams(), bedWidth: 2 }),
  }, { operationId: `t:road:${fixture.ctx.nextSequence()}`, tableId: fixture.ctx.tableId, initiatedBy: "test" });
  assert.ok(quiet(() => commitPathCloudIntent(fixture.ctx, effect, 0.025)), JSON.stringify(fixture.calls.feedback.at(-1)));
}

for (const order of [["under", "over"], ["over", "under"], ["across", "over"]]) {
  test(`roads laid ${order.join(" then ")} an earth bridge both lay, each cutting only the ground it rests on`, () => {
    const fixture = setup();
    try {
      const { runtime } = fixture;
      stroke(fixture, [-20, 0], [20, 0], { brushRadius: 10 });
      stroke(fixture, [-8, 0], [8, 0], { mode: "fill", brushRadius: 2, elevationStep: 6 });
      assert.ok(sheetsAt(runtime, 0, 0).length >= 3, "a hollow bridge");
      const deck = (x) => sheetsAt(runtime, x, 0).at(-1), floor = (x, z) => sheetsAt(runtime, x, z)[0];
      for (const which of order) {
        if (which === "over") road(fixture, [-4, -2, 0, 2, 4].map((x) => [x, deck(x), 0]));
        if (which === "under") road(fixture, [-3, 0, 3].map((x) => [x, floor(x, 0), 0]));
        if (which === "across") road(fixture, [-8, 0, 8].map((z) => [0, floor(0, z), z]));
      }
      // The arch's underside still stands between the two roads.
      const left = sheetsAt(runtime, 0, 0);
      assert.ok(left.some((y) => y > 4 && y < 8), `the underside stands: ${left.map((y) => y.toFixed(1))}`);
    } finally { fixture.session.free(); }
  });
}
