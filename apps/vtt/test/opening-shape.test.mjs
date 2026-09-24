// Shaped openings: rounded sides and the circle preset. The outline math is
// checked alone, then driven through the real runtime + WASM engine: the
// host must be cut by exactly the outline, and the shape must survive
// move, resize, undo and redo.
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createAliasResolveHook } from "./support/alias-resolve-hook.mjs";

registerHooks(createAliasResolveHook(new URL("../src/", import.meta.url)));

const { readFileSync } = await import("node:fs");
const { initSync } = await import("../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm.js");
initSync({ module: readFileSync(new URL("../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm_bg.wasm", import.meta.url)) });

const { AppTabletopRuntime } = await import("../src/composition/tabletop/tabletop-runtime.ts");
const { createConstructionSessionAdapter } = await import("../src/adapters/construction/construction-session-wasm-adapter.ts");
const {
  createEditHistoryStack, DEFAULT_TOOL_PARAMS, hasTrait, openingStructureType, openingOutline, shapeFromProps, sideArc, OPENING_SHAPE_PROP,
} = await import("../src/features/edit-construction/index.ts");
const { surfaceRefFromNodeSet } = await import("../src/entities/map/index.ts");
const { openingTool } = await import("../src/composition/tabletop/tools/openings/opening-tool.ts");
const { groupRunSpan, runFrame, primaryHostOf } = await import("../src/composition/tabletop/tools/openings/opening-shared.ts");
const { wallLineTool } = await import("../src/composition/tabletop/tools/walls/wall-line-tool.ts");
const { commitWallStroke } = await import("../src/composition/tabletop/tools/walls/wall-shared.ts");

const shape = (radii = {}, ellipse = false) => ({ ellipse, radii: { top: 0, right: 0, bottom: 0, left: 0, ...radii } });
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------- outline ----------

const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function assertConvexInBox(loop, width, height, label) {
  assert.ok(loop.length >= 3, `${label}: at least a triangle`);
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length], c = loop[(i + 2) % loop.length];
    assert.ok(cross(a, b, c) >= -1e-9, `${label}: turns clockwise at ${i} -- not a simple convex loop`);
    assert.ok(a[0] >= -1e-9 && a[0] <= width + 1e-9 && a[1] >= -1e-9 && a[1] <= height + 1e-9, `${label}: point ${a} leaves the box`);
  }
  let area = 0, turning = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    area += a[0] * b[1] - b[0] * a[1];
    const c = loop[(i + 2) % loop.length];
    turning += Math.atan2(cross(a, b, c), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]));
  }
  assert.ok(area > 0, `${label}: counter-clockwise`);
  assert.ok(near(turning, 2 * Math.PI, 1e-6), `${label}: winds exactly once (turning ${turning})`);
  const xs = loop.map((p) => p[0]), ys = loop.map((p) => p[1]);
  assert.ok(near(Math.min(...xs), 0, 1e-9) && near(Math.max(...xs), width, 1e-9) && near(Math.min(...ys), 0, 1e-9) && near(Math.max(...ys), height, 1e-9), `${label}: spans its whole box`);
}

test("outline: a rectangle is exactly its four corners from bottom-left", () => {
  assert.deepEqual(openingOutline(undefined, 2, 1), [[0, 0], [2, 0], [2, 1], [0, 1]]);
  assert.deepEqual(openingOutline(shape(), 2, 1), [[0, 0], [2, 0], [2, 1], [0, 1]]);
});

test("outline: top radius = width/2 is a semicircular arch whose apex is the box top; the bottom corners stay", () => {
  const w = 1.2, h = 1.5;
  const loop = openingOutline(shape({ top: w / 2 }), w, h);
  assert.deepEqual(loop.slice(0, 2), [[0, 0], [w, 0]], "bottom corners unchanged");
  assert.ok(loop.some(([x, y]) => near(x, w / 2, 1e-9) && near(y, h, 1e-9)), "apex at the middle of the top");
  const center = [w / 2, h - w / 2];
  const arc = loop.filter(([, y]) => y > h - w / 2 + 1e-9);
  assert.ok(arc.length >= 8, "sampled densely enough to read round");
  for (const [x, y] of arc) assert.ok(near(Math.hypot(x - center[0], y - center[1]), w / 2, 1e-9), `(${x}, ${y}) on the semicircle`);
  assert.ok(loop.some(([x, y]) => near(x, w, 1e-9) && near(y, h - w / 2, 1e-9)) && loop.some(([x, y]) => near(x, 0, 1e-9) && near(y, h - w / 2, 1e-9)), "the arch springs from the sides");
  assertConvexInBox(loop, w, h, "arch");
});

test("outline: the circle preset on a square is a circle through the four side midpoints", () => {
  const loop = openingOutline(shape({}, true), 1, 1);
  assert.ok(loop.length >= 32);
  for (const [x, y] of loop) assert.ok(near(Math.hypot(x - 0.5, y - 0.5), 0.5, 1e-12));
  for (const [x, y] of [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) assert.ok(loop.some((p) => near(p[0], x, 1e-12) && near(p[1], y, 1e-12)), `touches (${x}, ${y})`);
  assert.deepEqual(loop[0], [0.5, 0], "starts at the bottom");
});

test("outline: clamping keeps every mix of radii a simple convex loop inside, and spanning, its box", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = () => (rnd() < 0.3 ? 0 : rnd() * 3);
  for (let i = 0; i < 300; i++) {
    const w = 0.3 + rnd() * 3, h = 0.3 + rnd() * 3;
    const s = shape({ top: pick(), right: pick(), bottom: pick(), left: pick() }, rnd() < 0.1);
    assertConvexInBox(openingOutline(s, w, h), w, h, `#${i} ${w.toFixed(2)}x${h.toFixed(2)} ${JSON.stringify(s)}`);
  }
  const tiny = sideArc(0.01, 2, 3);
  assert.ok(near(tiny.radius, 1) && near(tiny.rise, 1), "a radius under half the side reads as half: a semicircle");
  const low = sideArc(1, 2, 1);
  assert.ok(near(low.rise, 0.5) && low.radius > 1, "the rise is capped at half the box across the side, flattening the arc");
  assert.equal(sideArc(0, 2, 1), undefined, "0 is a straight side");
});

test("shape props: a missing or malformed bag reads as a rectangle", () => {
  assert.deepEqual(shapeFromProps(undefined), shape());
  assert.deepEqual(shapeFromProps({ [OPENING_SHAPE_PROP]: "x" }), shape());
  assert.deepEqual(shapeFromProps({ [OPENING_SHAPE_PROP]: { ellipse: true, radii: { top: 0.5, left: -1 } } }), shape({ top: 0.5 }, true));
});

// ---------- real engine ----------

const ref = (t) => surfaceRefFromNodeSet(t.surfaceKey);
const isOpening = (t) => t.surfaceType === openingStructureType.surfaceType;
const isPartition = (t) => hasTrait(t.surfaceType, "partition");
const WINDOW = { ...DEFAULT_TOOL_PARAMS.opening, openingKind: "window", width: 1.2, height: 1.5, sill: 1 };
const ARCH = shape({ top: 0.6 });

async function harness() {
  const pickTargets = new Map();
  const renderPort = {
    async start() {}, attachView: () => "v", detachView() {}, resizeView() {}, setFloorClipHeight() {}, pick: () => undefined,
    getMetrics: () => ({}), async dispose() {},
    applyConfirmed(c) {
      if (c.type === "surface-pick-target-upserted") pickTargets.set(c.target.surfaceRef, c.target.mesh);
      else if (c.type === "surface-pick-target-removed") pickTargets.delete(c.surfaceRef);
    },
  };
  const runtime = new AppTabletopRuntime("t", renderPort, createConstructionSessionAdapter(), { async start() {}, async dispose() {} }, []);
  await runtime.start();
  let seq = 0;
  const feedback = [];
  const paramUpdates = [];
  const ctx = {
    runtime, history: createEditHistoryStack(), tableId: "t", snapToGrid: false, structureEditParams: { mode: "shape" },
    nextSequence: () => ++seq, reportSelection() {}, reportFeedback: (f) => f && feedback.push(f),
    updateToolParams: (toolId, update) => paramUpdates.push({ toolId, update }),
  };
  openingTool.onCancel(ctx);
  const all = () => runtime.getAllRegionTopologies();
  return { runtime, ctx, pickTargets, feedback, paramUpdates, openings: () => all().filter(isOpening), walls: () => all().filter(isPartition) };
}

function line(ctx, a, b) {
  const params = DEFAULT_TOOL_PARAMS["wall-line"];
  wallLineTool.onPointerDown(ctx, { point: a }, params);
  wallLineTool.onPointerUp(ctx, { start: { point: a }, current: { point: b }, samples: [] }, params);
  wallLineTool.onClick?.(ctx, { point: b }, params);
}

function curvyBrushWall(ctx) {
  const stroke = Array.from({ length: 91 }, (_, i) => ({ x: (i / 90) * 24, y: 0, z: 3 * Math.sin((i / 90) * Math.PI * 5) }));
  commitWallStroke(ctx, stroke, 0.25, { wallType: "wall-white", height: 3 }, "wall-brush");
}

function press(h, params, down, up = down, surfaceRef = undefined) {
  const sample = { point: down, surfaceRef };
  const gesture = { start: sample, current: { point: up }, samples: [sample, { point: up }] };
  openingTool.onPointerDown(h.ctx, sample, params);
  openingTool.onPointerMove(h.ctx, gesture, params);
  openingTool.onPointerUp(h.ctx, gesture, params);
  openingTool.onClick(h.ctx, { point: up, surfaceRef }, params);
}

const openingRefAt = (h, point) => {
  const hit = h.openings().find((o) => {
    const xs = o.nodes.map((n) => n.position.x), ys = o.nodes.map((n) => n.position.y);
    return point.x >= Math.min(...xs) && point.x <= Math.max(...xs) && point.y >= Math.min(...ys) && point.y <= Math.max(...ys);
  });
  return hit && ref(hit);
};

const inPoly = (x, y, pts) => {
  let c = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xi, yi] = pts[a], [xj, yj] = pts[b];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

function hitMesh(mesh, origin, dir, maxT) {
  const P = mesh.positions, I = mesh.indices ?? Array.from({ length: P.length / 3 }, (_, i) => i);
  for (let i = 0; i < I.length; i += 3) {
    const v0 = [P[3 * I[i]], P[3 * I[i] + 1], P[3 * I[i] + 2]];
    const v1 = [P[3 * I[i + 1]], P[3 * I[i + 1] + 1], P[3 * I[i + 1] + 2]];
    const v2 = [P[3 * I[i + 2]], P[3 * I[i + 2] + 1], P[3 * I[i + 2] + 2]];
    const e1 = v1.map((x, k) => x - v0[k]), e2 = v2.map((x, k) => x - v0[k]);
    const p = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const tv = origin.map((x, k) => x - v0[k]);
    const u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
    const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (Math.abs(t) <= maxT) return true;
  }
  return false;
}

/** Each opening piece's outline in its host's own (u, v), from its pins in rim order. */
function cuttersOn(h, wall) {
  const hostRef = ref(wall);
  return h.openings().flatMap((o) => {
    const pins = o.outerLoops[0].map((e) => o.nodes.find((n) => n.id === e.startNodeId).pin);
    return pins.every((p) => p && surfaceRefFromNodeSet(p.hostSurfaceKey) === hostRef) ? [pins.map((p) => [p.u, p.v])] : [];
  });
}

/**
 * Samples the host's (u, v) on a fine grid, casts along the local normal at
 * each sample's true position, and counts wall where an outline is and no
 * wall where none is -- the cut must be the outline, not its rectangle.
 * `probes` are extra (u, v) points checked individually.
 */
function cutProblems(h, wall, probes = []) {
  const mesh = h.pickTargets.get(ref(wall));
  assert.ok(mesh, "host is on screen");
  const cutters = cuttersOn(h, wall);
  const N_U = 120, N_V = 60, du = 1 / N_U, dv = 1 / N_V;
  const uvs = [...probes.map((p) => p.uv)];
  for (let i = 2; i < N_U - 1; i++) for (let j = 2; j < N_V - 1; j++) uvs.push([i / N_U, j / N_V]);
  const resolved = h.runtime.resolveOnHost({ hostSurfaceKey: wall.surfaceKey, uv: uvs });
  const ahead = h.runtime.resolveOnHost({ hostSurfaceKey: wall.surfaceKey, uv: uvs.map(([u, v]) => [Math.min(1, u + du / 2), v]) });
  const nearEdge = (u, v) => cutters.some((poly) => [[du, 0], [-du, 0], [0, dv], [0, -dv]].some(([a, b]) => inPoly(u + a, v + b, poly) !== inPoly(u, v, poly)));
  let missing = 0, extra = 0;
  const probeResults = [];
  uvs.forEach(([u, v], k) => {
    const p = resolved[k], p2 = ahead[k];
    const tl = Math.hypot(p2.x - p.x, p2.z - p.z) || 1;
    const n = [-(p2.z - p.z) / tl, 0, (p2.x - p.x) / tl];
    const drawn = hitMesh(mesh, [p.x - n[0] * 0.25, p.y, p.z - n[2] * 0.25], n, 0.5);
    if (k < probes.length) { probeResults.push(drawn); return; }
    if (nearEdge(u, v)) return;
    const cut = cutters.some((poly) => inPoly(u, v, poly));
    if (!cut && !drawn) missing++;
    if (cut && drawn) extra++;
  });
  const problems = [];
  if (missing > 2) problems.push(`WALL MISSING at ${missing} samples outside every outline`);
  if (extra > 2) problems.push(`OVERDRAW at ${extra} samples inside an outline`);
  probes.forEach((probe, k) => { if (probeResults[k] !== probe.drawn) problems.push(`probe ${probe.label}: expected ${probe.drawn ? "wall" : "hole"}`); });
  return problems;
}

const shapeOf = (piece) => shapeFromProps(piece.props);

test("a window with a rounded top on a straight wall cuts the wall by its arch, not its rectangle", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [wall] = h.walls();
  press(h, { ...WINDOW, shape: ARCH }, { x: 4, y: 0.9, z: 0 }, undefined, ref(wall));
  const [opening, ...rest] = h.openings();
  assert.equal(rest.length, 0);
  assert.ok(opening.nodes.length > 10, "the arch is sampled as many pinned nodes");
  assert.ok(opening.nodes.every((n) => n.pin), "every outline point is pinned");
  assert.deepEqual(shapeOf(opening), ARCH, "the shape is stored on the piece");

  const run = runFrame(h.runtime, wall.surfaceKey);
  const span = groupRunSpan(run, [opening]);
  assert.ok(near(span.s1 - span.s0, 1.2, 1e-6) && near((span.v1 - span.v0) * 3, 1.5, 1e-6), "its box is the slider size");
  const u = (s) => s / 8;
  const topCorner = { uv: [u(span.s0 + 0.05), span.v1 - 0.02], drawn: true, label: "just inside the box's top-left corner, outside the arch" };
  const apex = { uv: [u((span.s0 + span.s1) / 2), span.v1 - 0.02], drawn: false, label: "just under the apex" };
  const sill = { uv: [u(span.s0 + 0.05), span.v0 + 0.02], drawn: false, label: "bottom-left corner, inside the straight sides" };
  assert.deepEqual(cutProblems(h, wall, [topCorner, apex, sill]), []);
});

test("a rounded-top window on a curved brush wall cuts every face it covers by its outline", async () => {
  const h = await harness();
  curvyBrushWall(h.ctx);
  const walls = h.walls();
  assert.ok(walls.length >= 2);
  const host = walls[0];
  const [mid] = h.runtime.resolveOnHost({ hostSurfaceKey: host.surfaceKey, uv: [[0.5, 0.3]] });
  press(h, { ...WINDOW, width: 1.4, height: 1.6, shape: shape({ top: 0.7, bottom: 2 }) }, mid, undefined, ref(host));
  const openings = h.openings();
  assert.ok(openings.length >= 1, `created: ${h.feedback.map((f) => f.message).join(" / ")}`);
  assert.ok(openings.every((o) => shapeOf(o).radii.top === 0.7));
  assert.ok(openings.every((o) => o.nodes.length > 8), "every piece is outlined by its arcs");
  for (const wall of h.walls()) assert.deepEqual(cutProblems(h, wall), [], `face ${ref(wall).slice(0, 40)}`);
});

test("a window straddling a seam is split along the seam and still cut by its arch on both faces", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
  line(h.ctx, { x: 4, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [a] = h.walls();
  press(h, { ...WINDOW, width: 1.6, shape: shape({}, true) }, { x: 4.3, y: 0.8, z: 0 }, undefined, ref(a));
  const pieces = h.openings();
  assert.equal(pieces.length, 2, "one piece per face");
  assert.ok(pieces.every((p) => shapeOf(p).ellipse), "both pieces carry the shape");
  assert.ok(pieces.every((p) => p.nodes.length > 8), "both pieces are outlined by the ellipse");
  for (const wall of h.walls()) assert.deepEqual(cutProblems(h, wall), [], `face ${ref(wall).slice(0, 40)}`);
});

test("moving a shaped window keeps its shape, and undo/redo bring the shape back with the pieces", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [wall] = h.walls();
  press(h, { ...WINDOW, shape: ARCH }, { x: 3, y: 0.9, z: 0 }, undefined, ref(wall));
  const [placed] = h.openings();

  const grab = { x: 3, y: 1.5, z: 0 };
  press(h, WINDOW, grab, { x: 5, y: 1.5, z: 0 }, openingRefAt(h, grab));
  const [moved] = h.openings();
  assert.notEqual(ref(moved), ref(placed), "replaced by a new group");
  assert.deepEqual(shapeOf(moved), ARCH, "the move keeps the arch");

  const entry = h.ctx.history.undo();
  h.runtime.undoTransaction(entry.transactionId, "local");
  const [back] = h.openings();
  assert.equal(ref(back), ref(placed));
  assert.deepEqual(shapeOf(back), ARCH, "undo restores the shape with the piece");

  const redo = h.ctx.history.redo();
  h.runtime.redoTransaction(redo.transactionId, "local");
  const [again] = h.openings();
  assert.equal(ref(again), ref(moved));
  assert.deepEqual(shapeOf(again), ARCH, "redo too");
});

test("resizing a shaped window keeps its radii in meters, re-fitted to the new box", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [wall] = h.walls();
  press(h, { ...WINDOW, shape: ARCH }, { x: 3, y: 0.9, z: 0 }, undefined, ref(wall));
  const run = runFrame(h.runtime, wall.surfaceKey);
  const before = groupRunSpan(run, h.openings());
  const edge = { x: before.s1, y: 1.2, z: 0 };
  press(h, WINDOW, edge, { x: before.s1 + 0.8, y: 1.2, z: 0 }, openingRefAt(h, { x: before.s1 - 0.01, y: 1.2, z: 0 }));
  const resized = h.openings();
  const after = groupRunSpan(run, resized);
  assert.ok(near(after.s1 - after.s0, 2, 1e-6), `wider: ${after.s1 - after.s0}`);
  assert.deepEqual(shapeOf(resized[0]), ARCH, "radius kept in meters");
  // 2 m wide with a 0.6 m radius: raised to a 1 m semicircle, capped at half the 1.5 m height.
  const top = resized[0].nodes.filter((n) => n.pin.v > after.v1 - 1e-6);
  assert.equal(top.length, 1, "only the apex touches the top");
  assert.ok(near(run.sOf(run.panelOf(top[0].pin.hostSurfaceKey), top[0].pin.u), (after.s0 + after.s1) / 2, 1e-6), "apex centred");
  assert.deepEqual(cutProblems(h, wall), []);
});

test("a round door stands on the floor", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [wall] = h.walls();
  const DOOR = { ...DEFAULT_TOOL_PARAMS.opening, openingKind: "door", width: 1.2, height: 2.2, sill: 0, shape: shape({}, true) };
  press(h, DOOR, { x: 4, y: 1.4, z: 0 }, undefined, ref(wall));
  const [door] = h.openings();
  const run = runFrame(h.runtime, wall.surfaceKey);
  const span = groupRunSpan(run, [door]);
  assert.ok(near(span.v0, 0, 1e-9), "its lowest point is the floor");
  assert.ok(near(Math.min(...door.nodes.map((n) => n.position.y)), 0, 1e-6));
  assert.ok(shapeOf(door).ellipse);

  const grab = { x: 4, y: 1.1, z: 0 };
  press(h, DOOR, grab, { x: 5.5, y: 1.6, z: 0 }, openingRefAt(h, grab));
  const [moved] = h.openings();
  assert.ok(near(groupRunSpan(run, [moved]).v0, 0, 1e-9), "still on the floor after a move");
  assert.ok(shapeOf(moved).ellipse);
  assert.deepEqual(cutProblems(h, wall), []);
});

test("with an opening selected, the panel shows its shape and a shape change reshapes that opening, undoably", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [wall] = h.walls();
  const NEXT = shape({ left: 1 });
  press(h, { ...WINDOW, shape: ARCH }, { x: 3, y: 0.9, z: 0 }, undefined, ref(wall));
  const panel = { ...WINDOW, shape: NEXT };

  const grab = { x: 3, y: 1.5, z: 0 };
  press(h, panel, grab, grab, openingRefAt(h, grab));
  assert.equal(h.paramUpdates.length, 1, "selecting shows the opening's shape in the panel");
  const shown = h.paramUpdates[0].update(panel);
  assert.deepEqual(shown.shape, ARCH);

  const circle = shape({}, true);
  openingTool.onParamsChange(h.ctx, { ...shown, shape: circle }, shown);
  const [reshaped] = h.openings();
  assert.ok(shapeOf(reshaped).ellipse, "the selected opening became a circle");
  const run = runFrame(h.runtime, wall.surfaceKey);
  const span = groupRunSpan(run, [reshaped]);
  assert.ok(near(span.s1 - span.s0, 1.2, 1e-6), "same box");
  assert.deepEqual(cutProblems(h, wall), []);

  openingTool.onParamsChange(h.ctx, { ...shown, shape: shape() }, { ...shown, shape: circle });
  assert.equal(h.openings()[0].props, undefined, "still selected: back to a rectangle, which stores nothing");

  const entry = h.ctx.history.undo();
  h.runtime.undoTransaction(entry.transactionId, "local");
  assert.ok(shapeOf(h.openings()[0]).ellipse, "undo brings the circle back");

  openingTool.onCancel(h.ctx);
  const restored = h.paramUpdates.at(-1).update({ ...WINDOW, shape: circle });
  assert.deepEqual(restored.shape, NEXT, "deselecting puts back the shape for the next opening");
});
