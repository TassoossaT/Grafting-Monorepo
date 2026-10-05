import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { shownGlobalHandles } from "../src/features/edit-construction/index.ts";

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
    const after = [];
    for (const box of FLOORS) {
      floorAt(ctx, box, 0.1);
      assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
      const [x0, z0, x1, z1] = box;
      assert.ok(!groundUnder(runtime, [x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2]), `no ground left under ${JSON.stringify(box)}`);
      after.push(density(runtime));
      probe("after", box, after.at(-1));
    }
    // Before: 280 faces at 2.58 m² -- 84 more faces for ground that shrank.
    // The four on open ground:
    assert.ok(after[3].faces <= start.faces + 30, `four floors on open ground add at most 30 faces: ${start.faces} -> ${after[3].faces}`);
    // The fifth stands 0.8 m from the second: the ground in that gap can only
    // be laid in faces no wider than the gap, so it is counted apart.
    assert.ok(after[4].perFace >= 2.9, `the ground stays near its own size: ${after[4].perFace.toFixed(2)} m² a face`);
  } finally { session.free(); }
});

test("a small floor cut into coarse ground is laid back at that ground's size, never at 2 m", () => {
  const { runtime, ctx, calls, session } = setup(6, 6);
  try {
    const start = density(runtime);
    floorAt(ctx, [-1.6, -1.4, 1.4, 1.6], 0.1);
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const floor = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform");
    const ground = terrain(runtime).flatMap((t) => t.nodes.map((n) => n.position));
    const met = floor.nodes.filter((c) => ground.some((p) => Math.hypot(p.x - c.position.x, p.y - c.position.y, p.z - c.position.z) < 1e-3));
    assert.equal(met.length, 4, "the ground was cut round the floor and comes up to every corner");
    assert.ok(!groundUnder(runtime, [-1.4, -1.2, 1.2, 1.4]), "and none is left under it");
    const end = density(runtime);
    probe("coarse", start, end);
    // At 2 m the four 6 m faces this touches came back as dozens.
    assert.ok(end.faces <= start.faces + 20, `${start.faces} -> ${end.faces}`);
  } finally { session.free(); }
});

/** Drags `handle` along x by `dx`, in steps, as the pointer does, and lets go. */
function dragAlongX(ctx, handle, dx) {
  const params = platformContourTool.defaultParams();
  const info = console.info, warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
    platformContourTool.onPointerDown(ctx, start, params);
    const samples = [start];
    let last = start;
    for (let step = 1; step <= 6; step += 1) {
      last = { point: { ...handle.position, x: handle.position.x + (dx * step) / 6 }, screenX: 100 + step * 10, screenY: 300 };
      samples.push(last);
      platformContourTool.onPointerMove(ctx, { start, current: last, samples }, params);
    }
    platformContourTool.onPointerUp(ctx, { start, current: last, samples }, params);
  } finally {
    console.info = info;
    console.warn = warn;
  }
}

const handlesOf = (runtime) => shownGlobalHandles({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (q) => runtime.cloudFor(q) });
const platformOf = (runtime) => runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform");

// Each edit used to lay its repair against the dense rim the edit before had
// left, two fills per edit pressing on each other's fresh rims, and nothing
// ever coarsened it again: a floor moved back and forth took the ground round
// it from 202 faces to 257 in eight moves, and resized by its side it split
// its own sides until the side handle grabbed a sliver and refused.
test("a floor moved back and forth again and again leaves the ground round it no denser", () => {
  const { runtime, ctx, calls, session } = setup(2, 14);
  try {
    floorAt(ctx, [-2.3, -1.7, 2.3, 1.7], 0.1);
    const created = density(runtime).faces;
    const counts = [];
    for (let move = 0; move < 8; move += 1) {
      dragAlongX(ctx, handlesOf(runtime).find((h) => h.kind === "pivot"), move % 2 === 0 ? 1.3 : -1.3);
      assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
      assert.equal(platformOf(runtime).nodes.length, 4, "its four corners after every move");
      counts.push(density(runtime).faces);
    }
    probe("moves", created, counts);
    assert.ok(counts.every((faces) => Math.abs(faces - created) <= 15), `the ground's face count holds: ${created} -> ${counts.join(", ")}`);
  } finally { session.free(); }
});

test("a floor resized by its side again and again keeps its four corners and the ground round it no denser", () => {
  const { runtime, ctx, calls, session } = setup(2, 14);
  try {
    floorAt(ctx, [-2.3, -1.7, 2.3, 1.7], 0.1);
    const created = density(runtime).faces;
    const counts = [];
    for (let resize = 0; resize < 10; resize += 1) {
      const east = Math.max(...platformOf(runtime).nodes.map((n) => n.position.x));
      const side = handlesOf(runtime).filter((h) => h.kind === "side" && h.owner === "platform" && h.position.x > east)[0];
      assert.ok(side, `an east side handle before resize ${resize + 1}`);
      dragAlongX(ctx, side, resize % 2 === 0 ? 2 : -2);
      assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
      assert.equal(platformOf(runtime).nodes.length, 4, "its four corners after every resize");
      counts.push(density(runtime).faces);
    }
    probe("resizes", created, counts);
    assert.ok(counts.every((faces) => Math.abs(faces - created) <= 25), `the ground's face count holds: ${created} -> ${counts.join(", ")}`);
  } finally { session.free(); }
});
