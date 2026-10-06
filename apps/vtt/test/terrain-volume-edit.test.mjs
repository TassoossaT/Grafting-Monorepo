import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { DEFAULT_TOOL_PARAMS, hasTrait } from "../src/features/edit-construction/index.ts";

/**
 * Carving into the ground and filling it in, in three dimensions, through
 * the terrain brush, against the real engine: the ground stays one mesh of
 * ground -- no other type, no edge held by three faces, no border open but
 * the map's own -- and holds a tunnel or a bridge.
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

function setup(heightAt, cells = 20) {
  const fixture = sessionFixture();
  const coverage = (polygon) => JSON.parse(fixture.session.footprint_coverage_json(JSON.stringify({ polygon }))).covered;
  Object.assign(fixture.runtime, { showPreview() {}, clearPreview() {}, getFootprintCoverage: coverage });
  ground(fixture.runtime, fixture.session, 2, cells, heightAt);
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

const drag = ([ax, az], [bx, bz]) => {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
  return Array.from({ length: n + 1 }, (_, i) => [ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
};

/** Edge uses over the whole ground, and the edges on the map's own border before any edit. */
function edgeUses(runtime) {
  const uses = new Map();
  for (const t of runtime.getAllRegionTopologies()) for (const use of t.outerLoops.flat()) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
  return uses;
}

/** What every edit promises: one mesh of ground, closed but at the map's border. */
function assertOneMeshOfGround(runtime, border) {
  const all = runtime.getAllRegionTopologies();
  assert.ok(all.every((t) => hasTrait(t.surfaceType, "ground")), "nothing but ground: no layer beside it");
  const uses = edgeUses(runtime);
  const thrice = [...uses.values()].filter((n) => n > 2).length;
  const open = [...uses].filter(([edgeId, n]) => n === 1 && !border.has(edgeId)).length;
  probe("faces", all.length, "edges held by three", thrice, "open edges off the map border", open);
  assert.equal(thrice, 0, "no edge held by three faces");
  assert.equal(open, 0, "no open border but the map's own");
}

const borderOf = (runtime) => new Set([...edgeUses(runtime)].filter(([, n]) => n === 1).map(([edgeId]) => edgeId));

test("a carve pushed through the hill leaves one mesh of ground with a tunnel in it", () => {
  const { runtime, ctx, calls, session } = setup(hill);
  try {
    const border = borderOf(runtime);
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "carve", brushRadius: 1.8, faceSize: 2 };
    const started = performance.now();
    stroke(ctx, drag([-14, 0], [14, 0]), { tool, heightAt: hill });
    probe("carve ms", (performance.now() - started).toFixed(0), calls.feedback.at(-1));
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    assertOneMeshOfGround(runtime, border);
    const over = runtime.getAllRegionTopologies().flatMap((t) => t.nodes).filter((n) => Math.abs(n.position.x) < 1.5 && Math.abs(n.position.z) < 0.8).map((n) => n.position.y);
    const axis = hill(-14, 0) + 1.8 * 1.05;
    probe("heights over the middle", [...new Set(over.map((y) => y.toFixed(1)))].sort().join(" "));
    assert.ok(over.some((y) => y < axis - 1.2), "a floor under the tunnel's axis");
    assert.ok(over.some((y) => y > axis + 1.2 && y < axis + 2.6), "a ceiling over it");
    assert.ok(over.some((y) => y > 5), "the hill still stands over it");
  } finally { session.free(); }
});

test("a second carve into the first edits the same mesh again", () => {
  const { runtime, ctx, calls, session } = setup(hill);
  try {
    const border = borderOf(runtime);
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "carve", brushRadius: 1.6, faceSize: 2 };
    stroke(ctx, drag([-14, 0], [2, 0]), { tool, heightAt: hill });
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    stroke(ctx, drag([0, -14], [0, 0]), { tool, heightAt: hill });
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    assertOneMeshOfGround(runtime, border);
  } finally { session.free(); }
});

test("a fill from bank to bank over flat ground leaves one mesh of ground with a bridge in it", () => {
  const flat = () => 0;
  const { runtime, ctx, calls, session } = setup(flat, 16);
  try {
    const border = borderOf(runtime);
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "fill", brushRadius: 1.2, faceSize: 2, elevationStep: 3 };
    stroke(ctx, drag([-9, 0], [9, 0]), { tool, heightAt: flat });
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    assertOneMeshOfGround(runtime, border);
    const top = Math.max(...runtime.getAllRegionTopologies().flatMap((t) => t.nodes.map((n) => n.position.y)));
    assert.ok(top > 3.5, `the deck stands over the ground: ${top.toFixed(2)}`);
  } finally { session.free(); }
});

test("the carve is ghosted as the volume it takes: a sphere under the pointer, a capsule along the drag", () => {
  const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "carve", brushRadius: 1.8, faceSize: 2 };
  assert.equal(terrainSculptTool.previewOnHover(tool), true);
  assert.equal(terrainSculptTool.previewOnHover({ ...tool, mode: "add" }), false);
  const at = (x, z) => ({ point: { x, y: hill(x, z), z } });
  const hover = terrainSculptTool.previewFor({ start: at(-8, 0), current: at(-8, 0), samples: [at(-8, 0)] }, tool, {});
  assert.equal(hover.kind, "segments");
  const samples = drag([-8, 0], [0, 0]).map(([x, z]) => at(x, z));
  const drawn = terrainSculptTool.previewFor({ start: samples[0], current: samples.at(-1), samples }, tool, {});
  assert.ok(drawn.positions.length > hover.positions.length * 2, "a capsule along the drag");
});

test("probe: where the carve's new nodes went", () => {
  if (process.env.PROBE !== "1") return;
  const { runtime, ctx, session } = setup(hill);
  try {
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "carve", brushRadius: 1.8, faceSize: 2 };
    stroke(ctx, drag([-14, 0], [14, 0]), { tool, heightAt: hill });
    const nodes = runtime.getAllRegionTopologies().flatMap((t) => t.nodes).filter((n) => n.id.includes("terrain-volume"));
    const uniq = [...new Map(nodes.map((n) => [n.id, n.position])).values()];
    console.log("new nodes", uniq.length);
    const near = uniq.filter((p) => Math.abs(p.x) < 4 && Math.abs(p.z) < 3);
    console.log("near middle", near.map((p) => `(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`).join(" "));
    const xs = uniq.map((p) => p.x), zs = uniq.map((p) => p.z);
    console.log("extent x", Math.min(...xs).toFixed(1), Math.max(...xs).toFixed(1), "z", Math.min(...zs).toFixed(1), Math.max(...zs).toFixed(1));
  } finally { session.free(); }
});

test("probe: why the engine refuses the carve", () => {
  if (process.env.PROBE !== "1") return;
  const { runtime, ctx, session } = setup(hill);
  try {
    runtime.editTerrainVolume = (request) => {
      console.log("REQ patch", request.patch.faces.length, "faces", request.patch.vertices.length, "vertices; context", request.context.faces.length, "faces; path points", request.shapes[0].path.length, "first", JSON.stringify(request.shapes[0].path[0]), "winding sample", JSON.stringify(request.patch.faces[0].map((i) => request.patch.vertices[i])));
      try { return JSON.parse(session.edit_terrain_volume_json(JSON.stringify(request))); } catch (error) { console.log("ENGINE", String(error).slice(0, 300)); return undefined; }
    };
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "carve", brushRadius: 1.6, faceSize: 2 };
    stroke(ctx, drag([-14, 0], [2, 0]), { tool, heightAt: hill });
    stroke(ctx, drag([0, -14], [0, 0]), { tool, heightAt: hill });
  } finally { session.free(); }
});

test("probe: where the carve leaves open edges", () => {
  if (process.env.PROBE !== "1") return;
  const { runtime, ctx, session } = setup(hill);
  try {
    const border = borderOf(runtime);
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "carve", brushRadius: 1.8, faceSize: 2 };
    stroke(ctx, drag([-14, 0], [14, 0]), { tool, heightAt: hill });
    const uses = new Map();
    const ends = new Map();
    for (const t of runtime.getAllRegionTopologies()) {
      const at = new Map(t.nodes.map((n) => [n.id, n.position]));
      for (const use of t.outerLoops.flat()) {
        uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
        ends.set(use.edgeId, [use.startNodeId, use.endNodeId, at.get(use.startNodeId), at.get(use.endNodeId), t.surfaceKey.join("/")]);
      }
    }
    const open = [...uses].filter(([id, n]) => n === 1 && !border.has(id)).map(([id]) => ends.get(id));
    const f = (p) => `(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`;
    for (const [a, b, pa, pb, key] of open.slice(0, 12)) console.log("OPEN", a, b, f(pa), f(pb), key.slice(-30));
  } finally { session.free(); }
});

test("probe: the second carve after another session", async () => {
  if (process.env.PROBE !== "1") return;
  {
    const { ctx, session } = setup(hill);
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "carve", brushRadius: 1.8, faceSize: 2 };
    stroke(ctx, drag([-14, 0], [14, 0]), { tool, heightAt: hill });
    session.free();
  }
  const { runtime, ctx, session } = setup(hill);
  try {
    runtime.editTerrainVolume = (request) => {
      try { return JSON.parse(session.edit_terrain_volume_json(JSON.stringify(request))); } catch (error) {
        console.log("ENGINE", String(error).slice(0, 300), "patch", request.patch.faces.length);
        globalThis.__failed = request;
        return undefined;
      }
    };
    const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "carve", brushRadius: 1.6, faceSize: 2 };
    stroke(ctx, drag([-14, 0], [2, 0]), { tool, heightAt: hill });
    stroke(ctx, drag([0, -14], [0, 0]), { tool, heightAt: hill });
    if (globalThis.__failed) (await import("node:fs")).writeFileSync("failed-volume-edit.json", JSON.stringify(globalThis.__failed));
  } finally { session.free(); }
});

test("flattening and adding over a carved tunnel leave the tunnel and the one mesh standing", () => {
  const { runtime, ctx, calls, session } = setup(hill);
  try {
    const border = borderOf(runtime);
    const carve = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode: "carve", brushRadius: 1.8, faceSize: 2 };
    stroke(ctx, drag([-14, 0], [14, 0]), { tool: carve, heightAt: hill });
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const ceiling = () => runtime.getAllRegionTopologies().flatMap((t) => t.nodes).filter((n) => Math.abs(n.position.x) < 1.5 && Math.abs(n.position.z) < 0.8 && n.position.y > 3.5 && n.position.y < 5).length;
    const before = ceiling();
    assert.ok(before > 0, "a ceiling to keep");
    for (const mode of ["flatten", "add"]) {
      const tool = { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], mode, brushRadius: 3, faceSize: 2, elevationStep: 1 };
      stroke(ctx, drag([-4, -6], [-4, 6]), { tool, heightAt: hill });
      probe(mode, calls.feedback.at(-1));
      assertOneMeshOfGround(runtime, border);
      assert.ok(ceiling() > 0, `the tunnel's ceiling still stands after ${mode}`);
    }
  } finally { session.free(); }
});
