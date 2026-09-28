import assert from "node:assert/strict";
import test from "node:test";
import { commitRoof, roofTool } from "../src/composition/tabletop/tools/roof/roof-tool.ts";
import { DEFAULT_TOOL_PARAMS, planEdit, resolveCloudTopology, shownGlobalHandles } from "../src/features/edit-construction/index.ts";
import { sessionFixture, addFace } from "./platform-session-fixture.mjs";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";

function fixture() {
  const value = sessionFixture();
  value.runtime.generateCap = (request) => JSON.parse(value.session.profile_cap_json(JSON.stringify(request)));
  value.runtime.generateRoof = (request) => JSON.parse(value.session.profile_roof_json(JSON.stringify(request)));
  value.runtime.roofFootprintBlocks = (contour) => JSON.parse(value.session.roof_footprint_blocks_json(JSON.stringify(contour)));
  let operations = 0;
  const apply = value.runtime.applyPatchReplacement;
  value.runtime.applyPatchReplacement = (request) => { operations++; return apply(request); };
  return { ...value, operations: () => operations };
}

test("roof drag commits a four-water roof exactly once, keeping its recipe on every face", () => {
  const { ctx, runtime, session, operations } = fixture();
  try {
    const start = { point: { x: 0, y: 0, z: 0 } }, current = { point: { x: 8, y: 0, z: 4 } };
    const params = { ...DEFAULT_TOOL_PARAMS.roof, elevation: 3, height: 5 };
    const gesture = { start, current, samples: [start, current] };
    roofTool.previewFor(gesture, params, ctx);
    assert.equal(operations(), 0);
    roofTool.onPointerUp(ctx, gesture, params);
    assert.equal(operations(), 1);
    const faces = runtime.getAllRegionTopologies();
    assert.equal(faces.length, 4);
    assert.ok(faces.every((f) => f.props.roof.blocks[0].slopes.every((slope) => slope === 1)));
    assert.equal(new Set(faces.map((f) => f.props.roof.group)).size, 1);
    assert.equal(Math.max(...faces.flatMap((f) => f.nodes.map((n) => n.position.y))), 8);
    const cloud = resolveCloudTopology(runtime, faces[0].surfaceKey);
    const plan = planEdit(cloud, { surfaceKey: faces[0].surfaceKey, target: { kind: "region" }, delta: { x: 0, y: 2, z: 0 } }, runtime.getGraphSnapshot(), runtime);
    assert.equal(plan.kind, "apply", plan.reason);
    runtime.applyRegionEdit(plan.ops);
    assert.equal(Math.min(...runtime.getGraphSnapshot().nodes.map((n) => n.position.y)), 5);
    assert.equal(Math.max(...runtime.getGraphSnapshot().nodes.map((n) => n.position.y)), 10);
  } finally { session.free(); }
});

test("circular roof uses four arc leaves and refuses invalid height without a transaction", () => {
  const { ctx, runtime, session, operations, calls } = fixture();
  try {
    const request = { base: { kind: "circle", center: [0,0], radius: 2 }, elevation: 3, height: 2, overhang: 0.2, curvatures: [0,0,0,0] };
    commitRoof(ctx, request);
    assert.equal(operations(), 1);
    const faces = runtime.getAllRegionTopologies();
    assert.equal(faces.length, 4);
    assert.ok(faces.every((face) => face.outerLoops[0][0].geometry.kind === "arc"));
    const before = session.all_surface_meshes_json();
    commitRoof(ctx, { ...request, height: -1 });
    assert.equal(operations(), 1);
    assert.equal(calls.feedback.at(-1).tone, "error");
    assert.equal(session.all_surface_meshes_json(), before);
  } finally { session.free(); }
});

test("roof on a platform takes its contour and elevation without replacing the platform", () => {
  const { ctx, runtime, session, operations } = fixture();
  try {
    const platform = addFace(runtime, "support", "platform", [[0,0],[8,0],[8,4],[0,4]].map(([x,z],index) => ({ id: `p${index}`, position: { x,y:7,z } })));
    roofTool.onClick(ctx, { point: { x: 3, y: 7, z: 2 }, surfaceRef: surfaceRefFromNodeSet(platform.surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, shape: "base", elevation: 0, height: 3 });
    assert.equal(operations(), 1);
    const all = runtime.getAllRegionTopologies();
    assert.equal(all.filter((f) => f.surfaceType === "platform").length, 1);
    const roofs = all.filter((f) => f.surfaceType === "roof");
    assert.equal(roofs.length, 4);
    assert.equal(Math.min(...roofs.flatMap((f) => f.nodes.map((n) => n.position.y))), 7);
    assert.equal(Math.max(...roofs.flatMap((f) => f.nodes.map((n) => n.position.y))), 10);
    const entry = ctx.history.undo();
    session.undo_region_overlay(entry.transactionId);
    assert.equal(runtime.getAllRegionTopologies().length, 1);
    session.redo_region_overlay(ctx.history.redo().transactionId);
    assert.equal(runtime.getAllRegionTopologies().length, 5);
  } finally { session.free(); }
});

test("two and one waters close their unpitched sides with vertical gables", () => {
  for (const [waters, leaves, gables] of [[2, 2, 2], [1, 1, 3]]) {
    const { ctx, runtime, session } = fixture();
    try {
      const start = { point: { x: 0, y: 0, z: 0 } }, current = { point: { x: 8, y: 0, z: 4 } };
      roofTool.onPointerUp(ctx, { start, current, samples: [start, current] }, { ...DEFAULT_TOOL_PARAMS.roof, waters, elevation: 3, height: 2 });
      const faces = runtime.getAllRegionTopologies();
      // A vertical face stands on one line in plan.
      const vertical = ({ nodes: [a, b, ...rest] }) => rest.every((c) => Math.abs((b.position.x - a.position.x) * (c.position.z - a.position.z) - (b.position.z - a.position.z) * (c.position.x - a.position.x)) < 1e-6);
      assert.equal(faces.length, leaves + gables, `${waters} waters`);
      assert.equal(faces.filter(vertical).length, gables, `${waters} waters`);
      assert.equal(Math.max(...faces.flatMap((f) => f.nodes.map((n) => n.position.y))), 5);
    } finally { session.free(); }
  }
});

/** An L room of wall panels three high, sharing their columns. */
function lRoom(runtime) {
  const plan = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
  const foot = plan.map(([x, z], i) => ({ id: `f${i}`, position: { x, y: 0, z } }));
  const top = plan.map(([x, z], i) => ({ id: `t${i}`, position: { x, y: 3, z } }));
  return plan.map((_, i) => {
    const j = (i + 1) % plan.length;
    return addFace(runtime, `wall-${i}`, "wall-white", [foot[i], foot[j], top[j], top[i]]);
  });
}

test("a roof over a wall loop takes the room's L as joined blocks at the wall tops", () => {
  const { ctx, runtime, session, operations } = fixture();
  try {
    const walls = lRoom(runtime);
    roofTool.onClick(ctx, { point: { x: 5, y: 3, z: 0 }, surfaceRef: surfaceRefFromNodeSet(walls[0].surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, shape: "base", height: 2 });
    assert.equal(operations(), 1, ctx.calls?.feedback?.at(-1)?.message);
    const roofs = runtime.getAllRegionTopologies().filter((f) => f.surfaceType === "roof");
    assert.equal(roofs[0].props.roof.blocks.length, 2);
    const ys = roofs.flatMap((f) => f.nodes.map((n) => n.position.y));
    assert.equal(Math.min(...ys), 3);
    assert.ok(Math.abs(Math.max(...ys) - 5) < 1e-6);
  } finally { session.free(); }
});

test("a wall run that closes no room carries no roof", () => {
  const { ctx, runtime, session, operations, calls } = fixture();
  try {
    const foot = [0, 1, 2].map((i) => ({ id: `f${i}`, position: { x: i * 4, y: 0, z: 0 } }));
    const top = [0, 1, 2].map((i) => ({ id: `t${i}`, position: { x: i * 4, y: 3, z: 0 } }));
    const wall = addFace(runtime, "wall-0", "wall-white", [foot[0], foot[1], top[1], top[0]]);
    addFace(runtime, "wall-1", "wall-white", [foot[1], foot[2], top[2], top[1]]);
    roofTool.onClick(ctx, { point: { x: 1, y: 3, z: 0 }, surfaceRef: surfaceRefFromNodeSet(wall.surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, shape: "base" });
    assert.equal(operations(), 0);
    assert.equal(calls.feedback.at(-1).tone, "error");
  } finally { session.free(); }
});

// ---- Handles: every edit regenerates the roof from its recipe ----

/** Where node `id` is pinned: pins ride on the faces' nodes. */
const pinOf = (runtime, id) => runtime.getAllRegionTopologies().flatMap((f) => f.nodes).find((n) => n.id === id)?.pin;
const scene = (runtime) => ({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: runtime.cloudFor });
const roofs = (runtime) => runtime.getAllRegionTopologies().filter((f) => f.surfaceType === "roof");
const top = (runtime) => Math.max(...roofs(runtime).flatMap((f) => f.nodes.map((n) => n.position.y)));

/** A roof dragged over 8 x 4 at elevation 3, rising 2. */
function roofed(waters = 4) {
  const value = fixture();
  Object.assign(value.runtime, { showPreview() {}, clearPreview() {} });
  const start = { point: { x: 0, y: 0, z: 0 } }, current = { point: { x: 8, y: 0, z: 4 } };
  roofTool.onPointerUp(value.ctx, { start, current, samples: [start, current] }, { ...DEFAULT_TOOL_PARAMS.roof, waters, elevation: 3, height: 2 });
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

test("a recipe roof shows its rise, a slope per leaf, its seams and a side, corner and insert per eave", () => {
  const { runtime, session } = roofed();
  try {
    const kinds = shownGlobalHandles(scene(runtime)).filter((h) => h.owner === "roof").map((h) => h.kind);
    const count = (kind) => kinds.filter((k) => k === kind).length;
    assert.deepEqual([count("pivot"), count("rotate"), count("rise")], [1, 1, 1]);
    assert.equal(count("slope"), 4);
    assert.equal(count("seam"), 5, "four hips and the ridge");
    assert.deepEqual([count("side"), count("corner"), count("insert")], [4, 4, 4]);
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

test("raising a gable's slope turns two waters into a hip end, and an eave pushed out overhangs further", () => {
  const value = roofed(2);
  const { runtime, session } = value;
  try {
    assert.equal(roofs(runtime)[0].props.roof.blocks[0].slopes.filter((s) => s === 0).length, 2);
    const gable = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "slope" && roofs(runtime).some((f) => f.props.roofFace.upright
      && f.props.roofFace.side === h.recipeHandle.part.side));
    dragHandle(value, gable, gable.position, 260);
    assert.equal(roofs(runtime)[0].props.roof.blocks[0].slopes.filter((s) => s === 0).length, 1);
    const side = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "side" && h.recipeHandle.part.side === 0);
    const out = side.recipeHandle.part.outward;
    dragHandle(value, side, { x: side.position.x + out[0], y: side.position.y, z: side.position.z + out[1] });
    assert.ok(Math.abs(roofs(runtime)[0].props.roof.blocks[0].overhangs[0] - 1.2) < 1e-6);
  } finally { session.free(); }
});

test("pulling a corner out of a side adds a leaf", () => {
  const value = roofed();
  const { runtime, session } = value;
  try {
    const insert = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "insert" && h.recipeHandle.part.side === 0);
    const out = insert.recipeHandle.part.outward;
    dragHandle(value, insert, { x: insert.position.x + out[0], y: insert.position.y, z: insert.position.z + out[1] });
    const recipe = roofs(runtime)[0].props.roof;
    assert.equal(recipe.blocks[0].contour.length, 5);
    assert.equal(new Set(roofs(runtime).map((f) => `${f.props.roofFace.block}:${f.props.roofFace.side}`)).size, 5);
  } finally { session.free(); }
});

test("a rectangle drawn into a standing roof joins it as a cross gable, one roof", () => {
  const value = roofed();
  const { runtime, session, ctx } = value;
  try {
    const start = { point: { x: 3, y: 0, z: -4 } }, current = { point: { x: 5, y: 0, z: 2 } };
    roofTool.onPointerUp(ctx, { start, current, samples: [start, current] }, { ...DEFAULT_TOOL_PARAMS.roof, waters: 2, elevation: 0, height: 9 });
    const groups = new Set(roofs(runtime).map((f) => f.props.roof.group));
    assert.equal(groups.size, 1);
    const recipe = roofs(runtime)[0].props.roof;
    assert.equal(recipe.blocks.length, 2);
    assert.equal(recipe.elevation, 3, "the arm stands on the roof it joins");
    assert.ok(roofs(runtime).some((f) => f.props.roofFace.block === 1));
  } finally { session.free(); }
});

// ---- Dormers ----

/** A two-water roof over 8 x 4, rising 4, with a dormer clicked onto its front leaf. */
function dormered() {
  const value = roofed(2);
  const { runtime, ctx } = value;
  const rise = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "rise");
  dragHandle(value, rise, rise.position, 220);
  const leaf = roofs(runtime).find((f) => !f.props.roofFace.upright && f.nodes.some((n) => n.position.z < 0));
  // A click is a press and a release on the same spot.
  const sample = { point: { x: 4, y: 3.6, z: 0.6 }, surfaceRef: surfaceRefFromNodeSet(leaf.surfaceKey) };
  const params = { ...DEFAULT_TOOL_PARAMS.roof, shape: "dormer", waters: 2 };
  roofTool.onPointerDown(ctx, sample, params);
  roofTool.onPointerUp(ctx, { start: sample, current: sample, samples: [sample] }, params);
  roofTool.onClick(ctx, sample, params);
  return value;
}

test("a dormer clicked onto a leaf opens it and stands on a front and two cheeks", () => {
  const value = dormered();
  const { runtime, session, calls } = value;
  try {
    const recipe = roofs(runtime)[0].props.roof;
    assert.equal(recipe.dormers.length, 1, JSON.stringify(calls.feedback.at(-1)));
    const own = roofs(runtime).filter((f) => f.props.roofFace.block === 1);
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
    assert.ok(roofs(runtime).every((f) => f.props.roofFace.block === 0));
  } finally { session.free(); }
});

test("what is pinned to a dormer's front stays pinned to it where it was when the roof is made again", () => {
  const value = dormered();
  const { runtime, session, ctx } = value;
  try {
    const front = roofs(runtime).find((f) => f.props.roofFace.block === 1 && f.props.roofFace.upright && f.props.roofFace.side === 0);
    const window = addFace(runtime, "window", "opening", [[0.4, 0.3], [0.6, 0.3], [0.6, 0.7], [0.4, 0.7]].map(([u, v], i) => ({ id: `w${i}`, position: { x: 0, y: 0, z: 0 } })));
    runtime.pinNodes([0, 1, 2, 3].map((i) => ({ nodeId: `w${i}`, hostSurfaceKey: front.surfaceKey, u: [0.4, 0.6, 0.6, 0.4][i], v: [0.3, 0.3, 0.7, 0.7][i] })), "local", "test-pin");
    const pinnedBefore = pinOf(runtime, "w2");
    assert.deepEqual(pinnedBefore?.hostSurfaceKey, front.surfaceKey);
    const rise = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "rise" && h.recipeHandle.anchor === "rise");
    dragHandle(value, rise, rise.position, 260);
    const now = roofs(runtime).find((f) => f.props.roofFace.block === 1 && f.props.roofFace.upright && f.props.roofFace.side === 0);
    assert.notEqual(now.surfaceKey.join(), front.surfaceKey.join(), "the roof was made again");
    const pin = pinOf(runtime, "w2");
    assert.deepEqual(pin?.hostSurfaceKey, now.surfaceKey);
    assert.ok(Math.abs(pin.u - 0.6) < 1e-9 && Math.abs(pin.v - 0.7) < 1e-9);
    void window; void ctx;
  } finally { session.free(); }
});
