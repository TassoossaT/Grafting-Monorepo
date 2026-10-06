import assert from "node:assert/strict";
import test from "node:test";

import { capturePreviews, sessionFixture } from "./platform-session-fixture.mjs";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { pathBrushTool as roadTool } from "../src/composition/tabletop/tools/paths/path-brush-tool.ts";
import { commitPathCloudIntent } from "../src/composition/tabletop/path/path-cloud-transaction.ts";
import { commitPlatformContour } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { createPathBrushEffect, DEFAULT_TOOL_PARAMS, hasTrait, pathFormationFor } from "../src/features/edit-construction/index.ts";

/**
 * The ground grown back round structures on ground the brush laid, against
 * the real engine: a road over a hill dragged back and forth, one along its
 * flank and one across it, and floors on an earth bridge's deck and under it
 * -- once refused, or laid with faces metres long and a road's whole side
 * buried in the hill.
 */

function setup() {
  const fixture = capturePreviews(sessionFixture());
  const { runtime, session } = fixture;
  // The road tool reports what it picked; nothing here shows it.
  fixture.ctx.reportSelection = () => {};
  runtime.getFootprintCoverage = (polygon) => JSON.parse(session.footprint_coverage_json(JSON.stringify({ polygon }))).covered.map((entry) => ({
    ...entry,
    centroid: Array.isArray(entry.centroid) ? { x: entry.centroid[0], y: entry.centroid[1], z: entry.centroid[2] } : entry.centroid,
  }));
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

const groundOf = (runtime) => runtime.getAllRegionTopologies().filter((t) => hasTrait(t.surfaceType, "ground"));

/** Every sheet of ground over a point of the plane, lowest first. */
function sheetsAt(runtime, x, z) {
  const ys = [];
  for (const t of groundOf(runtime)) {
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
}

/** No edge held by three faces, and the ground's longest side. */
function meshOf(runtime) {
  const uses = new Map();
  for (const t of runtime.getAllRegionTopologies()) for (const use of [...t.outerLoops, ...t.holes].flat()) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
  let longest = 0;
  for (const t of groundOf(runtime)) {
    const at = new Map(t.nodes.map((n) => [n.id, n.position]));
    for (const use of t.outerLoops.flat()) {
      const a = at.get(use.startNodeId), b = at.get(use.endNodeId);
      longest = Math.max(longest, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  return { thrice: [...uses.values()].filter((n) => n > 2).length, longest };
}

function sculpt(fixture, from, to, params) {
  const n = Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.5));
  const samples = Array.from({ length: n + 1 }, (_, i) => {
    const x = from[0] + ((to[0] - from[0]) * i) / n, z = from[1] + ((to[1] - from[1]) * i) / n;
    return { point: { x, y: sheetsAt(fixture.runtime, x, z).at(-1) ?? 0, z } };
  });
  quiet(() => terrainSculptTool.onPointerUp(fixture.ctx, { start: samples[0], current: samples.at(-1), samples }, { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], ...params }));
  assert.equal(fixture.calls.feedback.at(-1)?.tone, "success", JSON.stringify(fixture.calls.feedback.at(-1)));
}

/** A road through plan points, each on the ground's top there -- or its lowest sheet. */
function road(fixture, plan) {
  const coordinates = plan.map(([x, z, sheet]) => {
    const ys = sheetsAt(fixture.runtime, x, z);
    return [x, (sheet === "low" ? ys[0] : ys.at(-1)) ?? 0, z];
  });
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

/** Drags the road end nearest `from` to `to`, on the ground there. */
function dragEnd(fixture, from, to) {
  const { runtime, ctx, calls } = fixture;
  const graph = runtime.getGraphSnapshot();
  const nodes = new Map(graph.nodes.map((n) => [n.id, n.position]));
  const ends = [...new Set(graph.edges.filter((e) => e.curve).flatMap((e) => [e.startNodeId, e.endNodeId]))];
  const away = (id) => Math.hypot(nodes.get(id).x - from[0], nodes.get(id).z - from[1]);
  const id = ends.sort((a, b) => away(a) - away(b))[0];
  const params = { ...roadTool.defaultParams(), bedWidth: 2 };
  const start = { point: { ...nodes.get(id) }, nodeId: id };
  const end = { point: { x: to[0], y: sheetsAt(runtime, to[0], to[1]).at(-1) ?? 0, z: to[1] } };
  const before = calls.feedback.length;
  quiet(() => {
    roadTool.onPointerDown(ctx, start, params);
    roadTool.onPointerMove(ctx, { start, current: end, samples: [start, end] }, params);
    roadTool.onPointerUp(ctx, { start, current: end, samples: [start, end] }, params);
  });
  const refused = calls.feedback.slice(before).filter((v) => v?.tone === "error");
  assert.equal(refused.length, 0, JSON.stringify(refused));
}

function platform(fixture, x, z, half, sheet) {
  const ys = sheetsAt(fixture.runtime, x, z);
  const y = (sheet === "low" ? ys[0] : ys.at(-1)) ?? 0;
  quiet(() => commitPlatformContour(fixture.ctx, [[-half, -half], [half, -half], [half, half], [-half, half]].map(([dx, dz]) => ({ point: { x: x + dx, y, z: z + dz } })), { mode: "create", elevation: y + 0.1, shape: "rectangle" }));
  assert.equal(fixture.calls.feedback.at(-1)?.tone, "success", JSON.stringify(fixture.calls.feedback.at(-1)));
}

test("a road over a hill keeps both its sides on the hill, and the ground round it grows back however it is dragged or crossed", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    sculpt(fixture, [-24, 0], [24, 0], { brushRadius: 12, elevationStep: 4 });
    road(fixture, [[0, -14], [0, 0], [0, 14]]);
    // Both sides of the road climb the hill: neither is one chord from foot to foot.
    const sides = runtime.getAllRegionTopologies().filter((t) => !hasTrait(t.surfaceType, "ground")).flatMap((t) => t.nodes.map((n) => n.position));
    for (const x of [-1, 1]) {
      const crest = sides.filter((p) => Math.abs(p.x - x) < 0.05 && Math.abs(p.z) < 2);
      assert.ok(crest.length > 0 && crest.every((p) => p.y > 3), `the side at x=${x} runs over the crest: ${crest.map((p) => p.y.toFixed(2))}`);
    }
    const steps = [
      () => dragEnd(fixture, [0, 14], [3, 14]),
      () => dragEnd(fixture, [3, 14], [6, 12]),
      () => dragEnd(fixture, [6, 12], [0, 14]),
      () => road(fixture, [[-14, 6], [-4, 6], [6, 6]]),
      () => road(fixture, [[-10, -4], [0, -2], [10, 0]]),
      () => road(fixture, [[-20, 10], [-10, 11], [0, 11]]),
    ];
    for (const step of steps) {
      step();
      const mesh = meshOf(runtime);
      assert.equal(mesh.thrice, 0, "one mesh");
      assert.ok(mesh.longest < 8, `no face metres long: ${mesh.longest.toFixed(2)}`);
    }
  } finally { fixture.session.free(); }
});

test("floors on an earth bridge's deck and under it, and a road under it, each cut only the ground they rest on", () => {
  const fixture = setup();
  try {
    const { runtime } = fixture;
    sculpt(fixture, [-20, 0], [20, 0], { brushRadius: 10 });
    sculpt(fixture, [-8, 0], [8, 0], { mode: "fill", brushRadius: 2, elevationStep: 6 });
    assert.ok(sheetsAt(runtime, 0, 0).length >= 3, "a hollow bridge");
    platform(fixture, 0, 0, 0.8);
    platform(fixture, 0, 0, 1, "low");
    road(fixture, [[0, -8, "low"], [0, 0, "low"], [0, 8, "low"]]);
    const mesh = meshOf(runtime);
    assert.equal(mesh.thrice, 0, "one mesh");
    assert.ok(mesh.longest < 8, `no face metres long: ${mesh.longest.toFixed(2)}`);
    assert.ok(sheetsAt(runtime, 0, 0).some((y) => y > 4 && y < 8), "the arch's underside stands");
  } finally { fixture.session.free(); }
});
