import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { DEFAULT_TOOL_PARAMS, hasTrait } from "../src/features/edit-construction/index.ts";

/**
 * The terrain brush clicked at random, against the real engine: every mode,
 * size, height, strength, falloff and kind, wherever the pointer lands on
 * the ground or the bare table, seen from above or from the side -- a brush
 * on a wall pushes out of it. Every stroke goes through -- the owner,
 * clicking at random, had strokes refused with "no room on edge" (a face
 * folded in plan by an older stroke, left beside the next one's patch).
 * `SEEDS=1,2,...` picks the runs.
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

/** The ground's nodes where two fans of faces meet at a point only: two sheets touching there. */
function pinchedGround(runtime) {
  const links = new Map();
  for (const face of runtime.getAllRegionTopologies()) {
    if (!hasTrait(face.surfaceType, "ground")) continue;
    const ring = (face.outerLoops[0] ?? []).map((use) => use.startNodeId);
    ring.forEach((node, k) => links.set(node, [...(links.get(node) ?? []), [ring[(k + ring.length - 1) % ring.length], ring[(k + 1) % ring.length]]]));
  }
  const pinched = new Set();
  for (const [node, list] of links) {
    const fan = new Array(list.length).fill(-1);
    let fans = 0;
    for (let start = 0; start < list.length; start++) {
      if (fan[start] !== -1) continue;
      fan[start] = fans;
      const stack = [start];
      while (stack.length) {
        const i = stack.pop();
        for (let j = 0; j < list.length; j++) if (fan[j] === -1 && list[j].some((u) => list[i].includes(u))) { fan[j] = fans; stack.push(j); }
      }
      fans++;
    }
    if (fans > 1) pinched.add(node);
  }
  return pinched;
}

/** One click of the brush; the tool's feedback. */
function click({ ctx, calls }, sample, params) {
  quiet(() => terrainSculptTool.onPointerUp(ctx, { start: sample, current: sample, samples: [sample] }, { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], ...params }));
  return calls.feedback.at(-1);
}

const MODES = ["add", "add", "add", "dig", "smooth", "flatten", "noise"];
const KINDS = ["smooth", "linear", "spherical", "tip"];
/** How long a click may take, in milliseconds. */
const SLOWEST = 3000;

for (const seed of (process.env.SEEDS ?? "1,2,3,4").split(",").map(Number)) {
  test(`120 random clicks of the brush all go through (seed ${seed})`, () => {
    const fixture = setup();
    let state = seed * 7919;
    const rand = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
    const refused = [];
    let pinched = pinchedGround(fixture.runtime);
    try {
      for (let k = 0; k < 120; k += 1) {
        const mode = MODES[Math.floor(rand() * MODES.length)];
        const x = (rand() - 0.5) * 24, z = (rand() - 0.5) * 24;
        // From above, or from the side, low -- a click on a hill's flank, a cliff, under a ledge.
        const sideways = rand() < Number(process.env.SIDE ?? 0.5);
        const sample = (sideways
          ? pointerAt(fixture.runtime, [x - 30, 1 + rand() * 6, z + 3], [x, 1 + rand() * 6, z])
          : pointerAt(fixture.runtime, [x + 3, 30, z + 4], [x, 0, z])) ?? { point: { x, y: 0, z } };
        const params = { mode, brushRadius: 1 + rand() * 6, elevationStep: 0.5 + rand() * 5, strength: rand(), falloff: rand(), falloffType: KINDS[Math.floor(rand() * KINDS.length)] };
        const started = Date.now();
        const feedback = click(fixture, sample, params);
        // The ground stays a surface: no stroke leaves two sheets touching at a point.
        const now = pinchedGround(fixture.runtime);
        const touching = [...now].filter((node) => !pinched.has(node));
        if (touching.length > 0) refused.push(`${k} ${mode}: two sheets of ground touching at ${touching.length} point(s)`);
        pinched = now;
        // Nothing to take away on the bare table is no refusal.
        if (feedback?.tone !== "success" && !/^Nada a/.test(feedback?.message ?? "")) refused.push(`${k} ${JSON.stringify(params)} at ${x.toFixed(2)},${z.toFixed(2)}: ${feedback?.message}`);
        if (Date.now() - started > SLOWEST) refused.push(`${k} ${mode} took ${Date.now() - started} ms`);
      }
      assert.deepEqual(refused, []);
    } finally { fixture.session.free(); }
  });
}
