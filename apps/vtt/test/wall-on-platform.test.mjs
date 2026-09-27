import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createAliasResolveHook } from "./support/alias-resolve-hook.mjs";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { hasTrait, shownGlobalHandles } from "../src/features/edit-construction/index.ts";

registerHooks(createAliasResolveHook(new URL("../src/", import.meta.url)));
const { wallLineTool } = await import("../src/composition/tabletop/tools/walls/wall-line-tool.ts");

/**
 * A wall drawn on a platform stands on it -- at its height exactly -- and
 * is joined to it wherever it meets its outline: at a corner, or partway
 * along a side, which is cut there. Joined, it goes wherever the platform goes.
 */

const params = { wallType: "wall-white", height: 3 };
function build(support = "floating") {
  const fixture = sessionFixture();
  Object.assign(fixture.runtime, { showPreview() {}, clearPreview() {} });
  commitPlatformContour(fixture.ctx, [[0, 0], [6, 0], [6, 4], [0, 4]].map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support, shape: "rectangle" });
  return fixture;
}
function wall(fixture, a, b) {
  const start = { point: a }, end = { point: b };
  wallLineTool.onPointerDown(fixture.ctx, start, params);
  wallLineTool.onPointerUp(fixture.ctx, { start, current: end, samples: [start, end] }, params);
}
const floorOf = (runtime) => runtime.getAllRegionTopologies().find((t) => hasTrait(t.surfaceType, "floor"));
const wallsOf = (runtime) => runtime.getAllRegionTopologies().filter((t) => hasTrait(t.surfaceType, "partition"));
const bottoms = (runtime) => [...new Set(wallsOf(runtime).flatMap((w) => w.nodes).filter((n) => n.position.y < 2.5).map((n) => n.id))];

test("a wall on a platform shares the platform's node at every corner that meets its outline -- a corner, or partway along a side", () => {
  for (const [name, a, b, joined] of [
    ["corner to corner", [0, 2, 0], [6, 2, 0], 2],
    ["partway along a side", [1, 2, 0], [4, 2, 0], 2],
    ["side to side across it", [3, 2, 0], [3, 2, 4], 2],
    ["a corner a little off", [0.1, 2, 0.1], [6.1, 2, 0.1], 2],
    ["from the side into it", [3, 2, 0], [3, 2, 2], 1],
  ]) {
    const fixture = build();
    try {
      wall(fixture, { x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] });
      const floor = floorOf(fixture.runtime);
      const ids = new Set(floor.nodes.map((n) => n.id));
      assert.equal(bottoms(fixture.runtime).filter((id) => ids.has(id)).length, joined, `${name}: ${JSON.stringify(fixture.calls.feedback.at(-1))}`);
    } finally { fixture.session.free(); }
  }
});

test("a wall picked a hair above a platform, as a real pointer does, still stands on it at its height", () => {
  const fixture = build();
  try {
    wall(fixture, { x: 0, y: 2.02, z: 0 }, { x: 6, y: 1.99, z: 0 });
    assert.ok(wallsOf(fixture.runtime).flatMap((w) => w.nodes).every((n) => Math.abs(n.position.y - 2) < 1e-9 || Math.abs(n.position.y - 5) < 1e-9), "on the floor, and as tall as asked");
    assert.equal(bottoms(fixture.runtime).filter((id) => floorOf(fixture.runtime).nodes.some((n) => n.id === id)).length, 2, "joined at both corners");
  } finally { fixture.session.free(); }
});

test("a wall pressed just past a raised platform's edge, the pointer's ray still meeting it there, stands on the platform, not the ground below", () => {
  const fixture = build();
  try {
    // The pick met the ground below; the ray crosses the platform's level at its edge.
    const origin = { x: 3, y: 12, z: -6 };
    const aim = (x, z) => {
      const d = { x: x - origin.x, y: 2 - origin.y, z: z - origin.z }, l = Math.hypot(d.x, d.y, d.z);
      const direction = { x: d.x / l, y: d.y / l, z: d.z / l };
      const t = -origin.y / direction.y;
      return { point: { x: origin.x + direction.x * t, y: 0, z: origin.z + direction.z * t }, ray: { origin, direction } };
    };
    const start = aim(1, -0.1), end = aim(5, -0.1);
    wallLineTool.onPointerDown(fixture.ctx, start, params);
    wallLineTool.onPointerUp(fixture.ctx, { start, current: end, samples: [start, end] }, params);
    const ys = wallsOf(fixture.runtime).flatMap((w) => w.nodes.map((n) => n.position.y));
    assert.equal(Math.min(...ys), 2, "at the platform's height");
  } finally { fixture.session.free(); }
});

test("walls joined to a platform go wherever it goes", () => {
  for (const support of ["floating", "grounded"]) {
    const fixture = build(support);
    const { runtime, ctx, calls, session } = fixture;
    try {
      wall(fixture, { x: 3, y: 2, z: 0 }, { x: 3, y: 2, z: 4 });
      const h = shownGlobalHandles({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: runtime.cloudFor }).find((x) => x.kind === "pivot" && hasTrait(x.owner, "floor"));
      const start = { nodeId: h.id, point: h.position, screenX: 100, screenY: 300 };
      const current = { point: { x: h.position.x + 2, y: h.position.y, z: h.position.z + 1 }, screenX: 200, screenY: 300 };
      platformContourTool.onPointerDown(ctx, start, {});
      platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, {});
      platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current] }, {});
      assert.equal(calls.feedback.at(-1).tone, "success", JSON.stringify(calls.feedback.at(-1)));
      assert.ok(wallsOf(runtime).flatMap((w) => w.nodes).every((n) => Math.abs(n.position.x - 5) < 1e-6), `${support}: the wall moved with it`);
    } finally { session.free(); }
  }
});
