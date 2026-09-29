import assert from "node:assert/strict";
import test from "node:test";
import { roofTool } from "../src/composition/tabletop/tools/roof/roof-tool.ts";
import { DEFAULT_TOOL_PARAMS, shownGlobalHandles } from "../src/features/edit-construction/index.ts";
import { sessionFixture, addFace } from "./platform-session-fixture.mjs";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";

function fixture() {
  const value = sessionFixture();
  value.runtime.generateRoof = (request) => JSON.parse(value.session.profile_roof_json(JSON.stringify(request)));
  Object.assign(value.runtime, { showPreview() {}, clearPreview() {} });
  let operations = 0;
  const apply = value.runtime.applyPatchReplacement;
  value.runtime.applyPatchReplacement = (request) => { operations++; return apply(request); };
  return { ...value, operations: () => operations };
}

const scene = (runtime) => ({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: runtime.cloudFor });
const roofs = (runtime) => runtime.getAllRegionTopologies().filter((f) => f.surfaceType === "roof");
const top = (runtime) => Math.max(...roofs(runtime).flatMap((f) => f.nodes.map((n) => n.position.y)));
const groups = (runtime) => new Set(roofs(runtime).map((f) => f.props.roof.group));
/** Where node `id` is pinned: pins ride on the faces' nodes. */
const pinOf = (runtime, id) => runtime.getAllRegionTopologies().flatMap((f) => f.nodes).find((n) => n.id === id)?.pin;
// A vertical face stands on one line in plan.
const vertical = ({ nodes: [a, b, ...rest] }) => rest.every((c) => Math.abs((b.position.x - a.position.x) * (c.position.z - a.position.z) - (b.position.z - a.position.z) * (c.position.x - a.position.x)) < 1e-6);

/** A rectangle dragged from `a` to `b` with the roof tool. */
function drag({ ctx }, a, b, params) {
  const start = { point: { x: a[0], y: 0, z: a[1] } }, current = { point: { x: b[0], y: 0, z: b[1] } };
  roofTool.onPointerDown(ctx, start, params);
  roofTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
}

/** A click: a press and a release on the same spot. */
function click({ ctx }, sample, params) {
  roofTool.onPointerDown(ctx, sample, params);
  roofTool.onPointerUp(ctx, { start: sample, current: sample, samples: [sample] }, params);
  roofTool.onClick(ctx, sample, params);
}

/** A roof dragged over 8 x 4 at elevation 3, rising 2. */
function roofed(waters = 4) {
  const value = fixture();
  drag(value, [0, 0], [8, 4], { ...DEFAULT_TOOL_PARAMS.roof, waters, elevation: 3, height: 2 });
  return value;
}

/** Drags `handle` to `point`; `screenY` below 300 is up, 40 px a metre. */
function dragHandle({ ctx }, handle, point, screenY = 300) {
  const params = { ...DEFAULT_TOOL_PARAMS.roof };
  const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
  const current = { point, screenX: 200, screenY };
  roofTool.onPointerDown(ctx, start, params);
  roofTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
  roofTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
}

test("a dragged rectangle makes one four-water roof, keeping its recipe on every face", () => {
  const { runtime, session, operations } = roofed();
  try {
    assert.equal(operations(), 1);
    const faces = roofs(runtime);
    assert.equal(faces.length, 4);
    assert.equal(groups(runtime).size, 1);
    assert.ok(faces.every((f) => f.props.roof.slopes.every((slope) => slope === 1)));
    assert.equal(Math.min(...faces.flatMap((f) => f.nodes.map((n) => n.position.y))), 3);
    assert.ok(Math.abs(top(runtime) - 5) < 1e-6);
    assert.ok(faces.every((f) => f.props.roof.overhangs === undefined), "no eaves reach out: the covering decides that");
  } finally { session.free(); }
});

test("two and one waters close their unpitched sides with upright gables", () => {
  for (const [waters, leaves, gables] of [[2, 2, 2], [1, 1, 3]]) {
    const { runtime, session } = roofed(waters);
    try {
      const faces = roofs(runtime);
      assert.equal(faces.length, leaves + gables, `${waters} waters`);
      assert.equal(faces.filter(vertical).length, gables, `${waters} waters`);
    } finally { session.free(); }
  }
});

test("any outline clicked corner by corner is roofed, concave and slanted", () => {
  const value = fixture();
  const { runtime, session, calls } = value;
  try {
    const params = { ...DEFAULT_TOOL_PARAMS.roof, shape: "polygon", elevation: 3, height: 2 };
    for (const [x, z] of [[0, 0], [7, 1], [9, 5], [5, 4], [2, 7], [0, 0]]) click(value, { point: { x, y: 0, z } }, params);
    assert.equal(roofs(runtime).length, 5, JSON.stringify(calls.feedback.at(-1)));
    assert.equal(roofs(runtime)[0].props.roof.footprints[0].outer.length, 5);
  } finally { session.free(); }
});

test("a rectangle drawn into a standing roof fuses with it: one roof over their union, its sides keeping their slopes", () => {
  const value = roofed(2);
  const { runtime, session } = value;
  try {
    drag(value, [3, -4], [5, 2], { ...DEFAULT_TOOL_PARAMS.roof, waters: 2, elevation: 0, height: 9 });
    assert.equal(groups(runtime).size, 1);
    const recipe = roofs(runtime)[0].props.roof;
    assert.equal(recipe.elevation, 3, "the fused roof stands where the standing one did");
    assert.equal(recipe.footprints[0].outer.length, 8, "a T");
    assert.equal(recipe.slopes.filter((s) => s === 0).length >= 2, true, "the gables it had are gables still");
  } finally { session.free(); }
});

test("a rectangle cut out of a roof leaves the rest of it roofed, its hole or notch closed", () => {
  const value = roofed();
  const { runtime, session } = value;
  try {
    drag(value, [3, 1], [5, 3], { ...DEFAULT_TOOL_PARAMS.roof, action: "cut" });
    const recipe = roofs(runtime)[0].props.roof;
    assert.equal(recipe.footprints[0].holes.length, 1, "a courtyard");
    assert.equal(recipe.slopes.length, 8);
    drag(value, [6, -1], [9, 5], { ...DEFAULT_TOOL_PARAMS.roof, action: "cut" });
    assert.equal(roofs(runtime)[0].props.roof.footprints[0].outer.length, 4);
    assert.ok(roofs(runtime).every((f) => f.nodes.every((n) => n.position.x <= 6 + 1e-6)));
  } finally { session.free(); }
});

test("a drawn hole removes roof surface without changing the roof footprint or ridge", () => {
  const value = roofed(2);
  const { runtime, session, ctx } = value;
  try {
    const before = JSON.stringify(roofs(runtime)[0].props.roof.footprints);
    const ridge = top(runtime);
    drag(value, [2, 0.8], [4, 1.2], { ...DEFAULT_TOOL_PARAMS.roof, action: "hole" });
    assert.equal(JSON.stringify(roofs(runtime)[0].props.roof.footprints), before);
    assert.equal(roofs(runtime)[0].props.roof.cutouts.length, 1);
    assert.ok(roofs(runtime).some((face) => face.holes.length > 0), JSON.stringify(roofs(runtime)[0].props.roof.cutouts));
    assert.ok(Math.abs(top(runtime) - ridge) < 1e-6);
    const move = shownGlobalHandles(scene(runtime)).find((h) => h.recipeHandle?.anchor === "cutout:0:move");
    assert.ok(move, "the hole has an editing handle");
    dragHandle(value, move, { x: move.position.x + 1, y: move.position.y, z: move.position.z });
    assert.ok(roofs(runtime)[0].props.roof.cutouts[0].outer.every(([x]) => x >= 3 - 1e-6));
    session.undo_region_overlay(ctx.history.undo().transactionId);
    assert.ok(roofs(runtime).some((face) => face.holes.length > 0), "undo restores the prior opening");
    session.undo_region_overlay(ctx.history.undo().transactionId);
    assert.ok(roofs(runtime).every((face) => face.holes.length === 0), "undo removes the authored opening");
  } finally { session.free(); }
});

test("a roof on a platform takes its outline, holes and elevation, and undoes", () => {
  const value = fixture();
  const { ctx, runtime, session, operations } = value;
  try {
    const platform = addFace(runtime, "support", "platform", [[0, 0], [8, 0], [8, 4], [0, 4]].map(([x, z], index) => ({ id: `p${index}`, position: { x, y: 7, z } })));
    click(value, { point: { x: 3, y: 7, z: 2 }, surfaceRef: surfaceRefFromNodeSet(platform.surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, action: "base", height: 3 });
    assert.equal(operations(), 1);
    assert.equal(roofs(runtime).length, 4);
    assert.equal(Math.min(...roofs(runtime).flatMap((f) => f.nodes.map((n) => n.position.y))), 7);
    assert.ok(Math.abs(top(runtime) - 10) < 1e-6);
    session.undo_region_overlay(ctx.history.undo().transactionId);
    assert.equal(runtime.getAllRegionTopologies().length, 1);
  } finally { session.free(); }
});

/** An L room of wall panels three high, sharing their columns. */
function lRoom(runtime) {
  const plan = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
  const foot = plan.map(([x, z], i) => ({ id: `f${i}`, position: { x, y: 0, z } }));
  const head = plan.map(([x, z], i) => ({ id: `t${i}`, position: { x, y: 3, z } }));
  return plan.map((_, i) => {
    const j = (i + 1) % plan.length;
    return addFace(runtime, `wall-${i}`, "wall-white", [foot[i], foot[j], head[j], head[i]]);
  });
}

test("a roof over a wall loop takes the room's own outline at the wall tops", () => {
  const value = fixture();
  const { runtime, session } = value;
  try {
    const walls = lRoom(runtime);
    click(value, { point: { x: 5, y: 3, z: 0 }, surfaceRef: surfaceRefFromNodeSet(walls[0].surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, action: "base", height: 2 });
    assert.equal(roofs(runtime)[0].props.roof.footprints[0].outer.length, 6);
    assert.equal(Math.min(...roofs(runtime).flatMap((f) => f.nodes.map((n) => n.position.y))), 3);
    assert.ok(Math.abs(top(runtime) - 5) < 1e-6);
  } finally { session.free(); }
});

test("a wall run that closes no room carries no roof", () => {
  const value = fixture();
  const { runtime, session, operations, calls } = value;
  try {
    const foot = [0, 1, 2].map((i) => ({ id: `f${i}`, position: { x: i * 4, y: 0, z: 0 } }));
    const head = [0, 1, 2].map((i) => ({ id: `t${i}`, position: { x: i * 4, y: 3, z: 0 } }));
    const wall = addFace(runtime, "wall-0", "wall-white", [foot[0], foot[1], head[1], head[0]]);
    addFace(runtime, "wall-1", "wall-white", [foot[1], foot[2], head[2], head[1]]);
    click(value, { point: { x: 1, y: 3, z: 0 }, surfaceRef: surfaceRefFromNodeSet(wall.surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, action: "base" });
    assert.equal(operations(), 0);
    assert.equal(calls.feedback.at(-1).tone, "error");
  } finally { session.free(); }
});

// ---- Handles: every edit regenerates the roof from its recipe ----

test("a roof shows its rise, a slope per side, its seams, and a corner and an insert per footprint corner", () => {
  const { runtime, session } = roofed();
  try {
    const kinds = shownGlobalHandles(scene(runtime)).filter((h) => h.owner === "roof").map((h) => h.kind);
    const count = (kind) => kinds.filter((k) => k === kind).length;
    assert.deepEqual([count("pivot"), count("rotate"), count("rise")], [1, 1, 1]);
    assert.equal(count("slope"), 4);
    assert.equal(count("seam"), 5, "four hips and the ridge");
    assert.deepEqual([count("corner"), count("insert"), count("side")], [4, 4, 0]);
  } finally { session.free(); }
});

test("the rise handle raises the whole roof, keeps its recipe, and undoes", () => {
  const value = roofed();
  const { runtime, session, ctx } = value;
  try {
    const rise = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "rise");
    dragHandle(value, rise, rise.position, 220);
    assert.ok(Math.abs(top(runtime) - 7) < 1e-6, `${top(runtime)}`);
    assert.equal(roofs(runtime)[0].props.roof.height, 4);
    assert.ok(roofs(runtime).every((f) => f.props.roofFace !== undefined));
    session.undo_region_overlay(ctx.history.undo().transactionId);
    assert.ok(Math.abs(top(runtime) - 5) < 1e-6);
  } finally { session.free(); }
});

test("bringing the rise down to nothing removes the roof", () => {
  const value = roofed();
  const { runtime, session } = value;
  try {
    const rise = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "rise");
    dragHandle(value, rise, rise.position, 400);
    assert.equal(roofs(runtime).length, 0);
  } finally { session.free(); }
});

test("raising a gable's slope turns two waters into a hip end", () => {
  const value = roofed(2);
  const { runtime, session } = value;
  try {
    const gableSide = roofs(runtime).find((f) => f.props.roofFace.upright).props.roofFace.side;
    const gable = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "slope" && h.recipeHandle.part.of.side === gableSide && h.recipeHandle.part.of.dormer === undefined);
    dragHandle(value, gable, gable.position, 260);
    assert.equal(roofs(runtime)[0].props.roof.slopes.filter((s) => s === 0).length, 1);
  } finally { session.free(); }
});

test("pulling a corner out of a side adds a leaf, and moving a corner reshapes the roof", () => {
  const value = roofed();
  const { runtime, session } = value;
  try {
    const insert = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "insert" && h.recipeHandle.part.side === 0);
    dragHandle(value, insert, { x: insert.position.x, y: insert.position.y, z: insert.position.z - 1 });
    assert.equal(roofs(runtime)[0].props.roof.footprints[0].outer.length, 5);
    assert.equal(new Set(roofs(runtime).map((f) => f.props.roofFace.side)).size, 5);
    const corner = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "corner" && h.recipeHandle.part.corner === 0);
    dragHandle(value, corner, { x: corner.position.x - 1, y: corner.position.y, z: corner.position.z });
    const [x] = roofs(runtime)[0].props.roof.footprints[0].outer[0];
    assert.ok(Math.abs(x + 1) < 1e-6);
  } finally { session.free(); }
});

// ---- Dormers ----

/** A two-water roof over 8 x 4, rising 4, with a dormer clicked onto its front leaf. */
function dormered() {
  const value = roofed(2);
  const { runtime } = value;
  const rise = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "rise");
  dragHandle(value, rise, rise.position, 220);
  const leaf = roofs(runtime).find((f) => !f.props.roofFace.upright && f.nodes.some((n) => n.position.z < 1e-6));
  click(value, { point: { x: 4, y: 3.6, z: 0.6 }, surfaceRef: surfaceRefFromNodeSet(leaf.surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, action: "dormer", waters: 2 });
  return value;
}

test("a dormer clicked onto a leaf opens it and stands on a front and two cheeks", () => {
  const value = dormered();
  const { runtime, session, calls } = value;
  try {
    const recipe = roofs(runtime)[0].props.roof;
    assert.equal(recipe.dormers.length, 1, JSON.stringify(calls.feedback.at(-1)));
    const own = roofs(runtime).filter((f) => f.props.roofFace.dormer === 0);
    assert.equal(own.filter((f) => !f.props.roofFace.upright).length, 2, "its two leaves");
    assert.ok(own.some((f) => f.props.roofFace.upright && f.props.roofFace.side === 0), "a front");
    const kinds = shownGlobalHandles(scene(runtime)).filter((h) => h.recipeHandle?.anchor?.startsWith("dormer:")).map((h) => h.kind).sort();
    assert.deepEqual(kinds, ["pivot", "rise", "side", "side"]);
  } finally { session.free(); }
});

test("a dormer is widened from a cheek, and brought below its leaf is removed", () => {
  const value = dormered();
  const { runtime, session } = value;
  try {
    const right = shownGlobalHandles(scene(runtime)).find((h) => h.recipeHandle?.anchor === "dormer:0:right");
    const along = right.recipeHandle.part.along;
    dragHandle(value, right, { x: right.position.x + along[0] * 0.5, y: right.position.y, z: right.position.z + along[1] * 0.5 });
    assert.ok(Math.abs(roofs(runtime)[0].props.roof.dormers[0].width - 2) < 1e-6);
    const front = shownGlobalHandles(scene(runtime)).find((h) => h.recipeHandle?.anchor === "dormer:0:front");
    dragHandle(value, front, front.position, 400);
    assert.equal(roofs(runtime)[0].props.roof.dormers.length, 0);
    assert.ok(roofs(runtime).every((f) => f.props.roofFace.dormer === undefined));
  } finally { session.free(); }
});

test("what is pinned to a dormer's front stays pinned to it where it was when the roof is made again", () => {
  const value = dormered();
  const { runtime, session } = value;
  try {
    const front = roofs(runtime).find((f) => f.props.roofFace.dormer === 0 && f.props.roofFace.upright && f.props.roofFace.side === 0);
    addFace(runtime, "window", "opening", [0, 1, 2, 3].map((i) => ({ id: `w${i}`, position: { x: 0, y: 0, z: 0 } })));
    runtime.pinNodes([0, 1, 2, 3].map((i) => ({ nodeId: `w${i}`, hostSurfaceKey: front.surfaceKey, u: [0.4, 0.6, 0.6, 0.4][i], v: [0.3, 0.3, 0.7, 0.7][i] })), "local", "test-pin");
    assert.deepEqual(pinOf(runtime, "w2")?.hostSurfaceKey, front.surfaceKey);
    const rise = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "rise" && h.recipeHandle.anchor === "rise");
    dragHandle(value, rise, rise.position, 260);
    const now = roofs(runtime).find((f) => f.props.roofFace.dormer === 0 && f.props.roofFace.upright && f.props.roofFace.side === 0);
    assert.notEqual(now.surfaceKey.join(), front.surfaceKey.join(), "the roof was made again");
    const pin = pinOf(runtime, "w2");
    assert.deepEqual(pin?.hostSurfaceKey, now.surfaceKey);
    assert.ok(Math.abs(pin.u - 0.6) < 1e-9 && Math.abs(pin.v - 0.7) < 1e-9);
  } finally { session.free(); }
});

// ---- Fusing along a side or at a corner ----

test("a roof drawn along a roof's side fuses with it, with no seam across the side they now run on", () => {
  const value = roofed();
  const { runtime, session } = value;
  try {
    drag(value, [8, 0], [12, 4], { ...DEFAULT_TOOL_PARAMS.roof, elevation: 3, height: 2 });
    assert.equal(groups(runtime).size, 1);
    const [footprint] = roofs(runtime)[0].props.roof.footprints;
    assert.equal(footprint.outer.length, 4, "one 12 x 4 outline: the corners where the sides ran straight on are gone");
    assert.equal(roofs(runtime).length, 4);
  } finally { session.free(); }
});

test("a roof drawn a hand's breadth off a roof's side lands on it and fuses", () => {
  const value = roofed();
  const { runtime, session } = value;
  try {
    drag(value, [8.15, 1], [12, 3], { ...DEFAULT_TOOL_PARAMS.roof, elevation: 3, height: 2 });
    assert.equal(groups(runtime).size, 1);
    const xs = roofs(runtime)[0].props.roof.footprints[0].outer.map(([x]) => x);
    assert.ok(xs.includes(8) && xs.includes(12), JSON.stringify(xs));
  } finally { session.free(); }
});

test("a roof touching another only at a corner joins it there: one roof, two outlines, one shared corner", () => {
  const value = roofed();
  const { runtime, session } = value;
  try {
    drag(value, [8.1, 4.1], [12, 8], { ...DEFAULT_TOOL_PARAMS.roof, elevation: 3, height: 2 });
    assert.equal(groups(runtime).size, 1);
    const recipe = roofs(runtime)[0].props.roof;
    assert.equal(recipe.footprints.length, 2);
    const at = roofs(runtime).flatMap((f) => f.nodes).filter((n) => Math.abs(n.position.x - 8) < 1e-6 && Math.abs(n.position.z - 4) < 1e-6);
    assert.equal(new Set(at.map((n) => n.id)).size, 1, "the corner is one node of both");
  } finally { session.free(); }
});

// ---- Standing on a base: the roof follows it ----

import { commitPlatformContour, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { commitRegionEdit, commitSurfaceRemoval } from "../src/composition/tabletop/effects/effect-commit.ts";

test("a platform cuts the roof with its own edges and restores it when removed", () => {
  const value = roofed(2);
  const { ctx, runtime, session } = value;
  try {
    const params = { ...DEFAULT_TOOL_PARAMS["platform-contour"], elevation: 4 };
    commitPlatformContour(ctx, [[2, 0.5], [4, 0.5], [4, 1.5], [2, 1.5]].map(([x, z]) => ({ point: { x, y: 4, z } })), params);
    const floor = runtime.getAllRegionTopologies().find((face) => face.surfaceType === "platform");
    assert.ok(floor, "the platform was created");
    assert.ok(roofs(runtime).some((face) => face.holes.length > 0), "its contour cuts the roof");
    const roofNodes = roofs(runtime).flatMap((face) => face.nodes);
    assert.ok(roofNodes.some((node) => Math.abs(node.position.x - 2) < 1e-5
      && Math.abs(node.position.z - 1) < 1e-5 && Math.abs(node.position.y - 4) < 1e-5), "the slope below the platform survives up to its level");
    const rim = floor.nodes.find((node) => Math.abs(node.position.x - 2) < 1e-5 && Math.abs(node.position.z - 1.5) < 1e-5);
    assert.ok(roofs(runtime).some((face) => face.props.roofFace.upright && face.nodes.some((node) => node.id === rim.id)), "the vertical cut is welded to the platform rim");
    assert.equal(roofs(runtime)[0].props.roof.cutouts.length, 0, "the cut is derived from the live platform");
    commitRegionEdit(runtime, floor.nodes.map((node) => ({ kind: "move-vertex", nodeId: node.id, position: { ...node.position, x: node.position.x + 2 } })), { transactionId: "move-roof-platform" });
    const holeXs = roofs(runtime).flatMap((face) => face.holes.flatMap((loop) => loop.map((use) => face.nodes.find((node) => node.id === use.startNodeId)?.position.x))).filter((x) => x !== undefined);
    assert.ok(holeXs.length > 0 && Math.min(...holeXs) >= 4 - 1e-5, "the cut follows the moved platform");
    const moved = runtime.getAllRegionTopologies().find((face) => face.surfaceType === "platform");
    commitSurfaceRemoval(runtime, moved.surfaceKey, { transactionId: "remove-roof-platform" });
    assert.ok(roofs(runtime).every((face) => face.holes.length === 0), "removing the platform restores the roof");
  } finally { session.free(); }
});

test("drawing a platform from a roof hit uses that level and cuts the roof", () => {
  const value = roofed(2);
  const { ctx, runtime, session } = value;
  try {
    const leaf = roofs(runtime).find((face) => !face.props.roofFace.upright && face.nodes.some((node) => node.position.z < 1e-6));
    const start = { point: { x: 2, y: 4, z: 1 }, surfaceRef: surfaceRefFromNodeSet(leaf.surfaceKey) };
    const current = { point: { x: 4, y: 4, z: 1.5 } };
    const params = { ...DEFAULT_TOOL_PARAMS["platform-contour"] };
    platformContourTool.onPointerDown(ctx, start, params);
    platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
    const floor = runtime.getAllRegionTopologies().find((face) => face.surfaceType === "platform");
    assert.ok(floor, "the roof hit creates a floor");
    assert.ok(floor.nodes.every((node) => Math.abs(node.position.y - 4) < 1e-6));
    assert.ok(roofs(runtime).some((face) => face.holes.length > 0), "the floor's outline opens the roof");
  } finally { session.free(); }
});

/** Drags `handle` with `tool` to `point`; `screenY` below 300 is up, 40 px a metre. */
function dragWith(tool, { ctx, runtime }, handle, point, params, screenY = 300) {
  Object.assign(runtime, { previewNodeHandle() {} });
  const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
  const current = { point, screenX: 200, screenY };
  tool.onPointerDown(ctx, start, params);
  tool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
  tool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
}

/** A roof on an 8 x 4 floor at 3. */
function onFloor() {
  const value = fixture();
  const floor = addFace(value.runtime, "floor", "platform", [[0, 0], [8, 0], [8, 4], [0, 4]].map(([x, z], i) => ({ id: `p${i}`, position: { x, y: 3, z } })));
  click(value, { point: { x: 3, y: 3, z: 2 }, surfaceRef: surfaceRefFromNodeSet(floor.surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, action: "base", height: 2 });
  return value;
}

test("a roof on a floor goes where the floor is moved, and rises with it", () => {
  const value = onFloor();
  const { runtime, session, calls } = value;
  try {
    const params = { ...DEFAULT_TOOL_PARAMS["platform-contour"], support: "floating" };
    const pivot = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "pivot" && h.owner === "platform");
    dragWith(platformContourTool, value, pivot, { x: pivot.position.x + 5, y: pivot.position.y, z: pivot.position.z });
    const xs = roofs(runtime)[0].props.roof.footprints[0].outer.map(([x]) => x);
    assert.deepEqual([Math.min(...xs), Math.max(...xs)], [5, 13], JSON.stringify(calls.feedback.at(-1)));
    const height = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "height" && h.owner === "platform");
    dragWith(platformContourTool, value, height, height.position, params, 260);
    assert.ok(Math.abs(Math.min(...roofs(runtime).flatMap((f) => f.nodes.map((n) => n.position.y))) - 4) < 1e-6, "its eaves on the raised floor");
  } finally { session.free(); }
});

test("a roof over a room is reshaped when a wall of it is pushed out", () => {
  const value = fixture();
  const { runtime, session } = value;
  try {
    const walls = lRoom(runtime);
    click(value, { point: { x: 5, y: 3, z: 0 }, surfaceRef: surfaceRefFromNodeSet(walls[0].surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, action: "base", height: 2 });
    // The first wall pushed 2 out, feet and tops, as its side handle pushes it.
    const at = (id) => runtime.getGraphSnapshot().nodes.find((n) => n.id === id).position;
    commitRegionEdit(runtime, ["f0", "f1", "t0", "t1"].map((nodeId) => ({ kind: "move-vertex", nodeId, position: { ...at(nodeId), z: at(nodeId).z - 2 } })), { transactionId: "push-wall" });
    const zs = roofs(runtime)[0].props.roof.footprints[0].outer.map(([, z]) => z);
    assert.ok(Math.abs(Math.min(...zs) + 2) < 1e-6, JSON.stringify(zs));
  } finally { session.free(); }
});

test("a roof moved by its own hand lets go of its floor", () => {
  const value = onFloor();
  const { runtime, session } = value;
  try {
    const pivot = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "pivot" && h.owner === "roof");
    dragHandle(value, pivot, { x: pivot.position.x, y: pivot.position.y, z: pivot.position.z + 10 });
    assert.equal(roofs(runtime)[0].props.roof.base, undefined);
    const before = JSON.stringify(roofs(runtime)[0].props.roof.footprints);
    const floorPivot = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "pivot" && h.owner === "platform");
    dragWith(platformContourTool, value, floorPivot, { x: floorPivot.position.x + 3, y: floorPivot.position.y, z: floorPivot.position.z });
    assert.equal(JSON.stringify(roofs(runtime)[0].props.roof.footprints), before);
  } finally { session.free(); }
});

test("a roof on a floor is welded to it: its eaves are the floor's own corners and sides", () => {
  const value = onFloor();
  const { runtime, session } = value;
  try {
    const nodes = new Set(roofs(runtime).flatMap((f) => f.nodes.map((n) => n.id)));
    assert.ok(["p0", "p1", "p2", "p3"].every((id) => nodes.has(id)), [...nodes].join());
    const floor = runtime.getAllRegionTopologies().find((f) => f.surfaceType === "platform");
    const floorSides = new Set(floor.outerLoops[0].map((use) => use.edgeId));
    const roofSides = new Set(roofs(runtime).flatMap((f) => f.outerLoops.flat().map((use) => use.edgeId)));
    assert.ok([...floorSides].every((id) => roofSides.has(id)), "every side of the floor is an eave of the roof");
  } finally { session.free(); }
});

test("pushing a side of the floor out widens the floor, and the roof with it", () => {
  const value = onFloor();
  const { runtime, session, calls } = value;
  try {
    const side = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "side" && h.owner === "platform" && h.position.x > 8);
    dragWith(platformContourTool, value, side, { x: side.position.x + 2, y: side.position.y, z: side.position.z }, { ...DEFAULT_TOOL_PARAMS["platform-contour"] });
    const floorXs = runtime.getAllRegionTopologies().find((f) => f.surfaceType === "platform").nodes.map((n) => n.position.x);
    assert.deepEqual([Math.min(...floorXs), Math.max(...floorXs)], [0, 10], JSON.stringify(calls.feedback.slice(-2)));
    const xs = roofs(runtime)[0].props.roof.footprints[0].outer.map(([x]) => x);
    assert.deepEqual([Math.min(...xs), Math.max(...xs)], [0, 10]);
    const nodes = new Set(roofs(runtime).flatMap((f) => f.nodes.map((n) => n.id)));
    assert.ok(["p0", "p1", "p2", "p3"].every((id) => nodes.has(id)), "still welded");
  } finally { session.free(); }
});

test("a roof drawn over a floor's outline lands on it, stands at its height and is welded to it", () => {
  const value = fixture();
  const { runtime, session } = value;
  try {
    const floor = addFace(runtime, "floor", "platform", [[0, 0], [8, 0], [8, 4], [0, 4]].map(([x, z], i) => ({ id: `p${i}`, position: { x, y: 3, z } })));
    const start = { point: { x: 0.1, y: 3, z: -0.1 }, surfaceRef: surfaceRefFromNodeSet(floor.surfaceKey) };
    const current = { point: { x: 7.9, y: 3, z: 4.15 } };
    const params = { ...DEFAULT_TOOL_PARAMS.roof, elevation: 0, height: 2 };
    roofTool.onPointerDown(value.ctx, start, params);
    roofTool.onPointerUp(value.ctx, { start, current, samples: [start, current] }, params);
    const recipe = roofs(runtime)[0].props.roof;
    assert.equal(recipe.elevation, 3);
    assert.equal(recipe.base?.kind, "floor");
    const nodes = new Set(roofs(runtime).flatMap((f) => f.nodes.map((n) => n.id)));
    assert.ok(["p0", "p1", "p2", "p3"].every((id) => nodes.has(id)));
  } finally { session.free(); }
});
