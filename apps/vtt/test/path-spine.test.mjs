import assert from "node:assert/strict";
import test from "node:test";

import { planEdit } from "../src/features/edit-construction/edit-orchestrator.ts";
import { pathFormationFor, pathSpineSlot } from "../src/features/edit-construction/path-recipe.ts";
import {
  followsOutward,
  parseStationNodeId,
  stationNodeId,
} from "../src/features/edit-construction/station-node-id.ts";
import { PATH_ROLES } from "../src/features/edit-construction/structure-types/path-structure.ts";

const ROAD = Object.freeze({
  shape: "circle",
  radius: 2.5,
  rotationDegrees: 0,
  pathKind: "road",
  bedWidth: 3,
  shoulderWidth: 0.6,
  shoulderHeight: 0.15,
  miterLimit: 4,
});

test("every path profile carries a spine, and it is the middle slot", () => {
  const road = pathFormationFor(ROAD).profile;
  assert.equal(road.length, 5);
  assert.equal(pathSpineSlot(road), 2);
  assert.equal(road[2].lateralOffset, 0);

  const street = pathFormationFor({ ...ROAD, pathKind: "street" }).profile;
  assert.equal(street.length, 3);
  assert.equal(pathSpineSlot(street), 1);
  assert.equal(street[1].lateralOffset, 0);
});

test("a station node id carries the corridor, the station and the signed slot", () => {
  const id = stationNodeId("table:path-brush:7", 3, -2);
  assert.equal(id, "table:path-brush:7:s3:a-2");
  assert.deepEqual(parseStationNodeId(id), {
    operationId: "table:path-brush:7",
    station: 3,
    across: -2,
  });
  assert.equal(parseStationNodeId("some-wall-node"), undefined);
});

test("outward is same corridor, same station, further out on the same side", () => {
  const spine = { operationId: "op", station: 4, across: 0 };
  const leftRib = { operationId: "op", station: 4, across: -1 };

  // The spine carries its whole cross-section, both sides.
  assert.ok(followsOutward(spine, { operationId: "op", station: 4, across: -2 }));
  assert.ok(followsOutward(spine, { operationId: "op", station: 4, across: 2 }));

  // A rib carries only what is beyond it, and never the other side.
  assert.ok(followsOutward(leftRib, { operationId: "op", station: 4, across: -2 }));
  assert.ok(!followsOutward(leftRib, { operationId: "op", station: 4, across: 1 }));
  assert.ok(!followsOutward(leftRib, { operationId: "op", station: 4, across: 0 }));

  // The rim carries nothing: nothing lies beyond it.
  const rim = { operationId: "op", station: 4, across: -2 };
  assert.ok(!followsOutward(rim, { operationId: "op", station: 4, across: -1 }));

  // Neither another station nor another corridor is ever carried.
  assert.ok(!followsOutward(spine, { operationId: "op", station: 5, across: 1 }));
  assert.ok(!followsOutward(spine, { operationId: "other", station: 4, across: 1 }));
});

/** One road band, as the region topology the edit tool would hand a policy. */
function band(name, acrossPair) {
  const nodes = [];
  for (const station of [0, 1]) {
    for (const across of acrossPair) {
      nodes.push({
        id: stationNodeId("op", station, across),
        position: { x: station * 2, y: 0, z: across },
      });
    }
  }
  return {
    surfaceKey: [name],
    surfaceType: "path",
    surfaceRef: name,
    nodes,
    outerLoops: [[]],
    holes: [],
  };
}

test("dragging the spine carries its whole cross-section, across every band it spans", () => {
  // A road of four bands: the spine is shared by the two middle ones, and
  // each rim belongs to one outer band alone.
  const left = band("left", [-2, -1]);
  const innerLeft = band("inner-left", [-1, 0]);
  const innerRight = band("inner-right", [0, 1]);
  const right = band("right", [1, 2]);

  const plan = planEdit(
    innerLeft,
    {
      surfaceKey: innerLeft.surfaceKey,
      target: { kind: "vertex", nodeId: stationNodeId("op", 0, 0) },
      delta: { x: 0, y: 0, z: 1 },
    },
    [left, innerRight, right],
  );

  assert.equal(plan.kind, "apply");
  assert.equal(plan.role, PATH_ROLES.spine);

  const moved = new Map(plan.ops.map((op) => [op.nodeId, op.position]));
  // Station 0 in full: the spine plus all four slots either side of it.
  for (const across of [-2, -1, 0, 1, 2]) {
    const id = stationNodeId("op", 0, across);
    assert.ok(moved.has(id), `${id} should follow the spine`);
    assert.equal(moved.get(id).z, across + 1, `${id} moves by the same delta`);
  }
  // Station 1 is untouched -- a cascade never reaches along the road.
  for (const across of [-2, -1, 0, 1, 2]) {
    assert.ok(!moved.has(stationNodeId("op", 1, across)), "another station must not follow");
  }
  assert.equal(plan.ops.length, 5);
});

test("dragging a rib carries the rim beyond it and leaves the spine alone", () => {
  const left = band("left", [-2, -1]);
  const innerLeft = band("inner-left", [-1, 0]);
  const innerRight = band("inner-right", [0, 1]);

  const plan = planEdit(
    left,
    {
      surfaceKey: left.surfaceKey,
      target: { kind: "vertex", nodeId: stationNodeId("op", 0, -1) },
      delta: { x: 0, y: 0, z: -1 },
    },
    [innerLeft, innerRight],
  );

  assert.equal(plan.kind, "apply");
  assert.equal(plan.role, PATH_ROLES.across);
  const moved = plan.ops.map((op) => op.nodeId);
  assert.deepEqual(moved, [stationNodeId("op", 0, -1), stationNodeId("op", 0, -2)]);
});

test("dragging the rim moves nothing but itself", () => {
  const left = band("left", [-2, -1]);
  const plan = planEdit(
    left,
    {
      surfaceKey: left.surfaceKey,
      target: { kind: "vertex", nodeId: stationNodeId("op", 0, -2) },
      delta: { x: 0, y: 0, z: -0.5 },
    },
    [],
  );

  assert.equal(plan.kind, "apply");
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0].nodeId, stationNodeId("op", 0, -2));
});

test("a spine station may be lifted, which is what a bridge deck is", () => {
  const innerLeft = band("inner-left", [-1, 0]);
  const innerRight = band("inner-right", [0, 1]);
  const plan = planEdit(
    innerLeft,
    {
      surfaceKey: innerLeft.surfaceKey,
      target: { kind: "vertex", nodeId: stationNodeId("op", 0, 0) },
      delta: { x: 0, y: 3, z: 0 },
    },
    [innerRight],
  );

  assert.equal(plan.kind, "apply");
  assert.ok(plan.ops.every((op) => op.position.y === 3), "the whole cross-section rises together");
});
