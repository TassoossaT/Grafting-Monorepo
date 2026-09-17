import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";

/**
 * A platform laid in a depression, against the real engine, meets the ground
 * around it on every side -- whichever diagonal the rectangle was dragged along.
 *
 * Dragged one way the contour winds counter-clockwise, the other way clockwise,
 * and two things went wrong only for the second. The face was stored walking
 * its edges the same way as the ground outside, so every cell laid against it
 * was dropped for "sitting on standing ground". And the ground's corners were
 * inserted into each platform edge in reverse order, so the edge came back as
 * fragments overlapping each other. Either one leaves whole sides empty, with
 * every count in the terrain log still reading zero.
 */

function bowl(runtime, session) {
  // The fixture's snapshot knows no positions; adoption reads live ones.
  runtime.getSnapshot = () => ({
    tableId: "t",
    map: {
      nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [
        n.id,
        { position: { x: n.position[0], y: n.position[1], z: n.position[2] } },
      ])),
    },
  });
  const cell = 2;
  const cells = 8;
  const id = (i, j) => `g:${i}:${j}`;
  const nodes = [];
  for (let i = 0; i <= cells; i++) for (let j = 0; j <= cells; j++) {
    const x = -8 + i * cell;
    const z = -8 + j * cell;
    nodes.push({ id: id(i, j), position: { x, y: 0.04 * (x * x + z * z), z } });
  }
  const edges = new Map();
  const use = (a, b) => {
    const key = a < b ? `${a}~${b}` : `${b}~${a}`;
    if (!edges.has(key)) edges.set(key, { edgeId: `e:${key}`, startNodeId: a < b ? a : b, endNodeId: a < b ? b : a });
    return { edgeId: edges.get(key).edgeId, reversed: edges.get(key).startNodeId !== a };
  };
  const regions = [];
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    const ring = [id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)];
    regions.push({ regionId: `q:${i}:${j}`, boundary: ring.map((a, n) => use(a, ring[(n + 1) % 4])), surfaceType: "terrain", physical: true });
  }
  runtime.addPatch({ nodes, edges: [...edges.values()], regions });
}

/** Platform edges no ground face shares, matched by node pair. */
function bareSides(runtime) {
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const users = new Map();
  const topologies = runtime.getAllRegionTopologies();
  for (const t of topologies) for (const loop of [...t.outerLoops, ...t.holes]) for (const e of loop) {
    const k = key(e.startNodeId, e.endNodeId);
    users.set(k, [...(users.get(k) ?? []), t.surfaceType]);
  }
  return topologies
    .filter((t) => t.surfaceType === "platform")
    .flatMap((t) => t.outerLoops[0])
    .filter((e) => !users.get(key(e.startNodeId, e.endNodeId)).includes("terrain")).length;
}

for (const [label, from, to] of [
  ["counter-clockwise", [-3, -2], [2, 3]],
  ["clockwise", [2, -2], [-3, 3]],
]) {
  test(`a platform dragged ${label} in a depression is met by ground on every side`, () => {
    const { session, runtime, ctx, calls } = sessionFixture();
    const info = console.info;
    const warn = console.warn;
    console.info = () => {};
    console.warn = () => {};
    try {
      bowl(runtime, session);
      const corners = [[from[0], from[1]], [to[0], from[1]], [to[0], to[1]], [from[0], to[1]]]
        .map(([x, z]) => ({ point: { x, y: 0.3, z } }));
      commitPlatformContour(ctx, corners, { mode: "create", elevation: 0.3, shape: "rectangle" });

      assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback));
      assert.equal(bareSides(runtime), 0, "no side of the platform is left without ground against it");
    } finally {
      console.info = info;
      console.warn = warn;
      session.free();
    }
  });
}

test("ground repaired around a platform already stored clockwise splits its edges in order", async () => {
  // Faces committed before winding was normalised still stand the wrong way
  // round. Repairing ground against one must not break the platform itself:
  // the corners it adopts are measured along the ring, which runs against
  // this edge, and inserted in that order they came back as fragments
  // overlapping each other -- a side of 5 walked as four spans of 3.75.
  const { repairTerrainCut } = await import("../src/composition/tabletop/terrain/terrain-regenerate.ts");
  const { session, runtime } = sessionFixture();
  const info = console.info;
  const warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    bowl(runtime, session);
    const clockwise = [[2, -2], [-3, -2], [-3, 3], [2, 3]];
    const nodes = clockwise.map(([x, z], index) => ({ id: `cw:${index}`, position: { x, y: 0.3, z } }));
    const edges = nodes.map((node, index) => ({ edgeId: `cw:edge:${index}`, startNodeId: node.id, endNodeId: nodes[(index + 1) % 4].id }));
    runtime.addPatch({ nodes, edges, regions: [{ regionId: "cw", boundary: edges.map((e) => ({ edgeId: e.edgeId, reversed: false })), surfaceType: "platform", physical: true }] });

    const under = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "terrain" && t.nodes.some((n) => n.position.x > -3 && n.position.x < 2 && n.position.z > -2 && n.position.z < 3));
    repairTerrainCut(runtime, {
      consumedSurfaceKeys: under.map((t) => t.surfaceKey),
      paintedNodes: [],
      paintedLoops: [],
      footprintOutline: clockwise,
      painterSurfaceType: "platform",
    }, "repair", "t");

    const platform = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform");
    const at = new Map(platform.nodes.map((n) => [n.id, n.position]));
    const walked = platform.outerLoops[0].reduce((sum, e) => {
      const a = at.get(e.startNodeId);
      const b = at.get(e.endNodeId);
      return sum + Math.hypot(b.x - a.x, b.z - a.z);
    }, 0);
    assert.ok(platform.outerLoops[0].length > 4, "the repair did split the platform's edges");
    assert.ok(Math.abs(walked - 20) < 1e-3, `the platform's rim is still 20 long, not ${walked}`);
  } finally {
    console.info = info;
    console.warn = warn;
    session.free();
  }
});
