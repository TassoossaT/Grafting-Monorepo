import assert from "node:assert/strict";
import test from "node:test";
import { platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

/**
 * A platform is drawn along the frame it is begun in: a turned structure's
 * own sides next to it, else the way the camera looks -- never the world's
 * fixed x and z.
 */

const turn = Math.PI / 6;
const turned = (x, z) => ({ x: x * Math.cos(turn) - z * Math.sin(turn), z: x * Math.sin(turn) + z * Math.cos(turn) });

function drawRectangle(ctx, start, end, extra = {}) {
  const params = { ...platformContourTool.defaultParams(), shape: "rectangle", mode: "create", ...extra };
  platformContourTool.onPointerDown(ctx, start, params);
  platformContourTool.onPointerMove(ctx, { start, current: end, samples: [start, end] }, params);
  platformContourTool.onPointerUp(ctx, { start, current: end, samples: [start, end], moved: true }, params);
}

/** Every side of `topology`, as its angle in plan folded into a quarter turn. */
const sideAngles = (topology) => {
  const at = new Map(topology.nodes.map((n) => [n.id, n.position]));
  return topology.outerLoops.flat().map((use) => {
    const a = at.get(use.startNodeId), b = at.get(use.endNodeId);
    const angle = Math.atan2(b.z - a.z, b.x - a.x);
    return ((angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  });
};

test("a platform begun next to a turned platform's side is built along that side, flush with it", () => {
  const { runtime, session, ctx, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  try {
    addFace(runtime, "old", "platform-floating", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `old:${i}`, position: { ...turned(x, z), y: 2 } })));
    // Just off the turned platform's east side, dragged out and across -- in world terms, diagonally.
    const start = { point: { ...turned(4.2, 1), y: 2 } }, end = { point: { ...turned(7, 3), y: 2 } };
    drawRectangle(ctx, start, end, { support: "floating" });
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback));
    const faces = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform-floating");
    for (const face of faces) {
      for (const angle of sideAngles(face)) {
        const off = Math.min(Math.abs(angle - turn), Math.abs(angle - turn + Math.PI / 2), Math.abs(angle - turn - Math.PI / 2));
        assert.ok(off < 1e-6, `every side runs along the turned platform's: ${angle} vs ${turn}`);
      }
    }
    // Flush: the new platform's side lies on the old one's, so they joined.
    const nodes = faces.flatMap((f) => f.nodes);
    assert.ok(nodes.some((n) => !n.id.startsWith("old:")), "a new platform was drawn");
    assert.ok(nodes.filter((n) => !n.id.startsWith("old:")).every((n) => {
      const x = n.position.x * Math.cos(-turn) - n.position.z * Math.sin(-turn);
      return x > 4 - 1e-6;
    }), "beside it, starting at its side");
  } finally { session.free(); }
});

test("away from anything, a platform is built along the way the camera looks", () => {
  const { runtime, session, ctx, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  try {
    const forward = { x: Math.cos(Math.PI / 4 + 0.03), y: -0.6, z: Math.sin(Math.PI / 4 + 0.03) };
    drawRectangle(ctx, { point: { x: 20, y: 0, z: 20 }, forward }, { point: { x: 24, y: 0, z: 21 }, forward });
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback));
    const face = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform");
    assert.ok(face, "drawn");
    for (const angle of sideAngles(face)) assert.ok(Math.abs(angle - Math.PI / 4) < 1e-6, `along the camera's heading, in its steps: ${angle}`);
  } finally { session.free(); }
});

test("a floor drawn against part of another's side joins it whichever way round it was drawn", async () => {
  const { commitPlatformContour } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  for (const corners of [[[4, 1], [7, 1], [7, 3], [4, 3]], [[4, 1], [4, 3], [7, 3], [7, 1]], [[4, 0], [4, 4], [7, 4], [7, 0]]]) {
    const { runtime, session, ctx, calls } = sessionFixture();
    try {
      addFace(runtime, "old", "platform-floating", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `old:${i}`, position: { x, y: 2, z } })));
      commitPlatformContour(ctx, corners.map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support: "floating", shape: "rectangle" });
      assert.ok(!calls.feedback.some((f) => f.tone === "error"), `${JSON.stringify(corners)}: ${JSON.stringify(calls.feedback)}`);
      const floors = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform-floating");
      assert.equal(floors.length, 1, "one floor");
      assert.ok(floors[0].nodes.some((n) => Math.abs(n.position.x - 7) < 1e-9), "reaching out to the new part");
    } finally { session.free(); }
  }
});

test("a floor drawn over another of its kind at its height stays its own cloud: no shared node, no hole in either", async () => {
  const { commitPlatformContour } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const cases = {
    crossing: [[2, 1], [6, 1], [6, 3], [2, 3]],
    inside: [[1, 1], [3, 1], [3, 3], [1, 3]],
    covering: [[-1, -1], [5, -1], [5, 5], [-1, 5]],
    "over a corner": [[3, 3], [6, 3], [6, 6], [3, 6]],
    // Its corner right on the old floor's corner: still not one of its nodes.
    "from its corner": [[4, 4], [2, 4], [2, 7], [4, 7]].map(([x, z]) => [x, z - 1]),
  };
  for (const [name, corners] of Object.entries(cases)) {
    const { runtime, session, ctx, calls } = sessionFixture();
    try {
      addFace(runtime, "old", "platform-floating", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `old:${i}`, position: { x, y: 2, z } })));
      commitPlatformContour(ctx, corners.map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support: "floating", shape: "rectangle" });
      assert.ok(!calls.feedback.some((f) => f.tone === "error"), `${name}: ${JSON.stringify(calls.feedback)}`);
      const floors = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform-floating");
      assert.equal(floors.length, 2, `${name}: two floors`);
      assert.ok(floors.every((f) => f.holes.length === 0), `${name}: no holes`);
      const [a, b] = floors.map((f) => new Set(f.nodes.map((n) => n.id)));
      assert.ok(![...a].some((id) => b.has(id)), `${name}: not one shared node`);
      assert.equal(runtime.cloudFor({ seed: floors[0].surfaceKey, surfaceType: "platform-floating" }).surfaceKeys.length, 1, `${name}: two clouds`);
    } finally { session.free(); }
  }
});
