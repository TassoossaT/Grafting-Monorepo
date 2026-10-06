import assert from "node:assert/strict";
import test from "node:test";

import { hasTrait, surfaceTypesWithTrait } from "../src/features/edit-construction/structure-types/registry.ts";
import { terrainSculptTool } from "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts";
import { DEFAULT_TOOL_PARAMS } from "../src/features/edit-construction/tools/tool-types.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";

test("ground is a declared trait, not a name prefix", () => {
  assert.deepEqual(surfaceTypesWithTrait("ground"), ["terrain", "terrain-grass"]);
  // An undeclared name that merely looks like terrain is not ground.
  assert.equal(hasTrait("terrain-snow", "ground"), false);
  for (const surfaceType of ["wall-white", "wall-gray", "platform", "platform-slope", "roof", "path", "opening"]) {
    assert.equal(hasTrait(surfaceType, "ground"), false, `${surfaceType} is not ground`);
  }
});

/** The brush dragged along `points` on the bare table, against the real engine. */
function brush(ctx, points, params) {
  const info = console.info, warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    const samples = points.map(([x, z], i) => ({ point: { x, y: 0, z }, screenX: i * 10, screenY: 0 }));
    terrainSculptTool.onPointerUp(ctx, { start: samples[0], current: samples.at(-1), samples }, { ...DEFAULT_TOOL_PARAMS["terrain-sculpt"], ...params });
  } finally {
    console.info = info;
    console.warn = warn;
  }
}

function bareTable() {
  const fixture = sessionFixture();
  const { runtime, session } = fixture;
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  runtime.getSnapshot = () => ({
    tableId: "t",
    map: { nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [n.id, { position: { x: n.position[0], y: n.position[1], z: n.position[2] } }])) },
  });
  return fixture;
}

const line = (x0, x1) => Array.from({ length: Math.round((x1 - x0) / 0.5) + 1 }, (_, i) => [x0 + i * 0.5, 0]);

test("terrainSculptTool: add on the bare table lays ground resting on it", () => {
  const { runtime, ctx, calls, session } = bareTable();
  try {
    brush(ctx, line(-4, 4), { mode: "add" });
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const ground = runtime.getAllRegionTopologies().filter((t) => hasTrait(t.surfaceType, "ground"));
    assert.ok(ground.length > 10, `ground laid: ${ground.length} faces`);
    assert.ok(ground.every((t) => t.nodes.every((n) => n.position.y > -0.05)), "nothing under the table");
  } finally { session.free(); }
});

test("terrainSculptTool: add laid across a floor standing on the table leaves the floor as it was", () => {
  const { runtime, ctx, calls, session } = bareTable();
  try {
    commitPlatformContour(ctx, [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({ point: { x, y: 3, z } })), { mode: "create", elevation: 3, shape: "rectangle" });
    const floor = () => runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform");
    const before = floor();
    assert.ok(before, "a floor stands");
    brush(ctx, line(-5, 5), { mode: "add" });
    assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const after = floor();
    assert.equal(after.nodes.length, before.nodes.length, "no side of the floor split");
    for (const node of before.nodes) {
      const now = after.nodes.find((n) => n.id === node.id);
      assert.ok(now && Math.hypot(now.position.x - node.position.x, now.position.y - node.position.y, now.position.z - node.position.z) < 1e-9, "the floor's corners where they were");
    }
    assert.ok(runtime.getAllRegionTopologies().some((t) => hasTrait(t.surfaceType, "ground")), "and ground laid");
  } finally { session.free(); }
});

test("terrainSculptTool: dig over the bare table, a floor standing on it, reports there is nothing to dig", () => {
  const { runtime, ctx, calls, session } = bareTable();
  try {
    commitPlatformContour(ctx, [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({ point: { x, y: 0.3, z } })), { mode: "create", elevation: 0.3, shape: "rectangle" });
    const before = runtime.getAllRegionTopologies().length;
    brush(ctx, line(-3, 3), { mode: "dig" });
    assert.equal(calls.feedback.at(-1)?.tone, "info", JSON.stringify(calls.feedback.at(-1)));
    assert.equal(calls.feedback.at(-1)?.message, "Nada a cavar aqui.");
    assert.equal(runtime.getAllRegionTopologies().length, before, "nothing changed");
  } finally { session.free(); }
});
