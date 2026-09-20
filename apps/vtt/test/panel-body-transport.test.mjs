import assert from "node:assert/strict";
import test from "node:test";

import { PANEL_ROLES, panelPolicyFor } from "../src/features/edit-construction/index.ts";
import { panelMotionInfluences } from "../src/features/edit-construction/structure-types/panel/panel-structure.ts";

/** A wall with one rectangular opening standing in it -- a hole loop sharing none of the wall's own baseline/top corners. */
const WALL_WITH_HOLE = {
  surfaceKey: ["@region", "wall-1"],
  surfaceType: "wall-white",
  physical: true,
  outerLoops: [[
    { edgeId: "e0", reversed: false, startNodeId: "a-bottom", endNodeId: "b-bottom", geometry: { kind: "line" } },
    { edgeId: "e1", reversed: false, startNodeId: "b-bottom", endNodeId: "b-top", geometry: { kind: "line" } },
    { edgeId: "e2", reversed: false, startNodeId: "b-top", endNodeId: "a-top", geometry: { kind: "line" } },
    { edgeId: "e3", reversed: false, startNodeId: "a-top", endNodeId: "a-bottom", geometry: { kind: "line" } },
  ]],
  holes: [[
    { edgeId: "h-e0", reversed: false, startNodeId: "h0", endNodeId: "h1", geometry: { kind: "line" } },
    { edgeId: "h-e1", reversed: false, startNodeId: "h1", endNodeId: "h2", geometry: { kind: "line" } },
    { edgeId: "h-e2", reversed: false, startNodeId: "h2", endNodeId: "h3", geometry: { kind: "line" } },
    { edgeId: "h-e3", reversed: false, startNodeId: "h3", endNodeId: "h0", geometry: { kind: "line" } },
  ]],
  nodes: [
    { id: "a-bottom", position: { x: 0, y: 0, z: 0 } },
    { id: "b-bottom", position: { x: 4, y: 0, z: 0 } },
    { id: "b-top", position: { x: 4, y: 3, z: 0 } },
    { id: "a-top", position: { x: 0, y: 3, z: 0 } },
    { id: "h0", position: { x: 1, y: 1, z: 0 } },
    { id: "h1", position: { x: 2, y: 1, z: 0 } },
    { id: "h2", position: { x: 2, y: 2, z: 0 } },
    { id: "h3", position: { x: 1, y: 2, z: 0 } },
  ],
};

test("the body role transports its holes -- moving the whole wall must carry any opening along with it", () => {
  const policy = panelPolicyFor(PANEL_ROLES.body);
  assert.equal(policy.transport, true);
});

test("panelMotionInfluences only carries a hole's rim horizontally when transport is requested", () => {
  const withoutTransport = panelMotionInfluences(WALL_WITH_HOLE, false);
  const withTransport = panelMotionInfluences(WALL_WITH_HOLE, true);
  const holeLink = (links) => links.find((link) => link.to === "h0");

  assert.deepEqual(holeLink(withoutTransport).axes, [false, true, false], "without transport, only height is carried -- the bug the user reported: a door/window left standing where the wall used to be");
  assert.deepEqual(holeLink(withTransport).axes, [true, true, true], "with transport (the body role's own policy), the opening rides along horizontally too");
});
