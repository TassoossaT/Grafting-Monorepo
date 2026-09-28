import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createAliasResolveHook } from "./support/alias-resolve-hook.mjs";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
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
function drag({ ctx }, handle, delta, rise = 0) {
  const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
  const current = { point: { x: handle.position.x + delta.x, y: handle.position.y + delta.y, z: handle.position.z + delta.z }, screenX: 100 + 40 * Math.hypot(delta.x, delta.z), screenY: 300 - rise * 40 };
  wallLineTool.onPointerDown(ctx, start, params);
  wallLineTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
  wallLineTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
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
    assert.deepEqual(focused(down(3, 4.8)), ["platform-floating"]);
    // The wall stands along z = 0 from x = 1 to 5, on the platform's near side: just off it, beside its foot handles.
    assert.ok(focused(down(3, -0.5)).some((type) => hasTrait(type, "partition")), JSON.stringify(focused(down(3, -0.5))));
    assert.deepEqual(focused(down(3, 9)), [], "far from everything, nothing");
    // Level with a wall's top, from the side: its top handles are within reach.
    const side = { point: { x: 3, y: 5.3, z: -5 }, ray: { origin: { x: 3, y: 5.3, z: -10 }, direction: { x: 0, y: 0, z: 1 } } };
    assert.ok(focused(side).some((type) => hasTrait(type, "partition")), JSON.stringify(focused(side)));
  } finally { f.session.free(); }
});
