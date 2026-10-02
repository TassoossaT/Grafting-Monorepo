import assert from "node:assert/strict";
import test from "node:test";

import { openingTool } from "../src/composition/tabletop/tools/openings/opening-tool.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";
import { openingHandles } from "../src/features/edit-construction/index.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";
import { click, dispatchGesture } from "./support/opening-harness.mjs";

/**
 * Drives the real `openingTool` through the dispatcher's own gesture model
 * against a real WASM session -- the regressions this covers are about the
 * gesture itself (what a press on an existing opening vs. a plain click on
 * empty wall does).
 */

const WINDOW = { openingKind: "window", width: 1, height: 1 };

/** A session with the tool's selection reset, recording what it writes into the params panel. */
function fixture() {
  const session = sessionFixture();
  const paramUpdates = [];
  session.ctx.updateToolParams = (toolId, update) => paramUpdates.push({ toolId, update });
  openingTool.onCancel(session.ctx);
  return { ...session, paramUpdates };
}

function wall(runtime) {
  return addFace(runtime, "wall", "wall-white", [
    { id: "w:a-bottom", position: { x: 0, y: 0, z: 0 } },
    { id: "w:b-bottom", position: { x: 8, y: 0, z: 0 } },
    { id: "w:b-top", position: { x: 8, y: 3, z: 0 } },
    { id: "w:a-top", position: { x: 0, y: 3, z: 0 } },
  ]);
}

const openingsOf = (runtime) => runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening");

function openingAt(ctx, x) {
  return openingsOf(ctx.runtime).find((t) => t.nodes.some((n) => Math.abs(n.position.x - x) < 0.6));
}

/** Press at `downPoint` (picking the opening standing near it, as the renderer would) and release at `upPoint`. */
function gesture(ctx, params, downPoint, upPoint = downPoint) {
  const opening = openingAt(ctx, downPoint.x);
  const start = { point: downPoint, surfaceRef: opening ? surfaceRefFromNodeSet(opening.surfaceKey) : undefined };
  dispatchGesture(openingTool, ctx, params, upPoint === downPoint ? [start] : [start, { point: upPoint }]);
}

/** The handle `part` of the opening standing near `x`, as the scene places it. */
function handleOf(ctx, part, x) {
  const opening = openingAt(ctx, x);
  assert.ok(opening, `an opening stands near x=${x}`);
  const handle = openingHandles(ctx.runtime.getAllRegionTopologies(), new Set([opening.surfaceKey.join("\u0000")]), (type) => type === opening.surfaceType).find((candidate) => candidate.part === part);
  assert.ok(handle, `the opening near x=${x} has a ${part} handle`);
  return handle;
}

/** Drags the handle `part` of the opening at `on` as far as the pointer goes from `on` to `to`: pressed on the handle, as the scene's pick reports it. */
function dragPart(ctx, params, part, on, to) {
  const handle = handleOf(ctx, part, on.x);
  const end = { x: handle.position.x + to.x - on.x, y: handle.position.y + to.y - on.y, z: handle.position.z + to.z - on.z };
  dispatchGesture(openingTool, ctx, params, [{ point: handle.position, nodeId: handle.id }, { point: end }]);
}

const extent = (opening, axis) => {
  const values = opening.nodes.map((n) => n.position[axis]);
  return { min: Math.min(...values), max: Math.max(...values), size: Math.max(...values) - Math.min(...values) };
};

test("pressing directly on an existing opening and releasing on the same spot only selects it -- no stacked second opening", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 4, y: 0, z: 0 } }, WINDOW);
    assert.equal(openingsOf(runtime).length, 1);

    gesture(ctx, WINDOW, { x: 4, y: 0, z: 0 });

    assert.equal(openingsOf(runtime).length, 1, "a plain click on the opening itself must select it, never stamp a second one on top");
  } finally { session.free(); }
});

test("creating a second opening squarely on top of an existing one is refused, not stacked", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 4, y: 0, z: 0 } }, WINDOW);
    assert.equal(openingsOf(runtime).length, 1);

    // No surfaceRef this time -- the same ambiguous "picked the wall, not
    // the opening standing in it" case a raycast can genuinely land on.
    click(ctx, { point: { x: 4, y: 0, z: 0 } }, WINDOW);

    assert.equal(openingsOf(runtime).length, 1, "the overlap guard on the create path must refuse a second opening stacked on the first");
  } finally { session.free(); }
});

test("with one opening selected, a plain click elsewhere on the wall creates an independent second opening instead of moving the first", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 1.5, y: 0, z: 0 } }, WINDOW);
    gesture(ctx, WINDOW, { x: 1.5, y: 0, z: 0 });
    assert.ok(openingAt(ctx, 1.5) !== undefined, "the first opening must still be exactly where it was");

    gesture(ctx, WINDOW, { x: 6, y: 0, z: 0 });

    assert.equal(openingsOf(runtime).length, 2, "both openings must now exist independently");
    assert.ok(openingAt(ctx, 1.5) !== undefined, "the first opening must not have been moved");
    assert.ok(openingAt(ctx, 6) !== undefined, "the second opening must have been created where clicked");
  } finally { session.free(); }
});

test("dragging an existing opening's middle handle to a new spot on the wall moves it, and frees its old spot", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 1.5, y: 0, z: 0 } }, WINDOW);
    dragPart(ctx, WINDOW, "center", { x: 1.5, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });

    assert.equal(openingsOf(runtime).length, 1, "a move replaces the opening, it does not add a second one");
    assert.equal(openingAt(ctx, 1.5), undefined, "the old spot must be free again");
    assert.ok(openingAt(ctx, 6) !== undefined, "the opening must now stand where it was dragged to");
  } finally { session.free(); }
});

test("a handle finds its opening by its own id: the drag needs no surfaceRef from the renderer's pick", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    // Its pane spans y in [0.5, 1.5].
    click(ctx, { point: { x: 1.5, y: 0.5, z: 0 } }, WINDOW);
    dragPart(ctx, WINDOW, "center", { x: 1.5, y: 1.0, z: 0 }, { x: 6, y: 1.0, z: 0 });

    assert.equal(openingsOf(runtime).length, 1, "still a move, not a stacked create -- proves the grab (not the create path) handled it");
    assert.ok(openingAt(ctx, 6) !== undefined, "the opening moved to where the drag released");
  } finally { session.free(); }
});

test("placing a window right beside an existing window of the same kind leaves two independent openings -- never merged", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5]
    click(ctx, { point: { x: 3.2, y: 1, z: 0 } }, WINDOW); // rim [2.7, 3.7]
    assert.equal(openingsOf(runtime).length, 2, "two separate openings, side by side");
  } finally { session.free(); }
});

test("dragging a window onto another one is refused, leaving both where they were", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 1, y: 1, z: 0 } }, WINDOW); // rim [0.5, 1.5]
    click(ctx, { point: { x: 6, y: 1, z: 0 } }, WINDOW); // rim [5.5, 6.5]
    dragPart(ctx, WINDOW, "center", { x: 6, y: 1.5, z: 0 }, { x: 1.4, y: 1.5, z: 0 });

    assert.equal(openingsOf(runtime).length, 2);
    assert.ok(openingAt(ctx, 6) !== undefined, "the dragged window stays where it was");
  } finally { session.free(); }
});

test("an opening is its own region pinned to the wall, and the wall gets no hole", () => {
  const { runtime, session, ctx } = fixture();
  try {
    const host = wall(runtime);
    click(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5] x [1, 2]
    const standing = runtime.getAllRegionTopologies();
    const opening = standing.find((t) => t.surfaceType === "opening");
    const wallNow = standing.find((t) => t.surfaceType === "wall-white");
    assert.equal(wallNow.holes.length, 0);
    const wallNodes = new Set(wallNow.nodes.map((n) => n.id));
    assert.ok(opening.nodes.every((n) => !wallNodes.has(n.id)), "no node is shared with the wall");
    for (const node of opening.nodes) {
      assert.deepEqual(node.pin.hostSurfaceKey, host.surfaceKey);
      assert.ok(node.pin.u >= 0 && node.pin.u <= 1 && node.pin.v >= 0 && node.pin.v <= 1);
    }
    const byCorner = (x, y) => opening.nodes.find((n) => Math.abs(n.position.x - x) < 1e-6 && Math.abs(n.position.y - y) < 1e-6);
    assert.ok(Math.abs(byCorner(1.5, 1).pin.u - 1.5 / 8) < 1e-9 && Math.abs(byCorner(1.5, 1).pin.v - 1 / 3) < 1e-9);
  } finally { session.free(); }
});

test("lowering the wall's top carries the opening, deformed by the local height", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5] x [1, 2]
    runtime.applyRegionEdit([{ kind: "move-vertex", nodeId: "w:a-top", position: { x: 0, y: 1.5, z: 0 } }]);
    const opening = openingsOf(runtime)[0];
    for (const node of opening.nodes) {
      const [resolved] = runtime.resolveOnHost({ hostSurfaceKey: node.pin.hostSurfaceKey, uv: [[node.pin.u, node.pin.v]] });
      assert.ok(Math.hypot(resolved.x - node.position.x, resolved.y - node.position.y, resolved.z - node.position.z) < 1e-6);
    }
    const topLeft = opening.nodes.find((n) => Math.abs(n.position.x - 1.5) < 1e-6 && n.pin.v > 0.5);
    const heightThere = 1.5 + (3 - 1.5) * (1.5 / 8);
    assert.ok(Math.abs(topLeft.position.y - (2 / 3) * heightThere) < 1e-6, `top-left follows the local height, got ${topLeft.position.y}`);
  } finally { session.free(); }
});

test("pressing on empty wall and dragging draws a new opening sized by the drag itself, not the tool's own slider width/height", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    gesture(ctx, WINDOW, { x: 1, y: 1, z: 0 }, { x: 4, y: 1.6, z: 0 });

    const openings = openingsOf(runtime);
    assert.equal(openings.length, 1, "the drag must place exactly one opening");
    const x = extent(openings[0], "x"), y = extent(openings[0], "y");
    assert.ok(Math.abs(x.min - 1) < 1e-6 && Math.abs(x.max - 4) < 1e-6, `expected the drawn opening across x in [1, 4], got [${x.min}, ${x.max}]`);
    assert.ok(Math.abs(y.min - 1) < 1e-6 && Math.abs(y.max - 1.6) < 1e-6, `expected the drawn opening across y in [1, 1.6], got [${y.min}, ${y.max}]`);
  } finally { session.free(); }
});

test("a plain click with no drag still places one opening at the tool's own slider size, centered on the point clicked", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    gesture(ctx, WINDOW, { x: 4, y: 1, z: 0 });

    const openings = openingsOf(runtime);
    assert.equal(openings.length, 1, "a plain click must still create one opening");
    assert.ok(Math.abs(extent(openings[0], "x").size - WINDOW.width) < 1e-6, "the click-placed opening must use the slider's own width");
  } finally { session.free(); }
});

test("a click whose pointer jitters a few pixels -- but far in world units -- still places a default opening", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    dispatchGesture(openingTool, ctx, WINDOW, [
      { point: { x: 4, y: 1, z: 0 }, screenX: 300, screenY: 200 },
      { point: { x: 4.1, y: 1.02, z: 0 }, screenX: 302, screenY: 201 },
    ]);

    const openings = openingsOf(runtime);
    assert.equal(openings.length, 1, "the dispatcher read it as a click, and so must the tool");
    const x = extent(openings[0], "x");
    assert.ok(Math.abs(x.size - WINDOW.width) < 1e-6 && Math.abs((x.min + x.max) / 2 - 4) < 1e-6, "slider-sized, centered where pressed");
  } finally { session.free(); }
});

test("dragging an existing opening to a new spot preserves its own size, even when the tool's own slider width/height currently disagrees", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5] x [1, 2]
    const MISMATCHED = { openingKind: "window", width: 3, height: 2.5 };
    dragPart(ctx, MISMATCHED, "center", { x: 2, y: 1.5, z: 0 }, { x: 6, y: 1.5, z: 0 });

    assert.equal(openingsOf(runtime).length, 1, "a move replaces the opening, it does not add a second one");
    const moved = openingAt(ctx, 6);
    assert.ok(moved !== undefined, "the opening must now stand where it was dragged to");
    assert.ok(Math.abs(extent(moved, "x").size - WINDOW.width) < 1e-6, `a move keeps its own width, got ${extent(moved, "x").size}`);
    assert.ok(Math.abs(extent(moved, "y").size - WINDOW.height) < 1e-6, `a move keeps its own height, got ${extent(moved, "y").size}`);
  } finally { session.free(); }
});

test("selecting an opening shows its own size in the panel, and dragging it afterwards still keeps that size", () => {
  const { runtime, session, ctx, paramUpdates } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5] x [1, 2]
    const SLIDERS = { openingKind: "window", width: 3, height: 2.5 };

    gesture(ctx, SLIDERS, { x: 2, y: 1.5, z: 0 });
    assert.equal(paramUpdates.length, 1, "selecting writes the opening's look into the panel");
    const shown = paramUpdates[0].update(SLIDERS);
    assert.ok(Math.abs(shown.width - 1) < 1e-9 && Math.abs(shown.height - 1) < 1e-9, `the panel shows its size, got ${shown.width} x ${shown.height}`);

    dragPart(ctx, SLIDERS, "center", { x: 2, y: 1.5, z: 0 }, { x: 6, y: 1.5, z: 0 });
    const moved = openingAt(ctx, 6);
    assert.ok(moved !== undefined, "the drag moved it");
    assert.ok(Math.abs(extent(moved, "x").size - 1) < 1e-6 && Math.abs(extent(moved, "y").size - 1) < 1e-6, "a drag never resizes to the sliders");
  } finally { session.free(); }
});

test("a plain click on the opening already selected applies the sliders' width and height about its center", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5] x [1, 2]
    gesture(ctx, WINDOW, { x: 2, y: 1.5, z: 0 });

    const RESIZED = { openingKind: "window", width: 2, height: 1.5 };
    gesture(ctx, RESIZED, { x: 2, y: 1.5, z: 0 });

    const openings = openingsOf(runtime);
    assert.equal(openings.length, 1, "the resize replaces the opening, it does not add a second one");
    const x = extent(openings[0], "x"), y = extent(openings[0], "y");
    assert.ok(Math.abs(x.min - 1) < 1e-6 && Math.abs(x.max - 3) < 1e-6, `the new width about its center, got [${x.min}, ${x.max}]`);
    assert.ok(Math.abs(y.min - 0.75) < 1e-6 && Math.abs(y.max - 2.25) < 1e-6, `the new height about its center, got [${y.min}, ${y.max}]`);
  } finally { session.free(); }
});

test("dragging a window's right side handle stretches just that edge, leaving the other three where they were", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5] x [1, 2]
    dragPart(ctx, WINDOW, "right", { x: 2.5, y: 1.5, z: 0 }, { x: 4, y: 1.5, z: 0 });

    const openings = openingsOf(runtime);
    assert.equal(openings.length, 1, "a resize replaces the opening, it does not add a second one");
    const x = extent(openings[0], "x"), y = extent(openings[0], "y");
    assert.ok(Math.abs(x.min - 1.5) < 1e-6, `the left edge must stay put at 1.5, got ${x.min}`);
    assert.ok(Math.abs(x.max - 4) < 1e-6, `the right edge must follow the drag to 4, got ${x.max}`);
    assert.ok(Math.abs(y.min - 1) < 1e-6 && Math.abs(y.max - 2) < 1e-6, "bottom and top must stay put");
  } finally { session.free(); }
});

test("dragging a window's left side handle stretches just that edge", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 4, y: 1, z: 0 } }, WINDOW); // rim [3.5, 4.5] x [1, 2]
    dragPart(ctx, WINDOW, "left", { x: 3.5, y: 1.5, z: 0 }, { x: 2, y: 1.5, z: 0 });

    const x = extent(openingsOf(runtime)[0], "x");
    assert.ok(Math.abs(x.min - 2) < 1e-6, `the left edge must follow the drag to 2, got ${x.min}`);
    assert.ok(Math.abs(x.max - 4.5) < 1e-6, `the right edge must stay put at 4.5, got ${x.max}`);
  } finally { session.free(); }
});

test("dragging a window's top handle stretches its height upward, the bottom staying put", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5] x [1, 2]
    dragPart(ctx, WINDOW, "top", { x: 2, y: 2, z: 0 }, { x: 2, y: 2.8, z: 0 });

    const y = extent(openingsOf(runtime)[0], "y");
    assert.ok(Math.abs(y.min - 1) < 1e-6, `the bottom must stay put at 1, got ${y.min}`);
    assert.ok(Math.abs(y.max - 2.8) < 1e-6, `the top must follow the drag to 2.8, got ${y.max}`);
  } finally { session.free(); }
});

test("dragging a window's bottom handle stretches downward, the top staying put", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5] x [1, 2]
    dragPart(ctx, WINDOW, "bottom", { x: 2, y: 1, z: 0 }, { x: 2, y: 0.3, z: 0 });

    const y = extent(openingsOf(runtime)[0], "y");
    assert.ok(Math.abs(y.min - 0.3) < 1e-6, `the bottom must follow the drag down to 0.3, got ${y.min}`);
    assert.ok(Math.abs(y.max - 2) < 1e-6, `the top must stay put at 2, got ${y.max}`);
  } finally { session.free(); }
});

test("dragging a window's top-right corner handle stretches both edges that meet there, the opposite corner staying put", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5] x [1, 2]
    dragPart(ctx, WINDOW, "top-right", { x: 2.5, y: 2, z: 0 }, { x: 4, y: 2.6, z: 0 });

    const openings = openingsOf(runtime);
    assert.equal(openings.length, 1, "a corner drag resizes, it never creates a second opening");
    const x = extent(openings[0], "x"), y = extent(openings[0], "y");
    assert.ok(Math.abs(x.min - 1.5) < 1e-6 && Math.abs(x.max - 4) < 1e-6, `left stays, right follows to 4: [${x.min}, ${x.max}]`);
    assert.ok(Math.abs(y.min - 1) < 1e-6 && Math.abs(y.max - 2.6) < 1e-6, `bottom stays, top follows to 2.6: [${y.min}, ${y.max}]`);
  } finally { session.free(); }
});

test("dragging a window's bottom-left corner handle moves that corner", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    click(ctx, { point: { x: 4, y: 1, z: 0 } }, WINDOW); // rim [3.5, 4.5] x [1, 2]
    dragPart(ctx, WINDOW, "bottom-left", { x: 3.5, y: 1, z: 0 }, { x: 3, y: 0.5, z: 0 });

    const x = extent(openingsOf(runtime)[0], "x"), y = extent(openingsOf(runtime)[0], "y");
    assert.ok(Math.abs(x.min - 3) < 1e-6 && Math.abs(x.max - 4.5) < 1e-6, `left follows to 3, right stays: [${x.min}, ${x.max}]`);
    assert.ok(Math.abs(y.min - 0.5) < 1e-6 && Math.abs(y.max - 2) < 1e-6, `bottom follows to 0.5, top stays: [${y.min}, ${y.max}]`);
  } finally { session.free(); }
});

test("a round window's side handle resizes that side alone, not a corner", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    const ROUND = { ...WINDOW, shape: { ellipse: true, radii: { top: 0, right: 0, bottom: 0, left: 0 } } };
    click(ctx, { point: { x: 4, y: 1, z: 0 } }, ROUND); // box [3.5, 4.5] x [1, 2]
    const [opening] = openingsOf(runtime);
    const side = opening.nodes.find((n) => Math.abs(n.position.x - 4.5) < 1e-6 && Math.abs(n.position.y - 1.5) < 1e-6);
    assert.ok(side, "a circle has a node at the middle of its right side");

    dragPart(ctx, ROUND, "right", side.position, { x: 5, y: 1.5, z: 0 });

    const [resized] = openingsOf(runtime);
    const x = extent(resized, "x"), y = extent(resized, "y");
    assert.ok(Math.abs(x.min - 3.5) < 1e-6 && Math.abs(x.max - 5) < 1e-6, `only the right edge follows: [${x.min}, ${x.max}]`);
    assert.ok(Math.abs(y.min - 1) < 1e-6 && Math.abs(y.max - 2) < 1e-6, `the height stays: [${y.min}, ${y.max}]`);
  } finally { session.free(); }
});

test("dragging a door's side handle up and out only widens it -- a door never lifts off the floor", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    const DOOR = { openingKind: "door", width: 1, height: 2 };
    click(ctx, { point: { x: 2, y: 0, z: 0 } }, DOOR); // rim [1.5, 2.5] x [0, 2]
    dragPart(ctx, DOOR, "right", { x: 2.5, y: 0, z: 0 }, { x: 3.5, y: 0.8, z: 0 });

    const x = extent(openingsOf(runtime)[0], "x"), y = extent(openingsOf(runtime)[0], "y");
    assert.ok(Math.abs(x.max - 3.5) < 1e-6, `the right edge must follow to 3.5, got ${x.max}`);
    assert.ok(Math.abs(y.min) < 1e-6 && Math.abs(y.max - 2) < 1e-6, "a door keeps its floor and its top");
  } finally { session.free(); }
});

test("a door can never be dragged off the floor, even grabbed right where its own bottom edge is", () => {
  const { runtime, session, ctx } = fixture();
  try {
    wall(runtime);
    const DOOR = { openingKind: "door", width: 1, height: 2 };
    click(ctx, { point: { x: 2, y: 0, z: 0 } }, DOOR); // rim [1.5, 2.5] x [0, 2]
    gesture(ctx, DOOR, { x: 2, y: 0, z: 0 }, { x: 2, y: 1, z: 0 });

    const y = extent(openingsOf(runtime)[0], "y");
    assert.ok(Math.abs(y.min) < 1e-6, "a door's floor must never move");
    assert.ok(Math.abs(y.max - 2) < 1e-6, "a door's height must stay put when its (non-existent) bottom handle is dragged");
  } finally { session.free(); }
});

test("an opening's sizes are drawn as rulers on the wall, and one being dragged also draws how far it slid from where it was", () => {
  const { runtime, session, ctx } = fixture();
  const shown = [];
  try {
    wall(runtime);
    click(ctx, { point: { x: 1.5, y: 0, z: 0 } }, WINDOW);
    ctx.showRuler = (feedback) => shown.push(feedback);
    const middle = handleOf(ctx, "center", 1.5);
    const start = { point: middle.position, nodeId: middle.id };
    const current = { point: { ...middle.position, x: 4 } };
    openingTool.onPointerDown(ctx, start, WINDOW);
    openingTool.previewFor({ start, current, samples: [start, current] }, WINDOW, ctx);
    const measures = shown.filter(Boolean).at(-1).measures;
    const width = measures.find((m) => m.kind === "size" && m.name === "largura");
    assert.ok(width?.from && width?.to && Math.abs(width.to.x - width.from.x - 1) < 1e-6, JSON.stringify(measures));
    const height = measures.find((m) => m.kind === "size" && m.name === "altura");
    assert.ok(height?.from && height?.to && Math.abs(height.to.y - height.from.y - 1) < 1e-6, "the height is an upright ruler");
    const slid = measures.find((m) => m.kind === "change" && m.name === "deslocou");
    assert.ok(slid && slid.meters > 2 && slid.from && slid.to, JSON.stringify(measures));
    openingTool.onCancel(ctx);
  } finally { session.free(); }
});

test("an opening shows its handles when the pointer is on it -- a middle one, one on each corner and side -- and a corner handle resizes it in width and height together", () => {
  const { runtime, session, ctx } = fixture();
  try {
    assert.equal(openingTool.handlesOnHover, true, "the opening under the pointer shows its handles, as every structure's do");
    assert.ok(openingTool.editsType?.("opening"), "and they are the opening's own");
    wall(runtime);
    click(ctx, { point: { x: 4, y: 1.2, z: 0 } }, { ...WINDOW, width: 1, height: 1 });
    const window = openingsOf(runtime).find((t) => t.nodes.some((n) => Math.abs(n.position.x - 4) < 0.6));
    const keys = new Set([window.surfaceKey.join("\u0000")]);
    const handles = openingHandles(runtime.getAllRegionTopologies(), keys, (type) => type === window.surfaceType);
    assert.equal(handles.filter((h) => h.kind === "pivot").length, 1, "one in the middle moves it");
    assert.equal(handles.filter((h) => h.kind === "corner").length, 4, "a window has all four corners");
    assert.equal(handles.filter((h) => h.kind === "side").length, 4);
    const box = (axis) => extent(openingsOf(runtime).find((t) => t.nodes.some((n) => Math.abs(n.position.x - 4) < 0.7)), axis);
    const [w0, h0] = [box("x").size, box("y").size];
    const corner = handles.find((h) => h.part === "top-right");
    // A press on the corner handle, dragged out along the wall and up.
    const start = { point: corner.position, nodeId: corner.id };
    dispatchGesture(openingTool, ctx, WINDOW, [start, { point: { x: corner.position.x + 0.5, y: corner.position.y + 0.4, z: 0 } }]);
    assert.ok(box("x").size > w0 + 0.3 && box("y").size > h0 + 0.2, `${box("x").size} x ${box("y").size} from ${w0} x ${h0}`);
    // A door stands on the floor: no handle on its bottom.
    click(ctx, { point: { x: 1, y: 0, z: 0 } }, { openingKind: "door", width: 0.9, height: 2 });
    const doorPiece = openingsOf(runtime).find((t) => t.nodes.some((n) => Math.abs(n.position.x - 1) < 0.6));
    const doorHandles = openingHandles(runtime.getAllRegionTopologies(), new Set([doorPiece.surfaceKey.join(" ")]), (type) => type === doorPiece.surfaceType);
    assert.ok(doorHandles.length > 0 && doorHandles.every((h) => !h.part.includes("bottom")), doorHandles.map((h) => h.part).join());
  } finally { session.free(); }
});
