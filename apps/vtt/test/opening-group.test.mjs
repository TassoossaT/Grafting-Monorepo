// Openings across faces: a door or window is a group of pieces, one per
// upright face it covers, edited as one rectangle in run space. Drives the
// real runtime + WASM engine through the opening tool's own gesture model.
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
const { createEditHistoryStack, DEFAULT_TOOL_PARAMS, hasTrait, openingStructureType } = await import("../src/features/edit-construction/index.ts");
const { surfaceRefFromNodeSet } = await import("../src/entities/map/index.ts");
const { openingTool } = await import("../src/composition/tabletop/tools/openings/opening-tool.ts");
const { wallLineTool } = await import("../src/composition/tabletop/tools/walls/wall-line-tool.ts");
const { commitWallStroke } = await import("../src/composition/tabletop/tools/walls/wall-shared.ts");

const ref = (t) => surfaceRefFromNodeSet(t.surfaceKey);
const isOpening = (t) => t.surfaceType === openingStructureType.surfaceType;
const isPartition = (t) => hasTrait(t.surfaceType, "partition");
const WINDOW = { ...DEFAULT_TOOL_PARAMS.opening, openingKind: "window", width: 1.2, height: 1, sill: 1 };

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
  const ctx = {
    runtime, history: createEditHistoryStack(), tableId: "t", snapToGrid: false, structureEditParams: { mode: "shape" },
    nextSequence: () => ++seq, reportSelection() {}, reportFeedback: (f) => f && feedback.push(f),
  };
  openingTool.onCancel(ctx);
  const all = () => runtime.getAllRegionTopologies();
  return { runtime, ctx, pickTargets, feedback, openings: () => all().filter(isOpening), walls: () => all().filter(isPartition) };
}

function line(ctx, a, b) {
  const params = DEFAULT_TOOL_PARAMS["wall-line"];
  wallLineTool.onPointerDown(ctx, { point: a }, params);
  wallLineTool.onPointerUp(ctx, { start: { point: a }, current: { point: b }, samples: [] }, params);
  wallLineTool.onClick?.(ctx, { point: b }, params);
}

/** Two co-linear 4 m panels welded end to end, x in [0, 8]. */
function twoPanelWall(ctx) {
  line(ctx, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
  line(ctx, { x: 4, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
}

function curvyBrushWall(ctx) {
  const stroke = Array.from({ length: 91 }, (_, i) => ({ x: (i / 90) * 24, y: 0, z: 3 * Math.sin((i / 90) * Math.PI * 5) }));
  commitWallStroke(ctx, stroke, 0.25, { wallType: "wall-white", height: 3 }, "wall-brush");
}

/** The opening standing at `point`, by its pieces' pinned rim in world XY -- what a pick would report. */
function openingRefAt(openings, point) {
  const hit = openings.find((o) => {
    const xs = o.nodes.map((n) => n.position.x), ys = o.nodes.map((n) => n.position.y), zs = o.nodes.map((n) => n.position.z);
    return point.x >= Math.min(...xs) - 1e-6 && point.x <= Math.max(...xs) + 1e-6 && point.y >= Math.min(...ys) && point.y <= Math.max(...ys)
      && point.z >= Math.min(...zs) - 1e-6 && point.z <= Math.max(...zs) + 1e-6;
  });
  return hit && ref(hit);
}

function press(h, params, down, up = down, downExtra = {}) {
  const sample = { point: down, surfaceRef: openingRefAt(h.openings(), down), ...downExtra };
  const gesture = { start: { point: down }, current: { point: up }, samples: [{ point: down }, { point: up }] };
  openingTool.onPointerDown(h.ctx, sample, params);
  openingTool.previewFor(gesture, params, h.ctx);
  openingTool.onPointerUp(h.ctx, gesture, params);
  openingTool.onClick(h.ctx, { point: up, surfaceRef: sample.surfaceRef }, params);
}

function clickOnWall(h, params, point, wall) {
  const gesture = { start: { point }, current: { point }, samples: [{ point }] };
  openingTool.onPointerDown(h.ctx, { point, surfaceRef: wall && ref(wall) }, params);
  openingTool.onPointerUp(h.ctx, gesture, params);
  openingTool.onClick(h.ctx, { point, surfaceRef: wall && ref(wall) }, params);
}

/** Every piece's (s, v) span measured through ONE run, so the pieces are compared in the same frame. */
function groupSpans(runtime, pieces) {
  const run = runtime.panelRun(pieces[0].nodes.find((n) => n.pin).pin.hostSurfaceKey);
  return pieces.map((piece) => {
    const hosts = new Set(piece.nodes.map((n) => surfaceRefFromNodeSet(n.pin.hostSurfaceKey)));
    assert.equal(hosts.size, 1, "each piece is pinned to exactly one face");
    const panel = run.panels.find((p) => surfaceRefFromNodeSet(p.surfaceKey) === [...hosts][0]);
    assert.ok(panel, "every piece's face is on the run");
    const ss = piece.nodes.map((n) => panel.offset + (panel.reversed ? 1 - n.pin.u : n.pin.u) * panel.length);
    const vs = piece.nodes.map((n) => n.pin.v);
    return { host: [...hosts][0], s0: Math.min(...ss), s1: Math.max(...ss), v0: Math.min(...vs), v1: Math.max(...vs) };
  }).sort((a, b) => a.s0 - b.s0);
}

/** One group, its pieces contiguous in run space and sharing one v range; returns the whole (s, v) rect. */
function assertOneRect(runtime, pieces) {
  assert.ok(pieces.length >= 1);
  const group = pieces[0].group;
  assert.ok(group, "pieces carry a group id");
  assert.ok(pieces.every((p) => p.group === group), "one group");
  const spans = groupSpans(runtime, pieces);
  for (let i = 1; i < spans.length; i++) {
    assert.ok(Math.abs(spans[i].s0 - spans[i - 1].s1) < 1e-3, `contiguous at the seam: ${spans[i - 1].s1} vs ${spans[i].s0}`);
    assert.ok(Math.abs(spans[i].v0 - spans[0].v0) < 1e-9 && Math.abs(spans[i].v1 - spans[0].v1) < 1e-9, "one v range");
  }
  return { s0: spans[0].s0, s1: spans.at(-1).s1, v0: spans[0].v0, v1: spans[0].v1, spans };
}

/** Möller-Trumbore against every triangle of `mesh`. */
function hits(mesh, origin, dir) {
  const P = mesh.positions, I = mesh.indices ?? Array.from({ length: P.length / 3 }, (_, i) => i);
  for (let i = 0; i < I.length; i += 3) {
    const [a, b, c] = [I[i], I[i + 1], I[i + 2]].map((k) => [P[3 * k], P[3 * k + 1], P[3 * k + 2]]);
    const e1 = b.map((x, k) => x - a[k]), e2 = c.map((x, k) => x - a[k]);
    const p = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const t = origin.map((x, k) => x - a[k]);
    const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]];
    const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const d = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (Math.abs(d) <= 0.5) return true;
  }
  return false;
}

/** Whether any wall is drawn at run point (s, v), probing along the face normal there. */
function wallDrawnAt(h, run, s, v) {
  const panel = run.panels.find((p) => s >= p.offset - 1e-9 && s <= p.offset + p.length + 1e-9);
  const uAt = (x) => { const t = (x - panel.offset) / panel.length; return panel.reversed ? 1 - t : t; };
  const [at, ahead] = h.runtime.resolveOnHost({ hostSurfaceKey: panel.surfaceKey, uv: [[uAt(s), v], [uAt(s + 1e-3), v]] });
  const tangent = [ahead.x - at.x, 0, ahead.z - at.z];
  const len = Math.hypot(tangent[0], tangent[2]);
  const normal = [-tangent[2] / len, 0, tangent[0] / len];
  const origin = [at.x - normal[0] * 0.25, at.y, at.z - normal[2] * 0.25];
  return h.walls().some((w) => { const mesh = h.pickTargets.get(ref(w)); return mesh && hits(mesh, origin, normal); });
}

test("a window clicked on the seam of a 2-panel straight wall becomes one group of 2 pieces with one continuous cut", async () => {
  const h = await harness();
  twoPanelWall(h.ctx);
  const [a] = h.walls();
  const run = h.runtime.panelRun(a.surfaceKey);
  assert.equal(run.panels.length, 2, "the two segments form one run");

  clickOnWall(h, WINDOW, { x: 4, y: 1.5, z: 0 }, a);
  const pieces = h.openings();
  assert.equal(pieces.length, 2, "one piece per face");
  const rect = assertOneRect(h.runtime, pieces);
  assert.ok(Math.abs(rect.s1 - rect.s0 - WINDOW.width) < 1e-4, "the pieces add up to the slider width");
  assert.ok(Math.abs(rect.spans[0].s1 - 4) < 1e-4, "split exactly at the seam");
  assert.equal(new Set(rect.spans.map((s) => s.host)).size, 2, "one piece on each face");
  const vMid = (rect.v0 + rect.v1) / 2;
  for (const s of [rect.s0 + 0.05, 3.99, 4, 4.01, rect.s1 - 0.05]) assert.ok(!wallDrawnAt(h, run, s, vMid), `wall cut at s=${s}`);
  for (const s of [rect.s0 - 0.1, rect.s1 + 0.1]) assert.ok(wallDrawnAt(h, run, s, vMid), `wall kept beside the window at s=${s}`);
});

test("a window clicked on the seam of a brush-drawn curved wall splits into 2 pieces on the curve with a continuous cut", async () => {
  const h = await harness();
  curvyBrushWall(h.ctx);
  const [first] = h.walls();
  const run = h.runtime.panelRun(first.surfaceKey);
  assert.ok(run.panels.length >= 2, `the brush wall is a run of several faces, got ${run.panels.length}`);
  const seamS = run.panels[1].offset;
  const panel = run.panels[1];
  const [point] = h.runtime.resolveOnHost({ hostSurfaceKey: panel.surfaceKey, uv: [[panel.reversed ? 1 : 0, 0.5]] });

  clickOnWall(h, WINDOW, point, h.walls().find((w) => ref(w) === surfaceRefFromNodeSet(panel.surfaceKey)));
  const pieces = h.openings();
  assert.equal(pieces.length, 2, "one piece per face");
  const rect = assertOneRect(h.runtime, pieces);
  assert.ok(Math.abs(rect.spans[0].s1 - seamS) < 1e-3, "split at the seam");
  assert.ok(Math.abs(rect.s1 - rect.s0 - WINDOW.width) < 1e-3, "the pieces add up to the slider width");
  const vMid = (rect.v0 + rect.v1) / 2;
  for (const s of [seamS - 0.3, seamS - 0.01, seamS + 0.01, seamS + 0.3]) assert.ok(!wallDrawnAt(h, run, s, vMid), `wall cut at s=${s}`);
  assert.ok(pieces.every((p) => p.nodes.length === 4), "each piece is its four corners, no densified sides");
  assert.ok(pieces.some((p) => h.runtime.hostOutline(p.surfaceKey).uv.length > 4), "a piece on a curved face follows the curve in its host's frame, not one chord");
});

test("dragging a window across a seam splits it over both faces, and dragging it back folds it onto one again", async () => {
  const h = await harness();
  twoPanelWall(h.ctx);
  const [a] = h.walls();
  clickOnWall(h, { ...WINDOW, width: 1 }, { x: 2, y: 1, z: 0 }, a); // [1.5, 2.5] x [1, 2]
  assert.equal(h.openings().length, 1);

  press(h, WINDOW, { x: 2, y: 1.5, z: 0 }, { x: 4.3, y: 1.5, z: 0 });
  let pieces = h.openings();
  assert.equal(pieces.length, 2, "straddles the seam now");
  let rect = assertOneRect(h.runtime, pieces);
  assert.ok(Math.abs(rect.s0 - 3.8) < 1e-6 && Math.abs(rect.s1 - 4.8) < 1e-6, `moved as one: [${rect.s0}, ${rect.s1}]`);

  press(h, WINDOW, { x: 4.3, y: 1.5, z: 0 }, { x: 2, y: 1.5, z: 0 });
  pieces = h.openings();
  assert.equal(pieces.length, 1, "back on one face");
  rect = assertOneRect(h.runtime, pieces);
  assert.ok(Math.abs(rect.s0 - 1.5) < 1e-6 && Math.abs(rect.s1 - 2.5) < 1e-6, `moved back: [${rect.s0}, ${rect.s1}]`);
});

test("resizing a window's edge across a seam grows a second piece on the next face", async () => {
  const h = await harness();
  twoPanelWall(h.ctx);
  const [a] = h.walls();
  clickOnWall(h, { ...WINDOW, width: 1 }, { x: 2, y: 1, z: 0 }, a); // [1.5, 2.5] x [1, 2]

  press(h, WINDOW, { x: 2.5, y: 1.5, z: 0 }, { x: 5, y: 1.5, z: 0 });
  const pieces = h.openings();
  assert.equal(pieces.length, 2);
  const rect = assertOneRect(h.runtime, pieces);
  assert.ok(Math.abs(rect.s0 - 1.5) < 1e-6, "the left edge stays");
  assert.ok(Math.abs(rect.s1 - 5) < 1e-6, "the right edge follows onto the next face");

  // And the left edge of the straddling group back past the seam: one piece again.
  press(h, WINDOW, { x: 1.5, y: 1.5, z: 0 }, { x: 4.4, y: 1.5, z: 0 });
  const after = h.openings();
  assert.equal(after.length, 1);
  const shrunk = assertOneRect(h.runtime, after);
  assert.ok(Math.abs(shrunk.s0 - 4.4) < 1e-6 && Math.abs(shrunk.s1 - 5) < 1e-6);
});

test("a window wraps an L corner: one piece on each leg, meeting at the corner", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });
  line(h.ctx, { x: 6, y: 0, z: 0 }, { x: 6, y: 0, z: 6 });
  const legA = h.walls().find((w) => w.nodes.every((n) => Math.abs(n.position.z) < 1e-9));
  assert.equal(h.runtime.panelRun(legA.surfaceKey).panels.length, 2, "the corner joins one run");

  clickOnWall(h, { ...WINDOW, width: 2 }, { x: 5.5, y: 1.5, z: 0 }, legA);
  const pieces = h.openings();
  assert.equal(pieces.length, 2);
  assertOneRect(h.runtime, pieces);
  const onA = pieces.find((p) => p.nodes.every((n) => Math.abs(n.position.z) < 1e-6));
  const onB = pieces.find((p) => p.nodes.every((n) => Math.abs(n.position.x - 6) < 1e-6));
  assert.ok(onA && onB, "one piece per leg");
  assert.ok(Math.abs(Math.min(...onA.nodes.map((n) => n.position.x)) - 4.5) < 1e-6);
  assert.ok(Math.abs(Math.max(...onB.nodes.map((n) => n.position.z)) - 0.5) < 1e-6);
});

test("the whole group selects and deletes together, and overlap is refused against any of its pieces", async () => {
  const h = await harness();
  twoPanelWall(h.ctx);
  const [a] = h.walls();
  clickOnWall(h, WINDOW, { x: 4, y: 1.5, z: 0 }, a); // [3.4, 4.6]
  assert.equal(h.openings().length, 2);

  clickOnWall(h, { ...WINDOW, width: 1 }, { x: 5, y: 1.5, z: 0 }, h.walls().find((w) => w.nodes.some((n) => n.position.x > 7)));
  assert.equal(h.openings().length, 2, "overlapping the second piece is refused");

  press(h, WINDOW, { x: 4.3, y: 2, z: 0 });
  openingTool.onDeleteKey(h.ctx);
  assert.equal(h.openings().length, 0, "both pieces go with one Delete");
});

test("undo after moving a straddling window restores its two pieces as one group", async () => {
  const h = await harness();
  twoPanelWall(h.ctx);
  const [a] = h.walls();
  clickOnWall(h, WINDOW, { x: 4, y: 1.5, z: 0 }, a);
  const before = h.openings();
  const groupBefore = before[0].group;
  const spansBefore = assertOneRect(h.runtime, before);

  press(h, WINDOW, { x: 4, y: 2, z: 0 }, { x: 6, y: 2, z: 0 });
  assert.equal(h.openings().length, 1, "moved wholly onto the second face");

  const entry = h.ctx.history.undo();
  assert.equal(entry.kind, "transaction");
  h.runtime.undoTransaction(entry.transactionId, "local");
  const restored = h.openings();
  assert.equal(restored.length, 2);
  assert.ok(restored.every((p) => p.group === groupBefore), "the same group comes back");
  const spansAfter = assertOneRect(h.runtime, restored);
  assert.ok(Math.abs(spansAfter.s0 - spansBefore.s0) < 1e-9 && Math.abs(spansAfter.s1 - spansBefore.s1) < 1e-9);
});

test("an opening from before groups (one ungrouped region) still selects, moves and deletes as a group of one", async () => {
  const h = await harness();
  twoPanelWall(h.ctx);
  const [a] = h.walls();
  clickOnWall(h, { ...WINDOW, width: 1 }, { x: 2, y: 1, z: 0 }, a);
  const [legacy] = h.openings();
  h.runtime.setRegionGroup([legacy.surfaceKey], null);
  assert.equal(h.openings()[0].group, undefined, "ungrouped, as before groups existed");

  press(h, WINDOW, { x: 2, y: 1.5, z: 0 }, { x: 4, y: 1.5, z: 0 });
  const moved = h.openings();
  assert.equal(moved.length, 2, "moved onto the seam, now split");
  assertOneRect(h.runtime, moved);

  press(h, WINDOW, { x: 4, y: 1.5, z: 0 });
  openingTool.onDeleteKey(h.ctx);
  assert.equal(h.openings().length, 0);
});

test("an old densified opening (extra pinned nodes along its sides) still moves, and comes back as four corners", async () => {
  const h = await harness();
  line(h.ctx, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
  const [wall] = h.walls();
  const ring = [[1.5, 1], [2, 1], [2.5, 1], [2.5, 1.5], [2.5, 2], [2, 2], [1.5, 2], [1.5, 1.5]];
  const nodes = ring.map(([x, y], i) => ({ id: `legacy:c${i}`, position: { x, y, z: 0 } }));
  const edges = nodes.map((n, i) => ({ edgeId: `legacy:e${i}`, startNodeId: n.id, endNodeId: nodes[(i + 1) % nodes.length].id }));
  h.runtime.addPatch({ nodes, edges, regions: [{ regionId: "legacy", boundary: edges.map((e) => ({ edgeId: e.edgeId, reversed: false })), surfaceType: openingStructureType.surfaceType, physical: false }] }, "local", "legacy");
  const uv = h.runtime.projectToHost({ hostSurfaceKey: wall.surfaceKey, points: nodes.map((n) => n.position) });
  h.runtime.pinNodes(nodes.map((n, i) => ({ nodeId: n.id, hostSurfaceKey: wall.surfaceKey, u: uv[i].u, v: uv[i].v })), "local", "legacy");
  const [legacy] = h.openings();
  assert.equal(legacy.nodes.length, 8);
  assert.equal(legacy.group, undefined);

  press(h, WINDOW, { x: 2, y: 1.5, z: 0 }, { x: 5, y: 1.5, z: 0 });
  const [moved, ...rest] = h.openings();
  assert.equal(rest.length, 0);
  assert.equal(moved.nodes.length, 4, "rebuilt clean on its first edit");
  const rect = assertOneRect(h.runtime, [moved]);
  assert.ok(Math.abs(rect.s0 - 4.5) < 1e-6 && Math.abs(rect.s1 - 5.5) < 1e-6, `moved as its box: [${rect.s0}, ${rect.s1}]`);
});
