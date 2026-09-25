import assert from "node:assert/strict";
import test from "node:test";

import {
  PANEL_ROLES,
  panelPolicyFor,
  panelRoleFor,
  planEdit,
} from "../src/features/edit-construction/index.ts";
import { cloudOf } from "./cloud-fixture.mjs";
import { panelTopology } from "./wall-spans-fixture.mjs";

const WALL = panelTopology("wall-1", { from: { x: 0, z: 0 }, to: { x: 4, z: 0 } });
const LEVEL_GRAY = panelTopology("wall-2", { from: { x: 20, z: 0 }, to: { x: 24, z: 0 } }, undefined, "wall-gray");
/** Its two top corners deliberately differ -- a ramped run, not a level one. */
const TALLER = panelTopology("wall-3", { from: { x: 40, z: 0 }, to: { x: 44, z: 0 } });
TALLER.nodes = TALLER.nodes.map((node) => (node.id === "wall-3:b-top" ? { ...node, position: { ...node.position, y: 5 } } : node));

const LONE_WALL = cloudOf(WALL);
const TOP_EDGE = "wall-1-2";

function gesture(target, delta) {
  return { surfaceKey: WALL.surfaceKey, target, delta };
}

test("the height widget's two zones resolve to their own roles, only on a genuine top run", () => {
  assert.equal(panelRoleFor(WALL, { kind: "edge-zone", edgeId: TOP_EDGE, zone: "group" }), PANEL_ROLES.topSegmentGroup);
  assert.equal(panelRoleFor(WALL, { kind: "edge-zone", edgeId: TOP_EDGE, zone: "single" }), PANEL_ROLES.topSegmentSingle);
  assert.equal(panelRoleFor(WALL, { kind: "edge-zone", edgeId: "wall-1-0", zone: "group" }), PANEL_ROLES.unknown, "bottom run carries no widget");
  assert.equal(panelRoleFor(WALL, { kind: "edge-zone", edgeId: "wall-1-1", zone: "group" }), PANEL_ROLES.unknown, "a post carries no widget");
});

test("the widget's single zone reaches exactly what grabbing the top edge itself reaches", () => {
  const direct = planEdit(LONE_WALL, gesture({ kind: "edge", edgeId: TOP_EDGE }, { x: 3, y: 1.5, z: 3 }));
  const single = planEdit(LONE_WALL, gesture({ kind: "edge-zone", edgeId: TOP_EDGE, zone: "single" }, { x: 3, y: 1.5, z: 3 }));
  assert.equal(single.kind, "apply");
  assert.deepEqual(single.ops, direct.ops);
});

test("the widget's group zone alone, with no other topology in view, still moves only the grabbed run", () => {
  const plan = planEdit(LONE_WALL, gesture({ kind: "edge-zone", edgeId: TOP_EDGE, zone: "group" }, { x: 0, y: 1.5, z: 0 }));
  assert.equal(plan.kind, "apply");
  assert.deepEqual(plan.ops, [{ kind: "move-edge", edgeId: TOP_EDGE, delta: { x: 0, y: 1.5, z: 0 } }]);
});

test("the group cascade raises every other level top run at the grabbed height, across clouds and across partition types", () => {
  const groupCascade = panelPolicyFor(PANEL_ROLES.topSegmentGroup).groupCascade;
  const ops = groupCascade({
    cloud: LONE_WALL,
    topology: WALL,
    target: { kind: "edge-zone", edgeId: TOP_EDGE, zone: "group" },
    delta: { x: 0, y: 1.5, z: 0 },
    allTopologies: [WALL, LEVEL_GRAY, TALLER],
  });
  const moved = new Set(ops.map((op) => op.nodeId));
  assert.deepEqual(moved, new Set(["wall-2:a-top", "wall-2:b-top"]), "only the level wall-gray run matches, by trait rather than by name");
  for (const op of ops) {
    assert.equal(op.kind, "move-vertex");
    assert.equal(op.position.y, 3 + 1.5, "the delta is applied on top of the matched node's own current height");
  }
});

test("the group cascade never re-emits the grabbed edge's own nodes", () => {
  const groupCascade = panelPolicyFor(PANEL_ROLES.topSegmentGroup).groupCascade;
  const ops = groupCascade({
    cloud: LONE_WALL,
    topology: WALL,
    target: { kind: "edge-zone", edgeId: TOP_EDGE, zone: "group" },
    delta: { x: 0, y: 1.5, z: 0 },
    allTopologies: [WALL],
  });
  assert.deepEqual(ops, []);
});

test("a ramped run -- its own two top corners at different heights -- names no height to match against", () => {
  const groupCascade = panelPolicyFor(PANEL_ROLES.topSegmentGroup).groupCascade;
  const ops = groupCascade({
    cloud: LONE_WALL,
    topology: WALL,
    target: { kind: "edge-zone", edgeId: TOP_EDGE, zone: "group" },
    delta: { x: 0, y: 1, z: 0 },
    allTopologies: [WALL, TALLER],
  });
  assert.deepEqual(ops, [], "wall-3's top run is a ramp (its two corners differ), so it has no single height to compare");
});
