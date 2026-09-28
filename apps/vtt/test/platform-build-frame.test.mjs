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
    addFace(runtime, "old", "platform", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `old:${i}`, position: { ...turned(x, z), y: 2 } })));
    // Just off the turned platform's east side, dragged out and across -- in world terms, diagonally.
    const start = { point: { ...turned(4.2, 1), y: 2 } }, end = { point: { ...turned(7, 3), y: 2 } };
    drawRectangle(ctx, start, end, { support: "floating" });
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback));
    const faces = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform");
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
      addFace(runtime, "old", "platform", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `old:${i}`, position: { x, y: 2, z } })));
      commitPlatformContour(ctx, corners.map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support: "floating", shape: "rectangle" });
      assert.ok(!calls.feedback.some((f) => f.tone === "error"), `${JSON.stringify(corners)}: ${JSON.stringify(calls.feedback)}`);
      const floors = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform");
      assert.equal(floors.length, 1, "one floor");
      assert.ok(floors[0].nodes.some((n) => Math.abs(n.position.x - 7) < 1e-9), "reaching out to the new part");
    } finally { session.free(); }
  }
});

test("a floor drawn over another of its kind at its height is united with it: one floor, one cloud, nothing lying over anything", async () => {
  const { commitPlatformContour } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const cases = {
    crossing: [[[2, 1], [6, 1], [6, 3], [2, 3]], 4 * 4 + 2 * 2],
    inside: [[[1, 1], [3, 1], [3, 3], [1, 3]], 16],
    covering: [[[-1, -1], [5, -1], [5, 5], [-1, 5]], 36],
    "over a corner": [[[3, 3], [6, 3], [6, 6], [3, 6]], 16 + 9 - 1],
  };
  for (const [name, [corners, area]] of Object.entries(cases)) {
    const { runtime, session, ctx, calls } = sessionFixture();
    try {
      addFace(runtime, "old", "platform", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `old:${i}`, position: { x, y: 2, z } })));
      commitPlatformContour(ctx, corners.map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support: "floating", shape: "rectangle" });
      assert.ok(!calls.feedback.some((f) => f.tone === "error"), `${name}: ${JSON.stringify(calls.feedback)}`);
      const floors = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform");
      assert.equal(floors.length, 1, `${name}: one floor`);
      assert.equal(floors[0].holes.length, 0, `${name}: no hole`);
      assert.ok(Math.abs(planArea(floors[0]) - area) < 1e-6, `${name}: the union's area, ${planArea(floors[0])} != ${area}`);
      if (name !== "covering") {
        // The standing floor is the new one's limit, never reshaped: its corners
        // still on the outline stay where they were; one the new floor covers is inside now.
        for (const [i, [x, z]] of [[0, 0], [4, 0], [4, 4], [0, 4]].entries()) {
          const node = floors[0].nodes.find((n) => n.id === `old:${i}`);
          assert.ok(!node || (node.position.x === x && node.position.z === z), `${name}: old:${i} kept at ${x},${z}`);
        }
        assert.ok(floors[0].nodes.some((n) => n.id === "old:0"), `${name}: the far corner is the old floor's own`);
      }
    } finally { session.free(); }
  }
});

test("a U of floors closed by a bar drawn over both its arms becomes one ring: one cloud, its courtyard a real hole", async () => {
  const { commitPlatformContour } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const { runtime, session, ctx, calls } = sessionFixture();
  try {
    addFace(runtime, "u", "platform", [[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]].map(([x, z], i) => ({ id: `u:${i}`, position: { x, y: 2, z } })));
    // Begun on one arm's outer side and dragged past the other's: it lies over both.
    commitPlatformContour(ctx, [[0, 5], [6.3, 5], [6.3, 7], [0, 7]].map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support: "floating", shape: "rectangle" });
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback));
    const floors = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform");
    assert.equal(floors.length, 1, "one floor");
    assert.equal(floors[0].holes.length, 1, "the courtyard inside the ring");
    const u = [[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]];
    for (const [i, [x, z]] of u.entries()) {
      const node = floors[0].nodes.find((n) => n.id === `u:${i}`);
      assert.ok(!node || (node.position.x === x && node.position.z === z), `the U's corner u:${i} kept where it was`);
    }
    assert.ok(["u:0", "u:1", "u:4", "u:5"].every((id) => floors[0].nodes.some((n) => n.id === id)), "the U's own corners the bar did not cover");
    // The U, plus only what of the bar its arms left free; the courtyard closed off at the bar.
    assert.ok(Math.abs(planArea(floors[0]) - (28 + 8.6)) < 1e-6, `area ${planArea(floors[0])}`);
  } finally { session.free(); }
});

test("a round floor drawn over a floor stays its own cloud, sharing no node: a curved union is never taken", async () => {
  const { commitPlatformShape } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const { circleContour } = await import("../src/composition/tabletop/tools/tower/tower-geometry.ts");
  const { runtime, session, ctx, calls } = sessionFixture();
  try {
    addFace(runtime, "old", "platform", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `old:${i}`, position: { x, y: 2, z } })));
    commitPlatformShape(ctx, circleContour({ x: 4, y: 2, z: 2 }, 1.5), { mode: "create", elevation: 2, support: "floating", shape: "circle" });
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback));
    const floors = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform");
    assert.equal(floors.length, 2);
    assert.ok(floors.every((f) => f.holes.length === 0), "no holes");
    const [a, b] = floors.map((f) => new Set(f.nodes.map((n) => n.id)));
    assert.ok(![...a].some((id) => b.has(id)), "not one shared node");
  } finally { session.free(); }
});

/** A face's area in plan. */
function planArea(topology) {
  const at = new Map(topology.nodes.map((n) => [n.id, n.position]));
  const ring = (loop) => Math.abs(loop.reduce((sum, use) => {
    const a = at.get(use.startNodeId), b = at.get(use.endNodeId);
    return sum + a.x * b.z - b.x * a.z;
  }, 0) / 2);
  return topology.outerLoops.reduce((sum, loop) => sum + ring(loop), 0) - topology.holes.reduce((sum, loop) => sum + ring(loop), 0);
}

test("a rectangle drawn for a raised floor follows the pointer at that floor's level, not the ground the pointer hits below", () => {
  const { runtime, session, ctx } = sessionFixture();
  const shown = [];
  Object.assign(runtime, { showPreview(d) { shown.push(d); }, clearPreview() {} });
  try {
    const params = { ...platformContourTool.defaultParams(), shape: "rectangle", mode: "create", elevation: 3, support: "floating" };
    // A camera up and behind: the ray reaches the level 3 well before it hits the ground.
    const origin = { x: 0, y: 10, z: -10 };
    const sample = (x, z) => {
      const onLevel = { x, y: 3, z }, direction = { x: onLevel.x - origin.x, y: onLevel.y - origin.y, z: onLevel.z - origin.z };
      const length = Math.hypot(direction.x, direction.y, direction.z);
      const d = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
      const t = -origin.y / d.y;
      return { point: { x: origin.x + d.x * t, y: 0, z: origin.z + d.z * t }, ray: { origin, direction: d }, forward: { x: 1, y: -0.5, z: 0 } };
    };
    const start = sample(0, 0), end = sample(4, 2);
    platformContourTool.onPointerDown(ctx, start, params);
    platformContourTool.onPointerMove(ctx, { start, current: end, samples: [start, end] }, params);
    platformContourTool.onPointerUp(ctx, { start, current: end, samples: [start, end], moved: true }, params);
    const floor = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform");
    assert.ok(floor, "drawn");
    const xs = floor.nodes.map((n) => n.position.x), zs = floor.nodes.map((n) => n.position.z);
    assert.ok(Math.abs(Math.min(...xs)) < 1e-6 && Math.abs(Math.max(...xs) - 4) < 1e-6 && Math.abs(Math.min(...zs)) < 1e-6 && Math.abs(Math.max(...zs) - 2) < 1e-6,
      `under the pointer at level 3: ${JSON.stringify(floor.nodes.map((n) => n.position))}`);
  } finally { session.free(); }
});

test("rectangles drawn anywhere round a U are never refused, never move it, and never leave one cloud's faces lying over each other", async () => {
  const { faceOutlines, outlinesOverlap } = await import("../src/features/edit-construction/index.ts");
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const U = [[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]];
  for (let k = 0; k < 80; k++) {
    const { runtime, session, ctx, calls } = sessionFixture();
    Object.assign(runtime, { showPreview() {}, clearPreview() {} });
    try {
      addFace(runtime, "u", "platform", U.map(([x, z], i) => ({ id: `u:${i}`, position: { x, y: 2, z } })));
      const a = { point: { x: -1 + rnd() * 8, y: 2, z: -1 + rnd() * 9 }, forward: { x: 1, y: -1, z: 0.001 } };
      const b = { point: { x: a.point.x + (rnd() - 0.5) * 8, y: 2, z: a.point.z + (rnd() - 0.5) * 8 }, forward: a.forward };
      drawRectangle(ctx, a, b, { support: "floating", elevation: 2 });
      const where = JSON.stringify([a.point, b.point]);
      assert.ok(!calls.feedback.some((f) => f.tone === "error"), `${where}: ${JSON.stringify(calls.feedback)}`);
      for (const n of runtime.getGraphSnapshot().nodes) {
        const m = /^u:(\d)$/.exec(n.id);
        if (m) assert.ok(n.position.x === U[+m[1]][0] && n.position.z === U[+m[1]][1], `${where}: ${n.id} moved`);
      }
      const faces = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform");
      for (let i = 0; i < faces.length; i++) {
        const cloud = runtime.cloudFor({ seed: faces[i].surfaceKey, surfaceType: faces[i].surfaceType }).surfaceKeys.map((key) => key.join("|"));
        for (let j = i + 1; j < faces.length; j++) {
          if (!cloud.includes(faces[j].surfaceKey.join("|"))) continue;
          assert.ok(!faceOutlines(faces[i]).some((p) => faceOutlines(faces[j]).some((q) => outlinesOverlap(p, q))), `${where}: one cloud's faces overlap`);
        }
      }
    } finally { session.free(); }
  }
});

test("a rectangle's side that comes near a built side lying the same way lands on it: flush, never a sliver over or short", () => {
  const { runtime, session, ctx, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  try {
    addFace(runtime, "old", "platform", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `old:${i}`, position: { x, y: 2, z } })));
    const forward = { x: 1, y: -1, z: 0.001 };
    // From beside the old floor, its far side dragged a little past the old floor's far side.
    drawRectangle(ctx, { point: { x: 4, y: 2, z: 0 }, forward }, { point: { x: 7, y: 2, z: 4.3 }, forward }, { support: "floating", elevation: 2 });
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback));
    const zs = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform").flatMap((t) => t.nodes.map((n) => n.position.z));
    assert.equal(Math.max(...zs), 4, "landed on the old floor's far side, not 4.3");
  } finally { session.free(); }
});

test("a floor with a hole: what is drawn in the hole against its edge joins it, a bar across splits the hole in two, one floated in it stays apart", async () => {
  const { commitPlatformContour } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const P = (pts) => pts.map(([x, z]) => ({ point: { x, y: 2, z } }));
  const params = (mode) => ({ mode, elevation: 2, support: "floating", shape: "rectangle" });
  const cases = {
    "in the hole, against its edge": [[[2, 2], [4, 2], [4, 3], [2, 3]], { faces: 1, holes: [1] }],
    "across the hole and out past the floor": [[[1, 2.5], [8, 2.5], [8, 3.5], [1, 3.5]], { faces: 1, holes: [2] }],
    "floated in the hole": [[[2.5, 2.5], [3.5, 2.5], [3.5, 3], [2.5, 3]], { faces: 2, holes: [0, 1] }],
  };
  for (const [name, [corners, expected]] of Object.entries(cases)) {
    const { runtime, session, ctx, calls } = sessionFixture();
    try {
      commitPlatformContour(ctx, P([[0, 0], [6, 0], [6, 6], [0, 6]]), params("create"));
      commitPlatformContour(ctx, P([[2, 2], [4, 2], [4, 4], [2, 4]]), params("cut"));
      commitPlatformContour(ctx, P(corners), params("create"));
      assert.ok(!calls.feedback.some((f) => f.tone === "error"), `${name}: ${JSON.stringify(calls.feedback)}`);
      const floors = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform");
      assert.equal(floors.length, expected.faces, `${name}: faces`);
      assert.deepEqual(floors.map((f) => f.holes.length).sort(), expected.holes, `${name}: holes`);
    } finally { session.free(); }
  }
});
