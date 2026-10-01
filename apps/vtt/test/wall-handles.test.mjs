import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createAliasResolveHook } from "./support/alias-resolve-hook.mjs";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { hasTrait, sceneHandles, shownGlobalHandles } from "../src/features/edit-construction/index.ts";

registerHooks(createAliasResolveHook(new URL("../src/", import.meta.url)));
const { wallLineTool } = await import("../src/composition/tabletop/tools/walls/wall-line-tool.ts");

/**
 * A wall is edited by its handles, like a platform: its foot moves where a
 * post stands, its top only how high that side rises, a run's side drags it
 * across; pivot and rotate move it whole, and one joined to another
 * structure can be let go of.
 */

const params = { wallType: "wall-white", height: 3 };
function fixture(onPlatform = false) {
  const f = sessionFixture();
  Object.assign(f.runtime, { showPreview() {}, clearPreview() {} });
  // As the table plays: the ruler's snap is on.
  Object.assign(f.ctx, { rulerSnap: true });
  if (onPlatform) commitPlatformContour(f.ctx, [[0, 0], [6, 0], [6, 4], [0, 4]].map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support: "floating", shape: "rectangle" });
  const y = onPlatform ? 2 : 0;
  const start = { point: { x: 1, y, z: 0 } }, end = { point: { x: 5, y, z: 0 } };
  wallLineTool.onPointerDown(f.ctx, start, params);
  wallLineTool.onPointerUp(f.ctx, { start, current: end, samples: [start, end] }, params);
  return f;
}
const scene = (runtime) => ({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (q) => runtime.cloudFor(q) });
const wallHandles = (runtime) => shownGlobalHandles(scene(runtime)).filter((h) => hasTrait(h.owner, "partition"));
const wallOf = (runtime) => runtime.getAllRegionTopologies().find((t) => hasTrait(t.surfaceType, "partition"));
const at = (runtime) => new Map(runtime.getGraphSnapshot().nodes.map((n) => [n.id, n.position]));
/** Posts of the wall, each as its foot and top positions, left to right. */
function posts(runtime) {
  const w = wallOf(runtime), p = at(runtime);
  const ys = w.nodes.map((n) => n.position.y), mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const feet = w.nodes.filter((n) => n.position.y < mid).map((n) => p.get(n.id));
  const tops = w.nodes.filter((n) => n.position.y >= mid).map((n) => p.get(n.id));
  const near = (f) => tops.reduce((best, t) => (Math.hypot(t.x - f.x, t.z - f.z) < Math.hypot(best.x - f.x, best.z - f.z) ? t : best));
  return feet.sort((a, b) => a.x - b.x).map((foot) => ({ foot, top: near(foot) }));
}
/** Drags `handle` by `delta` in the world, `rise` units up the screen. */
function drag({ ctx }, handle, delta, rise = 0, tool = wallLineTool, toolParams = params) {
  const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
  const current = { point: { x: handle.position.x + delta.x, y: handle.position.y + delta.y, z: handle.position.z + delta.z }, screenX: 100 + 40 * Math.hypot(delta.x, delta.z), screenY: 300 - rise * 40 };
  tool.onPointerDown(ctx, start, toolParams);
  tool.onPointerMove(ctx, { start, current, samples: [start, current] }, toolParams);
  tool.onPointerUp(ctx, { start, current, samples: [start, current] }, toolParams);
}
const lastFeedback = (calls) => JSON.stringify(calls.feedback.filter(Boolean));
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("a wall shows pivot and rotate, a foot handle each side of every post, a top handle above it, and a side handle each side of its foot run", () => {
  const { runtime, session } = fixture();
  try {
    const handles = wallHandles(runtime);
    const count = (kind) => handles.filter((h) => h.kind === kind).length;
    assert.deepEqual({ pivot: count("pivot"), rotate: count("rotate"), foot: count("foot"), top: count("top"), side: count("side"), detach: count("detach") }, { pivot: 1, rotate: 1, foot: 4, top: 2, side: 2, detach: 0 });
    // Foot and side handles stand off the face, one each way; tops stand just above.
    for (const h of handles.filter((h) => h.kind === "foot" || h.kind === "side")) assert.ok(Math.abs(h.position.z) > 0.3 && Math.sign(h.position.z) === Math.sign(h.facing.z), JSON.stringify(h));
    for (const h of handles.filter((h) => h.kind === "top")) assert.ok(h.position.y > 3, JSON.stringify(h.position));
  } finally { session.free(); }
});

test("the scene shows only the side of a wall facing the viewer", () => {
  const { runtime, session } = fixture();
  try {
    const face = wallOf(runtime).surfaceKey.join("\u0000");
    const input = { ...scene(runtime), contour: [], pointsOnly: false, owns: () => true };
    const seen = (viewer) => {
      const ids = new Set(sceneHandles({ ...input, focus: { faces: new Set([face]), spineNodes: new Set(), viewer } }).map((h) => h.id));
      return wallHandles(runtime).filter((h) => ids.has(h.id));
    };
    // Looking toward +z the viewer stands on the -z side: only handles facing -z show there.
    for (const viewer of [{ x: 0, z: 1 }, { x: 0, z: -1 }]) {
      const shown = seen(viewer);
      const sided = shown.filter((h) => h.facing);
      assert.equal(sided.length, 3, JSON.stringify(sided.map((h) => h.id)));
      assert.ok(sided.every((h) => h.facing.z * viewer.z < 0));
      assert.equal(shown.filter((h) => h.kind === "top").length, 2, "tops show from either side");
    }
  } finally { session.free(); }
});

test("a wall's foot handle moves where the post stands, its top following straight above at the same height", () => {
  const f = fixture();
  try {
    const before = posts(f.runtime);
    const handle = wallHandles(f.runtime).find((h) => h.kind === "foot" && close(h.pivot.x, 1));
    drag(f, handle, { x: -0.5, y: 0, z: 0.7 });
    const after = posts(f.runtime);
    assert.ok(close(after[0].foot.x, 0.5) && close(after[0].foot.z, 0.7), `${JSON.stringify(after[0])} ${lastFeedback(f.calls)}`);
    assert.ok(close(after[0].top.x, after[0].foot.x) && close(after[0].top.z, after[0].foot.z), "the top straight above");
    assert.ok(close(after[0].top.y - after[0].foot.y, before[0].top.y - before[0].foot.y), "the same height");
    assert.deepEqual(after[1], before[1], "the other post stays");
  } finally { f.session.free(); }
});

test("dragging a wall's top says exactly how high the wall stands now, and how much that changed", () => {
  const f = fixture();
  const shown = [];
  f.ctx.showRuler = (feedback) => shown.push(feedback);
  try {
    const standing = posts(f.runtime)[1];
    const handle = wallHandles(f.runtime).find((h) => h.kind === "top" && close(h.pivot.x, 5));
    drag(f, handle, { x: 0, y: 1, z: 0 }, 1);
    const measures = shown.filter(Boolean).at(-1).measures;
    const height = measures.find((m) => m.kind === "height");
    // As high as the wall stood from its foot, plus the one it is lifted by: its exact height, not only the change.
    assert.ok(close(height.meters, standing.top.y - standing.foot.y + 1), JSON.stringify(measures));
    assert.ok(close(height.level, standing.top.y + 1));
    assert.ok(close(measures.find((m) => m.kind === "change").meters, 1));
  } finally { f.session.free(); }
});

test("a wall's top handle changes only how high its side rises, never where it stands", () => {
  const f = fixture();
  try {
    const before = posts(f.runtime);
    const handle = wallHandles(f.runtime).find((h) => h.kind === "top" && close(h.pivot.x, 5));
    // The pointer wanders across as well as up: only the rise counts.
    drag(f, handle, { x: 1, y: 0, z: 1 }, 1);
    const after = posts(f.runtime);
    assert.ok(close(after[1].top.y, before[1].top.y + 1), `${JSON.stringify(after[1])} ${lastFeedback(f.calls)}`);
    assert.ok(close(after[1].top.x, 5) && close(after[1].top.z, 0), "it stands where it stood");
    assert.deepEqual(after[1].foot, before[1].foot);
    assert.deepEqual(after[0], before[0], "the other side keeps its height");
  } finally { f.session.free(); }
});

test("a wall's side handle drags its run across, square to it, the tops coming along", () => {
  const f = fixture();
  try {
    const before = posts(f.runtime);
    const handle = wallHandles(f.runtime).find((h) => h.kind === "side" && h.facing.z > 0);
    // Along the run as well as across: only across counts.
    drag(f, handle, { x: 2, y: 0, z: 0.8 });
    const after = posts(f.runtime);
    for (const [i, post] of after.entries()) {
      assert.ok(close(post.foot.x, before[i].foot.x) && close(post.foot.z, 0.8), `${JSON.stringify(post)} ${lastFeedback(f.calls)}`);
      assert.ok(close(post.top.x, post.foot.x) && close(post.top.z, post.foot.z) && close(post.top.y, before[i].top.y), "its top straight above, as high");
    }
  } finally { f.session.free(); }
});

test("a wall on a platform can be let go of: its detach handle gives it feet of its own, and then there is nothing left to let go", () => {
  const f = fixture(true);
  try {
    const shared = () => {
      const floorNodes = new Set(f.runtime.getAllRegionTopologies().filter((t) => hasTrait(t.surfaceType, "floor")).flatMap((t) => t.nodes.map((n) => n.id)));
      return wallOf(f.runtime).nodes.filter((n) => floorNodes.has(n.id)).length;
    };
    assert.ok(shared() > 0, "joined to begin with");
    const handle = wallHandles(f.runtime).find((h) => h.kind === "detach");
    assert.ok(handle, "a joined wall shows a detach handle");
    const before = posts(f.runtime);
    drag(f, handle, { x: 0, y: 0, z: 0 });
    assert.equal(shared(), 0, lastFeedback(f.calls));
    assert.deepEqual(posts(f.runtime), before, "letting go moves nothing");
    assert.equal(wallHandles(f.runtime).filter((h) => h.kind === "detach").length, 0);
  } finally { f.session.free(); }
});

test("a structure's handles show as the pointer comes near it, not only once it is over it -- and the nearest one's, and none far away", async () => {
  const { handleFocusAt, NO_FOCUS } = await import("../src/composition/tabletop/tools/core/handle-focus.ts");
  const f = fixture(true);
  try {
    const all = () => true;
    // Straight down at a point on the ground.
    const down = (x, z) => ({ point: { x, y: 0, z }, ray: { origin: { x, y: 20, z }, direction: { x: 0, y: -1, z: 0 } } });
    const focused = (sample) => {
      const focus = handleFocusAt(f.ctx, sample, NO_FOCUS, all);
      return f.runtime.getAllRegionTopologies().filter((t) => focus.faces.has(t.surfaceKey.join("\u0000"))).map((t) => t.surfaceType);
    };
    // The platform spans 0..6 by 0..4 at height 2: just past its far side, where its handles stand.
    assert.deepEqual(focused(down(3, 4.8)), ["platform"]);
    // The wall stands along z = 0 from x = 1 to 5, on the platform's near side: just off it, beside its foot handles.
    assert.ok(focused(down(3, -0.5)).some((type) => hasTrait(type, "partition")), JSON.stringify(focused(down(3, -0.5))));
    assert.deepEqual(focused(down(3, 9)), [], "far from everything, nothing");
    // Level with a wall's top, from the side: its top handles are within reach.
    const side = { point: { x: 3, y: 5.3, z: -5 }, ray: { origin: { x: 3, y: 5.3, z: -10 }, direction: { x: 0, y: 0, z: 1 } } };
    assert.ok(focused(side).some((type) => hasTrait(type, "partition")), JSON.stringify(focused(side)));
  } finally { f.session.free(); }
});

/** The platform's corners, where they stand -- what must not change when a wall on it is edited. */
const platformCorners = (runtime) => {
  const floor = runtime.getAllRegionTopologies().find((t) => hasTrait(t.surfaceType, "floor"));
  return floor.nodes.map((n) => n.position).filter((p) => [0, 6].includes(Math.round(p.x * 1e4) / 1e4) && [0, 4].includes(Math.round(p.z * 1e4) / 1e4))
    .map((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`).sort();
};
const floorHolds = (runtime, position) => runtime.getAllRegionTopologies().find((t) => hasTrait(t.surfaceType, "floor")).nodes
  .some((n) => Math.hypot(n.position.x - position.x, n.position.y - position.y, n.position.z - position.z) < 1e-4);
const floorNodeIds = (runtime) => new Set(runtime.getAllRegionTopologies().filter((t) => hasTrait(t.surfaceType, "floor")).flatMap((t) => t.nodes.map((n) => n.id)));

test("a wall's foot on a platform slides along its side without moving it, snaps onto the side, and is joined to it where it lands -- one undo", () => {
  const f = fixture(true);
  try {
    const corners = platformCorners(f.runtime);
    const handle = wallHandles(f.runtime).find((h) => h.kind === "foot" && close(h.pivot.x, 1));
    // Along the side, a little off it.
    drag(f, handle, { x: -0.5, y: 0, z: 0.1 });
    const foot = posts(f.runtime)[0].foot;
    assert.ok(close(foot.x, 0.5, 1e-4) && close(foot.z, 0, 1e-4), `onto the side: ${JSON.stringify(foot)} ${lastFeedback(f.calls)}`);
    assert.deepEqual(platformCorners(f.runtime), corners, "the platform stays where it was");
    const w = wallOf(f.runtime), floors = floorNodeIds(f.runtime);
    assert.ok(w.nodes.some((n) => floors.has(n.id) && close(n.position.x, 0.5, 1e-4)), "joined where it landed");
    const entry = f.ctx.history.undo();
    assert.equal(entry.kind, "transaction");
    f.session.undo_region_overlay(entry.transactionId);
    assert.ok(close(posts(f.runtime)[0].foot.x, 1, 1e-6), "undone whole");
  } finally { f.session.free(); }
});

test("a wall's foot on a platform dragged in off its side stands loose there, the platform left as it was", () => {
  const f = fixture(true);
  try {
    // Placed freely (Ctrl): the ruler would otherwise square the foot to the wall's other end.
    f.ctx.rulerSnap = false;
    const corners = platformCorners(f.runtime);
    const handle = wallHandles(f.runtime).find((h) => h.kind === "foot" && close(h.pivot.x, 1));
    drag(f, handle, { x: 0.5, y: 0, z: 1.5 });
    const foot = posts(f.runtime)[0].foot;
    assert.ok(close(foot.x, 1.5, 1e-4) && close(foot.z, 1.5, 1e-4), `${JSON.stringify(foot)} ${lastFeedback(f.calls)}`);
    assert.deepEqual(platformCorners(f.runtime), corners);
    assert.ok(!floorHolds(f.runtime, foot), "not joined");
    // Its other foot stays joined.
    assert.ok(floorHolds(f.runtime, posts(f.runtime)[1].foot));
  } finally { f.session.free(); }
});

test("a loose wall moved whole snaps onto a platform's side and is joined to it along it", () => {
  const f = sessionFixture();
  Object.assign(f.runtime, { showPreview() {}, clearPreview() {} });
  // As the table plays: the ruler's snap is on.
  Object.assign(f.ctx, { rulerSnap: true });
  try {
    commitPlatformContour(f.ctx, [[0, 0], [6, 0], [6, 4], [0, 4]].map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support: "floating", shape: "rectangle" });
    const start = { point: { x: 1, y: 2, z: 1 } }, end = { point: { x: 5, y: 2, z: 1 } };
    wallLineTool.onPointerDown(f.ctx, start, params);
    wallLineTool.onPointerUp(f.ctx, { start, current: end, samples: [start, end] }, params);
    const pivot = wallHandles(f.runtime).find((h) => h.kind === "pivot");
    drag(f, pivot, { x: 0, y: 0, z: -0.9 });
    for (const { foot } of posts(f.runtime)) {
      assert.ok(close(foot.z, 0, 1e-4), `onto the side: ${JSON.stringify(foot)} ${lastFeedback(f.calls)}`);
      assert.ok(floorHolds(f.runtime, foot) && floorNodeIds(f.runtime).size > 4, "joined");
    }
  } finally { f.session.free(); }
});

test("a platform's side pushed out snaps onto the run a wall beside it stands on, and takes the wall's feet into its outline", () => {
  const f = sessionFixture();
  Object.assign(f.runtime, { showPreview() {}, clearPreview() {} });
  // As the table plays: the ruler's snap is on.
  Object.assign(f.ctx, { rulerSnap: true });
  try {
    commitPlatformContour(f.ctx, [[0, 0], [6, 0], [6, 4], [0, 4]].map(([x, z]) => ({ point: { x, y: 0, z } })), { mode: "create", elevation: 0, support: "floating", shape: "rectangle" });
    const start = { point: { x: 1, y: 0, z: 5 } }, end = { point: { x: 5, y: 0, z: 5 } };
    wallLineTool.onPointerDown(f.ctx, start, params);
    wallLineTool.onPointerUp(f.ctx, { start, current: end, samples: [start, end] }, params);
    const side = shownGlobalHandles(scene(f.runtime)).find((h) => h.owner.startsWith("platform") && h.kind === "side" && h.motion.direction.z > 0.9);
    drag(f, side, { x: 0, y: 0, z: 0.9 }, 0, platformContourTool, platformContourTool.defaultParams());
    assert.ok(posts(f.runtime).every(({ foot }) => floorHolds(f.runtime, foot)), `the wall's feet in the platform's outline: ${lastFeedback(f.calls)}`);
  } finally { f.session.free(); }
});

test("a wall standing in the middle of a platform, joined to it by no node, goes wherever the platform goes: moved, raised and turned with it", () => {
  const platformHandle = (runtime, kind) => shownGlobalHandles(scene(runtime)).find((h) => h.kind === kind && hasTrait(h.owner, "floor"));
  for (const [kind, delta, rise] of [["pivot", { x: 1, y: 0, z: 1 }, 0], ["height", { x: 0, y: 0, z: 0 }, 1], ["rotate", null, 0]]) {
    const f = sessionFixture();
    Object.assign(f.runtime, { showPreview() {}, clearPreview() {} });
    try {
      commitPlatformContour(f.ctx, [[0, 0], [6, 0], [6, 4], [0, 4]].map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, shape: "rectangle" });
      const start = { point: { x: 2, y: 2, z: 1.5 } }, end = { point: { x: 4, y: 2, z: 1.5 } };
      wallLineTool.onPointerDown(f.ctx, start, params);
      wallLineTool.onPointerUp(f.ctx, { start, current: end, samples: [start, end] }, params);
      const floorIds = new Set(f.runtime.getAllRegionTopologies().filter((t) => hasTrait(t.surfaceType, "floor")).flatMap((t) => t.nodes.map((n) => n.id)));
      assert.ok(wallOf(f.runtime).nodes.every((n) => !floorIds.has(n.id)), "the wall shares no node with the platform");
      const before = posts(f.runtime);
      const handle = platformHandle(f.runtime, kind);
      if (kind === "rotate") {
        const a = Math.atan2(handle.position.z - handle.pivot.z, handle.position.x - handle.pivot.x) + Math.PI / 2;
        const r = Math.hypot(handle.position.x - handle.pivot.x, handle.position.z - handle.pivot.z);
        const to = { x: handle.pivot.x + r * Math.cos(a) - handle.position.x, y: 0, z: handle.pivot.z + r * Math.sin(a) - handle.position.z };
        drag(f, handle, to, 0, platformContourTool, platformContourTool.defaultParams());
      } else drag(f, handle, delta, rise, platformContourTool, platformContourTool.defaultParams());
      assert.equal(f.calls.feedback.filter(Boolean).at(-1)?.tone, "success", `${kind}: ${lastFeedback(f.calls)}`);
      const after = posts(f.runtime);
      const floor = f.runtime.getAllRegionTopologies().find((t) => hasTrait(t.surfaceType, "floor"));
      const floorY = floor.nodes[0].position.y;
      for (const post of after) assert.ok(close(post.foot.y, floorY, 1e-6), `${kind}: the wall still stands on the platform: ${JSON.stringify(post)} at ${floorY}`);
      if (kind === "pivot") for (const [i, post] of after.entries()) assert.ok(close(post.foot.x, before[i].foot.x + 1, 1e-6) && close(post.foot.z, before[i].foot.z + 1, 1e-6), `pivot: moved with it ${JSON.stringify(post)}`);
      if (kind === "height") assert.ok(close(floorY, 3, 1e-6), "raised");
      if (kind === "rotate") assert.ok(after.some((post, i) => Math.hypot(post.foot.x - before[i].foot.x, post.foot.z - before[i].foot.z) > 0.5), "turned with it");
    } finally { f.session.free(); }
  }
});

test("with a round number chosen, dragging a wall's top lands its height on a whole number above its foot", () => {
  const f = fixture();
  const shown = [];
  f.ctx.showRuler = (feedback) => shown.push(feedback);
  f.ctx.rulerLengthStep = 0.5;
  try {
    const standing = posts(f.runtime)[1];
    const wall = standing.top.y - standing.foot.y;
    const handle = wallHandles(f.runtime).find((h) => h.kind === "top" && close(h.pivot.x, 5));
    // Lifted to a hair off a half: 1.02 above where it stood.
    const target = Math.round((wall + 1.02) / 0.5) * 0.5;
    drag(f, handle, { x: 0, y: target - wall + 0.03, z: 0 }, 1);
    const height = shown.filter(Boolean).at(-1).measures.find((m) => m.kind === "height");
    assert.ok(Math.abs(height.meters - target) < 1e-6, `rounded to ${target}, not left at ${target + 0.03}: ${JSON.stringify(shown.filter(Boolean).at(-1))}`);
    assert.ok(shown.filter(Boolean).at(-1).guides.some((g) => g.kind === "step"), "the round number is marked");
    // With the ruler's snap off, it is as dragged.
    f.ctx.rulerSnap = false;
  } finally { f.session.free(); }
});

test("dragging a wall's foot measures the side from the neighbour that stays, never from the vertex that left", () => {
  const f = fixture();
  const shown = [];
  f.ctx.showRuler = (feedback) => shown.push(feedback);
  try {
    const [left, right] = posts(f.runtime).map((p) => p.foot);
    const handle = wallHandles(f.runtime).find((h) => h.kind === "foot" && close(h.pivot.x, right.x));
    drag(f, handle, { x: 0.3, y: 0, z: 2 });
    const measures = shown.filter(Boolean).at(-1).measures;
    const lengths = measures.filter((m) => m.kind === "length");
    assert.ok(lengths.length > 0, JSON.stringify(measures));
    assert.ok(lengths.every((m) => close(m.from.x, left.x, 1e-4) && close(m.from.z, left.z, 1e-4)), `anchored at the fixed end: ${JSON.stringify(lengths)}`);
    assert.ok(!lengths.some((m) => close(m.from.x, right.x, 1e-4) && close(m.from.z, right.z, 1e-4)), "none starts at the old vertex");
  } finally { f.session.free(); }
});

test("dragging a wall's top shows the grade of the run beside it", () => {
  const f = fixture();
  const shown = [];
  f.ctx.showRuler = (feedback) => shown.push(feedback);
  try {
    const handle = wallHandles(f.runtime).find((h) => h.kind === "top" && close(h.pivot.x, 5));
    drag(f, handle, { x: 0, y: 1, z: 0 }, 1);
    const grade = shown.filter(Boolean).at(-1).measures.find((m) => m.kind === "grade");
    assert.ok(grade && grade.rise > 0 && grade.run > 0, JSON.stringify(shown.filter(Boolean).at(-1).measures));
  } finally { f.session.free(); }
});

test("dragging a wall's foot also says what its side was and what it is now, and how far the vertex went", () => {
  const f = fixture();
  const shown = [];
  f.ctx.showRuler = (feedback) => shown.push(feedback);
  try {
    const [left, right] = posts(f.runtime).map((p) => p.foot);
    const handle = wallHandles(f.runtime).find((h) => h.kind === "foot" && close(h.pivot.x, right.x));
    drag(f, handle, { x: 0.3, y: 0, z: 2 });
    const measures = shown.filter(Boolean).at(-1).measures;
    const was = measures.find((m) => m.kind === "was");
    assert.ok(was, JSON.stringify(measures));
    assert.ok(close(was.was, Math.hypot(right.x - left.x, right.z - left.z), 1e-4), "what the side was before the edit");
    assert.ok(was.now > was.was, "and what it is now");
    assert.ok(measures.some((m) => m.kind === "change" && m.name === "desloc." && m.meters > 0));
  } finally { f.session.free(); }
});

test("dragging a wall's top says the height it was and the height it is", () => {
  const f = fixture();
  const shown = [];
  f.ctx.showRuler = (feedback) => shown.push(feedback);
  try {
    const standing = posts(f.runtime)[1];
    const handle = wallHandles(f.runtime).find((h) => h.kind === "top" && close(h.pivot.x, 5));
    drag(f, handle, { x: 0, y: 1, z: 0 }, 1);
    const was = shown.filter(Boolean).at(-1).measures.find((m) => m.kind === "was");
    assert.ok(was && close(was.now - was.was, 1, 0.2), JSON.stringify(shown.filter(Boolean).at(-1).measures));
  } finally { f.session.free(); }
});
