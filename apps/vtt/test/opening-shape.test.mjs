// Shaped openings: rounded sides and the circle preset. The outline math is
// checked alone, then driven through the real runtime + WASM engine: the
// host must be cut by exactly the outline, and the shape must survive
// move, resize, undo and redo.
import assert from "node:assert/strict";
import test from "node:test";

import { curvyBrushWall, harness, hitMesh, inPoly, line, openingRefAt, press, ref } from "./support/opening-harness.mjs";
import { DEFAULT_TOOL_PARAMS, OPENING_SHAPE_PROP, openingPath, pointAt, segmentExtremes, shapeFromProps, sideArc } from "../src/features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";
import { openingTool } from "../src/composition/tabletop/tools/openings/opening-tool.ts";
import { groupRunSpan, runFrame } from "../src/composition/tabletop/tools/openings/opening-shared.ts";
import { commitWallContour } from "../src/composition/tabletop/tools/walls/wall-shared.ts";

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

/** A path densely sampled into a polygon. */
const sampled = (path) => path.flatMap((seg) => Array.from({ length: 32 }, (_, k) => pointAt(seg, k / 32)));

test("path: a rectangle is its four straight sides from the bottom-left corner", () => {
  for (const s of [undefined, shape()]) {
    const path = openingPath(s, 2, 1);
    assert.ok(path.every((seg) => seg.controls === undefined));
    assert.deepEqual(path.map((seg) => seg.from), [[0, 0], [2, 0], [2, 1], [0, 1]]);
  }
});

test("path: every mix of radii samples to a simple convex loop inside, and spanning, its box", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = () => (rnd() < 0.3 ? 0 : rnd() * 3);
  for (let i = 0; i < 300; i++) {
    const w = 0.3 + rnd() * 3, h = 0.3 + rnd() * 3;
    const s = shape({ top: pick(), right: pick(), bottom: pick(), left: pick() }, rnd() < 0.1);
    assertConvexInBox(sampled(openingPath(s, w, h)), w, h, `#${i} ${w.toFixed(2)}x${h.toFixed(2)} ${JSON.stringify(s)}`);
  }
  const tiny = sideArc(0.01, 2, 3);
  assert.ok(near(tiny.radius, 1) && near(tiny.rise, 1), "a radius under half the side reads as half: a semicircle");
  const low = sideArc(1, 2, 1);
  assert.ok(near(low.rise, 0.5) && low.radius > 1, "the rise is capped at half the box across the side, flattening the arc");
  assert.equal(sideArc(0, 2, 1), undefined, "0 is a straight side");
});

/** The true area of a shaped box, by a fine grid against the circles themselves -- not a sampled polygon. */
function exactArea(s, w, h) {
  const N = 600;
  const circles = s.ellipse ? [] : ["top", "right", "bottom", "left"].flatMap((side) => {
    const horizontal = side === "top" || side === "bottom";
    const arc = sideArc(s.radii[side], horizontal ? w : h, horizontal ? h : w);
    if (!arc) return [];
    const r = arc.radius;
    const c = side === "bottom" ? [w / 2, r] : side === "top" ? [w / 2, h - r] : side === "right" ? [w - r, h / 2] : [r, h / 2];
    return [{ side, c, r }];
  });
  const inside = (x, y) => {
    if (s.ellipse) return ((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2 <= 1;
    return circles.every(({ side, c, r }) => {
      const along = side === "top" || side === "bottom" ? x - c[0] : y - c[1];
      const across = side === "top" ? y - c[1] : side === "bottom" ? c[1] - y : side === "right" ? x - c[0] : c[0] - x;
      return across <= 0 || along * along + across * across <= r * r;
    });
  };
  let hits = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (inside(((i + 0.5) / N) * w, ((j + 0.5) / N) * h)) hits++;
  return (hits / (N * N)) * w * h;
}

test("path: every mix of radii is a closed chain of 2 to 8 segments, spanning its box, matching the true area", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const polyArea = (pts) => pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  for (let i = 0; i < 120; i++) {
    const w = 0.3 + rand() * 3, h = 0.3 + rand() * 3;
    const pick = () => (rand() < 0.4 ? 0 : rand() * 3);
    const s = rand() < 0.1 ? shape({}, true) : shape({ top: pick(), right: pick(), bottom: pick(), left: pick() });
    const path = openingPath(s, w, h);
    const label = `#${i} ${w.toFixed(2)}x${h.toFixed(2)} ${JSON.stringify(s)}`;
    assert.ok(path.length >= 2 && path.length <= 8, `${label}: ${path.length} segments`);
    path.forEach((seg, k) => assert.ok(Math.hypot(seg.to[0] - path[(k + 1) % path.length].from[0], seg.to[1] - path[(k + 1) % path.length].from[1]) < 1e-9, `${label}: closed at ${k}`));
    const ext = path.flatMap(segmentExtremes);
    const xs = ext.map((p) => p[0]), ys = ext.map((p) => p[1]);
    assert.ok(near(Math.min(...xs), 0, 1e-6) && near(Math.max(...xs), w, 1e-6) && near(Math.min(...ys), 0, 1e-6) && near(Math.max(...ys), h, 1e-6), `${label}: spans its box`);
    const dense = sampled(path);
    const exact = exactArea(s, w, h);
    assert.ok(Math.abs(polyArea(dense) - exact) / exact < 0.005, `${label}: area ${polyArea(dense)} vs ${exact}`);
  }
});

test("shape props: a missing or malformed bag reads as a rectangle", () => {
  assert.deepEqual(shapeFromProps(undefined), shape());
  assert.deepEqual(shapeFromProps({ [OPENING_SHAPE_PROP]: "x" }), shape());
  assert.deepEqual(shapeFromProps({ [OPENING_SHAPE_PROP]: { ellipse: true, radii: { top: 0.5, left: -1 } } }), shape({ top: 0.5 }, true));
});

// ---------- real engine ----------

const WINDOW = { ...DEFAULT_TOOL_PARAMS.opening, openingKind: "window", width: 1.2, height: 1.5 };
const ARCH = shape({ top: 0.6 });

/** Each opening piece's outline in its host's own (u, v), as the engine traces it -- curved edges included. */
function cuttersOn(h, wall) {
  const hostRef = ref(wall);
  return h.openings().flatMap((o) => {
    const outline = h.runtime.hostOutline(o.surfaceKey);
    return surfaceRefFromNodeSet(outline.hostSurfaceKey) === hostRef ? [outline.uv] : [];
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
/** A piece's edges the engine traces as a cubic in its host's (u, v). */
const curvedEdges = (piece) => piece.outerLoops[0].filter((e) => e.hostCurve?.controls);

test("a window with a rounded top on a straight wall cuts the wall by its arch, not its rectangle", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [wall] = h.walls();
  press(h, { ...WINDOW, shape: ARCH }, { x: 4, y: 0.9, z: 0 }, undefined, { surfaceRef: ref(wall) });
  const [opening, ...rest] = h.openings();
  assert.equal(rest.length, 0);
  // A semicircle is too much turn for one cubic within 2 mm, so it is two quarter arcs meeting at the apex.
  assert.equal(opening.nodes.length, 5, "two sill corners, two springing points, the apex -- no arc samples");
  assert.equal(curvedEdges(opening).length, 2, "the arch is two host-space cubics");
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
  press(h, { ...WINDOW, width: 1.4, height: 1.6, shape: shape({ top: 0.7, bottom: 2 }) }, mid, undefined, { surfaceRef: ref(host) });
  const openings = h.openings();
  assert.ok(openings.length >= 1, `created: ${h.feedback.map((f) => f.message).join(" / ")}`);
  assert.ok(openings.every((o) => shapeOf(o).radii.top === 0.7));
  assert.ok(openings.every((o) => o.nodes.length <= 7), "no piece is densified: only corners, arc ends and seam crossings");
  assert.ok(openings.every((o) => curvedEdges(o).length >= 1), "every piece is outlined by host-space cubics");
  for (const wall of h.walls()) assert.deepEqual(cutProblems(h, wall), [], `face ${ref(wall).slice(0, 40)}`);
});

test("a window straddling a seam is split along the seam and still cut by its arch on both faces", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
  line(h.ctx, { x: 4, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [a] = h.walls();
  press(h, { ...WINDOW, width: 1.6, shape: shape({}, true) }, { x: 4.3, y: 0.8, z: 0 }, undefined, { surfaceRef: ref(a) });
  const pieces = h.openings();
  assert.equal(pieces.length, 2, "one piece per face");
  assert.ok(pieces.every((p) => shapeOf(p).ellipse), "both pieces carry the shape");
  assert.deepEqual(pieces.map((p) => p.nodes.length).sort(), [3, 5], "the left piece: its extreme and two seam crossings; the right: three extremes and two crossings");
  assert.deepEqual(pieces.map((p) => curvedEdges(p).length).sort(), [2, 4], "the ellipse's quarters are split at the seam, never resampled");
  for (const wall of h.walls()) assert.deepEqual(cutProblems(h, wall), [], `face ${ref(wall).slice(0, 40)}`);
});

test("moving a shaped window keeps its shape, and undo/redo bring the shape back with the pieces", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [wall] = h.walls();
  press(h, { ...WINDOW, shape: ARCH }, { x: 3, y: 0.9, z: 0 }, undefined, { surfaceRef: ref(wall) });
  const [placed] = h.openings();

  const grab = { x: 3, y: 1.5, z: 0 };
  press(h, WINDOW, grab, { x: 5, y: 1.5, z: 0 });
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
  press(h, { ...WINDOW, shape: ARCH }, { x: 3, y: 0.9, z: 0 }, undefined, { surfaceRef: ref(wall) });
  const run = runFrame(h.runtime, wall.surfaceKey);
  const before = groupRunSpan(run, h.openings());
  const edge = { x: before.s1, y: 1.2, z: 0 };
  press(h, WINDOW, edge, { x: before.s1 + 0.8, y: 1.2, z: 0 }, { surfaceRef: openingRefAt(h.openings(), { x: before.s1 - 0.01, y: 1.2, z: 0 }) });
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
  const DOOR = { ...DEFAULT_TOOL_PARAMS.opening, openingKind: "door", width: 1.2, height: 2.2, shape: shape({}, true) };
  press(h, DOOR, { x: 4, y: 1.4, z: 0 }, undefined, { surfaceRef: ref(wall) });
  const [door] = h.openings();
  const run = runFrame(h.runtime, wall.surfaceKey);
  const span = groupRunSpan(run, [door]);
  assert.ok(near(span.v0, 0, 1e-9), "its lowest point is the floor");
  assert.ok(near(Math.min(...door.nodes.map((n) => n.position.y)), 0, 1e-6));
  assert.ok(shapeOf(door).ellipse);

  const grab = { x: 4, y: 1.1, z: 0 };
  press(h, DOOR, grab, { x: 5.5, y: 1.6, z: 0 });
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
  press(h, { ...WINDOW, shape: ARCH }, { x: 3, y: 0.9, z: 0 }, undefined, { surfaceRef: ref(wall) });
  const panel = { ...WINDOW, shape: NEXT };

  const grab = { x: 3, y: 1.5, z: 0 };
  press(h, panel, grab, grab);
  assert.equal(h.paramUpdates.length, 1, "selecting shows the opening's shape in the panel");
  const shown = h.paramUpdates[0].update(panel);
  assert.deepEqual(shown.shape, ARCH);
  assert.ok(near(shown.width, 1.2, 1e-9) && near(shown.height, 1.5, 1e-9), "and its size");

  const circle = shape({}, true);
  openingTool.onParamsChange(h.ctx, { ...shown, shape: circle }, shown);
  const [reshaped] = h.openings();
  assert.ok(shapeOf(reshaped).ellipse, "the selected opening became a circle");
  const run = runFrame(h.runtime, wall.surfaceKey);
  const span = groupRunSpan(run, [reshaped]);
  assert.ok(near(span.s1 - span.s0, 1.2, 1e-6), "same box");
  assert.deepEqual(cutProblems(h, wall), []);

  openingTool.onParamsChange(h.ctx, { ...shown, shape: shape() }, { ...shown, shape: circle });
  assert.equal(h.openings()[0].props?.[OPENING_SHAPE_PROP], undefined, "still selected: back to a rectangle, which stores no shape");

  const entry = h.ctx.history.undo();
  h.runtime.undoTransaction(entry.transactionId, "local");
  assert.ok(shapeOf(h.openings()[0]).ellipse, "undo brings the circle back");

  openingTool.onCancel(h.ctx);
  const restored = h.paramUpdates.at(-1).update({ ...WINDOW, shape: circle });
  assert.deepEqual(restored.shape, NEXT, "deselecting puts back the shape for the next opening");
});

// ---------- host-space edges: no densified nodes ----------

/** A piece's outline area in world square meters, traced by the engine on a host `length` long and `height` tall. */
function outlineArea(h, piece, length, height) {
  const uv = h.runtime.hostOutline(piece.surfaceKey).uv;
  let area = 0;
  uv.forEach(([u, v], i) => {
    const [nu, nv] = uv[(i + 1) % uv.length];
    area += u * length * nv * height - nu * length * v * height;
  });
  return Math.abs(area) / 2;
}

test("a window on a Bezier wall is exactly 4 pinned nodes, and its cut follows the wall", async () => {
  const h = await harness();
  commitWallContour(h.ctx, [{ start: { x: 0, y: 0, z: 0 }, end: { x: 8, y: 0, z: 0 }, geometry: { kind: "bezier", handle1: [1, 4], handle2: [6, -2] } }], { ...DEFAULT_TOOL_PARAMS["wall-line"], height: 3 }, "test");
  const [wall] = h.walls();
  const [point] = h.runtime.resolveOnHost({ hostSurfaceKey: wall.surfaceKey, uv: [[0.5, 0.4]] });
  press(h, { ...WINDOW, width: 2 }, point, undefined, { surfaceRef: ref(wall) });
  const pieces = h.openings();
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].nodes.length, 4, "four corners, no points added along the curved sides");
  assert.equal(curvedEdges(pieces[0]).length, 0, "straight sides are plain line edges");
  const outline = h.runtime.hostOutline(pieces[0].surfaceKey).uv;
  assert.ok(outline.length > 4, `the engine traces the sides along the curved wall (${outline.length} points)`);
  const length = h.runtime.panelRun(wall.surfaceKey).panels[0].length;
  const area = outlineArea(h, pieces[0], length, 3);
  assert.ok(Math.abs(area - 2 * 1.5) / 3 < 0.01, `cut area ${area} is the 2 x 1.5 box`);
  assert.deepEqual(cutProblems(h, wall), []);
});

test("a semicircular-top window: its arch is host-space cubics, cut area within 1%", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [wall] = h.walls();
  press(h, { ...WINDOW, shape: ARCH }, { x: 4, y: 0.9, z: 0 }, undefined, { surfaceRef: ref(wall) });
  const [opening] = h.openings();
  assert.equal(opening.nodes.length, 5);
  assert.equal(curvedEdges(opening).length, 2);
  const exact = 1.2 * 0.9 + (Math.PI * 0.6 * 0.6) / 2;
  const area = outlineArea(h, opening, 8, 3);
  assert.ok(Math.abs(area - exact) / exact < 0.01, `area ${area} vs ${exact}`);
});

test("a circle is 4 nodes and 4 curved edges, cut area within 1%", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [wall] = h.walls();
  press(h, { ...WINDOW, height: 1.2, shape: shape({}, true) }, { x: 4, y: 0.9, z: 0 }, undefined, { surfaceRef: ref(wall) });
  const [opening] = h.openings();
  assert.equal(opening.nodes.length, 4, "its four extremes");
  assert.equal(curvedEdges(opening).length, 4, "one cubic per quarter");
  const exact = Math.PI * 0.6 * 0.6;
  const area = outlineArea(h, opening, 8, 3);
  assert.ok(Math.abs(area - exact) / exact < 0.01, `area ${area} vs ${exact}`);
  const run = runFrame(h.runtime, wall.surfaceKey);
  const span = groupRunSpan(run, [opening]);
  assert.ok(near(span.s1 - span.s0, 1.2, 1e-6) && near((span.v1 - span.v0) * 3, 1.2, 1e-6), "its box is still the slider size");
  assert.deepEqual(cutProblems(h, wall), []);
});

test("a circle straddling a seam splits its cubics at the seam, with one continuous cut", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
  line(h.ctx, { x: 4, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [a] = h.walls();
  press(h, { ...WINDOW, width: 1.5, height: 1.5, shape: shape({}, true) }, { x: 4.25, y: 0.8, z: 0 }, undefined, { surfaceRef: ref(a) });
  const pieces = h.openings();
  assert.equal(pieces.length, 2);
  assert.ok(pieces.every((p) => p.nodes.length <= 5 && curvedEdges(p).length >= 2), "each piece: arc ends and seam crossings only");
  const run = runFrame(h.runtime, a.surfaceKey);
  const span = groupRunSpan(run, pieces);
  assert.ok(near(span.s1 - span.s0, 1.5, 1e-6), "the pieces add up to the box");
  const total = pieces.reduce((sum, p) => sum + outlineArea(h, p, 4, 3), 0);
  const exact = Math.PI * 0.75 * 0.75;
  assert.ok(Math.abs(total - exact) / exact < 0.01, `area ${total} vs ${exact}`);
  const seamPins = pieces.flatMap((p) => p.nodes.filter((n) => near(n.position.x, 4, 1e-4)).map((n) => n.position.y)).sort((x, y) => x - y);
  assert.equal(seamPins.length, 4, "each piece crosses the seam at the same two heights");
  assert.ok(near(seamPins[0], seamPins[1], 1e-4) && near(seamPins[2], seamPins[3], 1e-4), `crossings meet: ${seamPins}`);
  for (const wall of h.walls()) assert.deepEqual(cutProblems(h, wall), [], `face ${ref(wall).slice(0, 40)}`);
});

test("move, resize and undo keep a circle's shape and never add nodes", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [wall] = h.walls();
  const CIRCLE = { ...WINDOW, height: 1.2, shape: shape({}, true) };
  press(h, CIRCLE, { x: 3, y: 0.9, z: 0 }, undefined, { surfaceRef: ref(wall) });
  const counts = (o) => [o.nodes.length, curvedEdges(o).length];
  const [placed] = h.openings();
  assert.deepEqual(counts(placed), [4, 4]);

  const grab = { x: 3, y: 1.5, z: 0 };
  press(h, CIRCLE, grab, { x: 5, y: 1.5, z: 0 });
  const [moved] = h.openings();
  assert.notEqual(ref(moved), ref(placed));
  assert.deepEqual(counts(moved), [4, 4], "moved");

  const run = runFrame(h.runtime, wall.surfaceKey);
  const before = groupRunSpan(run, [moved]);
  const mid = (before.v0 + before.v1) / 2 * 3;
  press(h, CIRCLE, { x: before.s1, y: mid, z: 0 }, { x: before.s1 + 0.6, y: mid, z: 0 }, { surfaceRef: openingRefAt(h.openings(), { x: before.s1 - 0.01, y: mid, z: 0 }) });
  const [resized] = h.openings();
  const after = groupRunSpan(run, [resized]);
  assert.ok(near(after.s1 - after.s0, 1.8, 1e-6), `wider: ${after.s1 - after.s0}`);
  assert.deepEqual(counts(resized), [4, 4], "resized");
  const exact = Math.PI * 0.9 * 0.6;
  assert.ok(Math.abs(outlineArea(h, resized, 8, 3) - exact) / exact < 0.01, "an ellipse filling the new box");
  assert.deepEqual(cutProblems(h, wall), []);

  for (const expected of [moved, placed]) {
    const entry = h.ctx.history.undo();
    h.runtime.undoTransaction(entry.transactionId, "local");
    const [back] = h.openings();
    assert.equal(ref(back), ref(expected));
    assert.deepEqual(counts(back), [4, 4], "undo brings the curves back with the piece");
  }
  assert.deepEqual(cutProblems(h, wall), []);
});
