import assert from "node:assert/strict";
import test from "node:test";

import { planEdit, resolveCloudTopology } from "../src/features/edit-construction/index.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";

/** A single straight wall panel with a rectangular opening pinned to it, built directly against the real WASM session. */
function wallWithOpening(runtime) {
  const wallNodes = [
    { id: "w:a-bottom", position: { x: 0, y: 0, z: 0 } },
    { id: "w:b-bottom", position: { x: 4, y: 0, z: 0 } },
    { id: "w:b-top", position: { x: 4, y: 3, z: 0 } },
    { id: "w:a-top", position: { x: 0, y: 3, z: 0 } },
  ];
  const openingNodes = [
    { id: "h:0", position: { x: 1, y: 1, z: 0 } },
    { id: "h:1", position: { x: 2, y: 1, z: 0 } },
    { id: "h:2", position: { x: 2, y: 2, z: 0 } },
    { id: "h:3", position: { x: 1, y: 2, z: 0 } },
  ];
  const edges = (nodes, prefix) => nodes.map((n, i) => ({ edgeId: `${prefix}:${i}`, startNodeId: n.id, endNodeId: nodes[(i + 1) % nodes.length].id }));
  const uses = (es) => es.map((e) => ({ edgeId: e.edgeId, reversed: false }));
  const wallEdges = edges(wallNodes, "wall");
  const openingEdges = edges(openingNodes, "opening");
  runtime.addPatch({
    nodes: [...wallNodes, ...openingNodes],
    edges: [...wallEdges, ...openingEdges],
    regions: [
      { regionId: "wall", boundary: uses(wallEdges), surfaceType: "wall-white", physical: true },
      { regionId: "opening-face", boundary: uses(openingEdges), surfaceType: "opening", physical: false },
    ],
  });
  const wall = runtime.getAllRegionTopologies().find((t) => t.nodes.some((n) => n.id === "w:a-bottom"));
  runtime.pinNodes(openingNodes.map((n) => ({ nodeId: n.id, hostSurfaceKey: wall.surfaceKey, u: n.position.x / 4, v: n.position.y / 3 })));
  return wall;
}

test("real WASM: dragging the wall's bottom edge sideways carries the opening pinned to it", () => {
  const { runtime, session } = sessionFixture();
  try {
    const wall = wallWithOpening(runtime);
    const bottomEdgeId = wall.outerLoops[0].find((e) => e.startNodeId === "w:a-bottom" && e.endNodeId === "w:b-bottom").edgeId;
    const cloud = resolveCloudTopology(runtime, wall.surfaceKey);
    const plan = planEdit(cloud, { surfaceKey: wall.surfaceKey, target: { kind: "edge", edgeId: bottomEdgeId }, delta: { x: 2, y: 0, z: 0 } }, runtime.getGraphSnapshot(), runtime);
    assert.equal(plan.kind, "apply", plan.reason);
    const outcome = runtime.applyRegionEdit(plan.ops);
    const after = new Map(runtime.getGraphSnapshot().nodes.map((n) => [n.id, n.position]));
    assert.equal(after.get("h:0").x, 3, "the opening's pinned nodes ride along with their host");
    assert.equal(after.get("h:2").x, 4);

    // The opening shares no node with the wall: only the engine carrying its
    // pins can report it, or its face stays rendered where it used to be.
    const opening = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "opening");
    const affected = new Set(outcome.affectedSurfaceKeys.map((key) => key.join(" ")));
    assert.ok(affected.has(wall.surfaceKey.join(" ")), "wall must be reported affected");
    assert.ok(affected.has(opening.surfaceKey.join(" ")), "the opening's own face must be reported affected too");
  } finally { session.free(); }
});

test("real WASM: stretching one bottom corner keeps the opening at the same relative place on the deformed wall", () => {
  const { runtime, session } = sessionFixture();
  try {
    const wall = wallWithOpening(runtime);
    const cloud = resolveCloudTopology(runtime, wall.surfaceKey);
    // Drag "w:a-bottom" alone (the other bottom corner stays put): the panel
    // stops being a rectangle, so there is no single delta the opening could
    // simply be translated by.
    const plan = planEdit(cloud, { surfaceKey: wall.surfaceKey, target: { kind: "vertex", nodeId: "w:a-bottom" }, delta: { x: -1, y: 0, z: 0 } }, runtime.getGraphSnapshot(), runtime);
    assert.equal(plan.kind, "apply", plan.reason);
    runtime.applyRegionEdit(plan.ops);
    const after = new Map(runtime.getGraphSnapshot().nodes.map((n) => [n.id, n.position]));
    assert.equal(after.get("w:a-bottom").x, -1);
    assert.equal(after.get("w:a-top").x, -1, "the paired top corner still follows through the wall's own unconditional upright link");
    assert.equal(after.get("w:b-bottom").x, 4, "the untouched corner stays put -- this is a deformation, not a translation");

    // Pins are relative: u = 0.25 and 0.5 of the new 5-long base, from x=-1.
    const near = (actual, expected) => Math.abs(actual - expected) < 1e-9;
    assert.ok(near(after.get("h:0").x, 0.25), `h:0 at u=0.25, got ${after.get("h:0").x}`);
    assert.ok(near(after.get("h:1").x, 1.5));
    assert.ok(near(after.get("h:2").x, 1.5));
    assert.ok(near(after.get("h:3").x, 0.25));
    assert.ok(near(after.get("h:0").y, 1), "the wall kept its height, so v keeps the node's height");
  } finally { session.free(); }
});
