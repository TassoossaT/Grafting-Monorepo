import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";

/**
 * How much ground a cut's regeneration lays back, against the real engine.
 *
 * Each floor cut into the ground used to lay its repair into the strip left
 * between the floor and the faces round it -- one or two faces wide, every
 * standing node a corner the generator had to keep -- and came back with 1.6
 * faces for every one that fits there. The next cut inherited that rim, so
 * five floors side by side took the ground from 4 m² a face to 2.6 and added
 * 84 faces while removing ground. These hold the repair to the ground it
 * replaces: wide enough to lay in, at the size of the faces around it.
 *
 * `PROBE=1` prints the counts behind each assertion.
 */

const probe = process.env.PROBE === "1" ? (...line) => console.log(...line) : () => {};

/** Square ground of `cells` x `cells` faces `cell` wide, centred on the origin, wound as generated ground winds. */
function ground(runtime, session, cell, cells, heightAt = () => 0) {
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

function setup(cell, cells, heightAt) {
  const fixture = sessionFixture();
  // The engine's own coverage query, as the table has it: without it a face
  // counts as cut only when its middle is under the floor, so a floor smaller
  // than one face never cuts it at all.
  const coverage = (polygon) => JSON.parse(fixture.session.footprint_coverage_json(JSON.stringify({ polygon }))).covered;
  Object.assign(fixture.runtime, { showPreview() {}, clearPreview() {}, getFootprintCoverage: coverage });
  ground(fixture.runtime, fixture.session, cell, cells, heightAt);
  return fixture;
}

const terrain = (runtime) => runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "terrain");

function planArea(topology) {
  const at = new Map(topology.nodes.map((n) => [n.id, n.position]));
  const ring = (topology.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId));
  let twice = 0;
  for (let i = 0; i < ring.length; i++) twice += ring[i].x * ring[(i + 1) % ring.length].z - ring[(i + 1) % ring.length].x * ring[i].z;
  return Math.abs(twice) / 2;
}

/** Faces, and plan area per face, of the ground standing now. */
function density(runtime) {
  const faces = terrain(runtime);
  return { faces: faces.length, perFace: faces.reduce((sum, t) => sum + planArea(t), 0) / faces.length };
}

/** Whether some ground face stands with its middle inside the box, in plan. */
const groundUnder = (runtime, [x0, z0, x1, z1]) => terrain(runtime).some((t) => {
  const x = t.nodes.reduce((s, n) => s + n.position.x, 0) / t.nodes.length, z = t.nodes.reduce((s, n) => s + n.position.z, 0) / t.nodes.length;
  return x > x0 && x < x1 && z > z0 && z < z1;
});

function floorAt(ctx, [x0, z0, x1, z1], y) {
  const info = console.info, warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    commitPlatformContour(ctx, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => ({ point: { x, y, z } })), { mode: "create", elevation: y, shape: "rectangle" });
  } finally {
    console.info = info;
    console.warn = warn;
  }
}

/** Five floors resting on flat ground, off its grid lines, the last between two others. */
const FLOORS = [[-9.3, -1.7, -5.7, 1.7], [-4.7, -1.7, -1.1, 1.7], [-0.3, -1.7, 3.3, 1.7], [4.1, -1.7, 7.7, 1.7], [-4.7, 2.5, -1.1, 5.9]];

test("floors cut one after another into 2 m ground keep it near 2 m and cut every one of them", () => {
  const { runtime, ctx, calls, session } = setup(2, 14);
  try {
    const start = density(runtime);
    probe("start", start);
    for (const box of FLOORS) {
      floorAt(ctx, box, 0.1);
      assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
      const [x0, z0, x1, z1] = box;
      assert.ok(!groundUnder(runtime, [x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2]), `no ground left under ${JSON.stringify(box)}`);
      probe("after", box, density(runtime));
    }
    const end = density(runtime);
    // Before: 280 faces at 2.58 m² -- 84 more faces for ground that shrank.
    assert.ok(end.faces <= start.faces + 40, `five floors add at most 40 faces: ${start.faces} -> ${end.faces}`);
    assert.ok(end.perFace >= 3.0, `the ground stays near its own size: ${end.perFace.toFixed(2)} m² a face`);
  } finally { session.free(); }
});

test("a small floor cut into coarse ground is laid back at that ground's size, never at 2 m", () => {
  const { runtime, ctx, calls, session } = setup(6, 6);
  try {
    const start = density(runtime);
    floorAt(ctx, [-1.6, -1.4, 1.4, 1.6], 0.1);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const floor = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform");
    const corners = new Set(floor.nodes.map((n) => n.id));
    assert.ok(terrain(runtime).some((t) => t.nodes.some((n) => corners.has(n.id))), "the ground was cut round the floor and meets it");
    assert.ok(!groundUnder(runtime, [-1.4, -1.2, 1.2, 1.4]), "and none is left under it");
    const end = density(runtime);
    probe("coarse", start, end);
    // At 2 m the four 6 m faces this touches came back as dozens.
    assert.ok(end.faces <= start.faces + 20, `${start.faces} -> ${end.faces}`);
  } finally { session.free(); }
});
