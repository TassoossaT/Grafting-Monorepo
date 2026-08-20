import assert from "node:assert/strict";
import test from "node:test";

import {
  PANEL_ROLES,
  applyEditPlan,
  planEdit,
  resolvePolicy,
  structureTypeFor,
} from "../src/features/edit-construction/index.ts";
import { panelTopology } from "./wall-spans-fixture.mjs";

const WALL = panelTopology("wall-1", { from: { x: 0, z: 0 }, to: { x: 4, z: 0 } });
const TERRAIN = { ...panelTopology("terrain-1", { from: { x: 0, z: 0 }, to: { x: 4, z: 0 } }), surfaceType: "terrain" };

const BOTTOM_A = "wall-1:a-bottom";
const TOP_A = "wall-1:a-top";
const BOTTOM_EDGE = "wall-1-0";
const TOP_EDGE = "wall-1-2";

function gesture(target, delta) {
  return { surfaceKey: WALL.surfaceKey, target, delta };
}

function recordingSink() {
  const calls = [];
  const outcome = {
    affectedSurfaceKeys: [],
    createdSurfaceKeys: [],
    removedSurfaceKeys: [],
    createdNodeIds: [],
    removedNodeIds: [],
  };
  return {
    calls,
    sink: {
      moveVertex: (nodeId, position) => (calls.push(["moveVertex", nodeId, position]), outcome),
      moveEdge: (edgeId, delta) => (calls.push(["moveEdge", edgeId, delta]), outcome),
      moveRegion: (surfaceKey, delta) => (calls.push(["moveRegion", surfaceKey, delta]), outcome),
      insertVertex: (request) => (calls.push(["insertVertex", request]), outcome),
      removeVertex: (nodeId, weldedEdgeId) => (calls.push(["removeVertex", nodeId, weldedEdgeId]), outcome),
      retypeEdge: (edgeId, geometry) => (calls.push(["retypeEdge", edgeId, geometry]), outcome),
      deleteRegion: (surfaceKey) => (calls.push(["deleteRegion", surfaceKey]), outcome),
      duplicateRegion: (request) => (calls.push(["duplicateRegion", request]), outcome),
    },
  };
}

test("a panel's own roles come from its creation shape, not from anything the engine tags", () => {
  assert.equal(resolvePolicy(WALL, { kind: "vertex", nodeId: BOTTOM_A }).role, PANEL_ROLES.bottomCorner);
  assert.equal(resolvePolicy(WALL, { kind: "vertex", nodeId: TOP_A }).role, PANEL_ROLES.topCorner);
  assert.equal(resolvePolicy(WALL, { kind: "edge", edgeId: BOTTOM_EDGE }).role, PANEL_ROLES.bottomEdge);
  assert.equal(resolvePolicy(WALL, { kind: "edge", edgeId: TOP_EDGE }).role, PANEL_ROLES.topEdge);
  assert.equal(resolvePolicy(WALL, { kind: "edge", edgeId: "wall-1-1" }).role, PANEL_ROLES.post);
  assert.equal(resolvePolicy(WALL, { kind: "region" }).role, PANEL_ROLES.body);
});

test("a top corner is height-only -- horizontal movement is dropped before the engine is called", () => {
  const plan = planEdit(WALL, gesture({ kind: "vertex", nodeId: TOP_A }, { x: 5, y: 2, z: 7 }));
  assert.equal(plan.kind, "apply");
  assert.deepEqual(plan.ops, [
    { kind: "move-vertex", nodeId: TOP_A, position: { x: 0, y: 5, z: 0 } },
  ]);
});

test("a bottom corner is horizontal-only and cascades the same delta onto its paired top corner", () => {
  const plan = planEdit(WALL, gesture({ kind: "vertex", nodeId: BOTTOM_A }, { x: 1, y: 9, z: -2 }));
  assert.equal(plan.kind, "apply");
  assert.deepEqual(plan.ops, [
    { kind: "move-vertex", nodeId: BOTTOM_A, position: { x: 1, y: 0, z: -2 } },
    { kind: "move-vertex", nodeId: TOP_A, position: { x: 1, y: 3, z: -2 } },
  ]);
});

test("a top edge drags vertically as one rigid unit", () => {
  const plan = planEdit(WALL, gesture({ kind: "edge", edgeId: TOP_EDGE }, { x: 3, y: 1.5, z: 3 }));
  assert.equal(plan.kind, "apply");
  assert.deepEqual(plan.ops, [{ kind: "move-edge", edgeId: TOP_EDGE, delta: { x: 0, y: 1.5, z: 0 } }]);
});

test("an organic region escalates to regeneration instead of inventing an atomic sequence", () => {
  const definition = structureTypeFor("terrain");
  assert.ok(definition !== undefined);
  const policy = definition.policyFor("some-role-terrain-never-assigns");
  assert.equal(policy.resolve.kind, "regenerate");
});

test("an unknown surface type is denied rather than given a permissive default", () => {
  const alien = { ...WALL, surfaceType: "not-a-registered-type" };
  const plan = planEdit(alien, { surfaceKey: alien.surfaceKey, target: { kind: "region" }, delta: { x: 1, y: 0, z: 0 } });
  assert.equal(plan.kind, "deny");
  assert.match(plan.reason, /not-a-registered-type/);
});

test("a terrain patch still slides as a whole -- that needs no knowledge of what a vertex means", () => {
  const plan = planEdit(TERRAIN, {
    surfaceKey: TERRAIN.surfaceKey,
    target: { kind: "region" },
    delta: { x: 2, y: 8, z: 0 },
  });
  assert.equal(plan.kind, "apply");
  assert.deepEqual(plan.ops, [
    { kind: "move-region", surfaceKey: TERRAIN.surfaceKey, delta: { x: 2, y: 0, z: 0 } },
  ]);
});

test("applying a plan issues every op in order, primary before cascade", () => {
  const { calls, sink } = recordingSink();
  const plan = planEdit(WALL, gesture({ kind: "vertex", nodeId: BOTTOM_A }, { x: 1, y: 0, z: 0 }));

  applyEditPlan(sink, plan);

  assert.deepEqual(
    calls.map((call) => [call[0], call[1]]),
    [
      ["moveVertex", BOTTOM_A],
      ["moveVertex", TOP_A],
    ],
  );
});

test("a denied plan never reaches the engine", () => {
  const { calls, sink } = recordingSink();
  const alien = { ...WALL, surfaceType: "not-a-registered-type" };
  const plan = planEdit(alien, { surfaceKey: alien.surfaceKey, target: { kind: "region" }, delta: { x: 1, y: 0, z: 0 } });

  applyEditPlan(sink, plan);

  assert.equal(calls.length, 0);
});
