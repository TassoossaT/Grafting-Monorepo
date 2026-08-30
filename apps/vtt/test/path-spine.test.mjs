import assert from "node:assert/strict";
import test from "node:test";

import { planEdit } from "../src/features/edit-construction/orchestration/edit-orchestrator.ts";
import { createPathBrushEffect } from "../src/features/edit-construction/modes/surface-edit-contract.ts";
import { cloudOf } from "./cloud-fixture.mjs";
import { pathFormationFor, pathSpineSlot } from "../src/features/edit-construction/structure-types/path/path-recipe.ts";
import { pathSpineDraftFor } from "../src/features/edit-construction/structure-types/path/path-spine-draft.ts";
import {
  followsOutward,
  parseStationNodeId,
  stationNodeId,
} from "../src/features/edit-construction/structure-types/path/station-node-id.ts";
import { PATH_ROLES, pathRoleFor } from "../src/features/edit-construction/structure-types/path/path-structure.ts";
import { planPathCloudMutation } from "../src/features/edit-construction/structure-types/path/path-cloud-mutation.ts";

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
  // This version is contour, spine, contour -- three slots, flat.
  const road = pathFormationFor(ROAD).profile;
  assert.equal(road.length, 3);
  assert.equal(pathSpineSlot(road), 1);
  assert.equal(road[1].lateralOffset, 0);

  const street = pathFormationFor({ ...ROAD, pathKind: "street" }).profile;
  assert.equal(street.length, 3);
  assert.equal(pathSpineSlot(street), 1);
  assert.equal(street[1].lateralOffset, 0);
});

test("the path type owns the semantic spine derived from a brush effect", () => {
  const effect = createPathBrushEffect(
    {
      brushShape: { kind: "circle", radius: ROAD.radius },
      brushRegion: { samples: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }] },
      parameters: pathFormationFor(ROAD),
    },
    { operationId: "table:path-brush:7", tableId: "table", initiatedBy: "path-brush" },
  );

  const draft = pathSpineDraftFor(effect, effect.brushRegion.samples);
  assert.deepEqual(draft, {
    corridorId: "table:path-brush:7#road",
    controlPoints: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }],
    bandOffsets: [-2.1, 0, 2.1],
    miterLimit: 4,
  });
  assert.equal(pathSpineDraftFor(effect, [{ x: 0, y: 0, z: 0 }]), undefined);
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

  const plan = planEdit(cloudOf(innerLeft, left, innerRight, right), {
    surfaceKey: innerLeft.surfaceKey,
    target: { kind: "vertex", nodeId: stationNodeId("op", 0, 0) },
    delta: { x: 0, y: 0, z: 1 },
  });

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

  const plan = planEdit(cloudOf(left, innerLeft, innerRight), {
    surfaceKey: left.surfaceKey,
    target: { kind: "vertex", nodeId: stationNodeId("op", 0, -1) },
    delta: { x: 0, y: 0, z: -1 },
  });

  assert.equal(plan.kind, "apply");
  assert.equal(plan.role, PATH_ROLES.across);
  const moved = plan.ops.map((op) => op.nodeId);
  assert.deepEqual(moved, [stationNodeId("op", 0, -1), stationNodeId("op", 0, -2)]);
});

test("dragging the rim moves nothing but itself", () => {
  const left = band("left", [-2, -1]);
  const plan = planEdit(cloudOf(left), {
    surfaceKey: left.surfaceKey,
    target: { kind: "vertex", nodeId: stationNodeId("op", 0, -2) },
    delta: { x: 0, y: 0, z: -0.5 },
  });

  assert.equal(plan.kind, "apply");
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0].nodeId, stationNodeId("op", 0, -2));
});

test("a spine station may be lifted, which is what a bridge deck is", () => {
  const innerLeft = band("inner-left", [-1, 0]);
  const innerRight = band("inner-right", [0, 1]);
  const plan = planEdit(cloudOf(innerLeft, innerRight), {
    surfaceKey: innerLeft.surfaceKey,
    target: { kind: "vertex", nodeId: stationNodeId("op", 0, 0) },
    delta: { x: 0, y: 3, z: 0 },
  });

  assert.equal(plan.kind, "apply");
  assert.ok(plan.ops.every((op) => op.position.y === 3), "the whole cross-section rises together");
});

test("pathRoleFor recognizes spine control nodes and contour nodes", () => {
  const dummyTopology = {
    surfaceKey: ["@region", "test"],
    surfaceType: "path",
    nodes: [],
    outerLoops: [],
    holes: [],
  };

  assert.equal(pathRoleFor(dummyTopology, { kind: "vertex", nodeId: "spine:op1#road:0" }), PATH_ROLES.spine);
  assert.equal(pathRoleFor(dummyTopology, { kind: "vertex", nodeId: "contour:op1:band-0:0:1" }), PATH_ROLES.across);
  assert.equal(pathRoleFor(dummyTopology, { kind: "vertex", nodeId: "op1:s2:a0" }), PATH_ROLES.spine);
  assert.equal(pathRoleFor(dummyTopology, { kind: "vertex", nodeId: "op1:s2:a-1" }), PATH_ROLES.across);
  assert.equal(pathRoleFor(dummyTopology, { kind: "region" }), PATH_ROLES.body);
});

test("planEdit moves a spine control node when graphSnapshot is provided", () => {
  const dummyTopology = {
    surfaceKey: ["@region", "op1#road:band-0:0"],
    surfaceType: "path",
    nodes: [
      { id: "contour:op1#road:band-0:0:1", position: { x: 0, y: 0, z: -2.1 } },
      { id: "contour:op1#road:band-0:0:2", position: { x: 10, y: 0, z: -2.1 } },
      { id: "contour:op1#road:band-0:0:3", position: { x: 10, y: 0, z: 2.1 } },
      { id: "contour:op1#road:band-0:0:4", position: { x: 0, y: 0, z: 2.1 } },
    ],
    outerLoops: [],
    holes: [],
  };

  const graphSnapshot = {
    nodes: [
      { id: "spine:op1#road:0", position: { x: 0, y: 0, z: 0 } },
      { id: "spine:op1#road:1", position: { x: 10, y: 0, z: 0 } },
    ],
    edges: [
      { edgeId: "spine-edge:op1#road:0", startNodeId: "spine:op1#road:0", endNodeId: "spine:op1#road:1" },
    ],
  };

  const plan = planEdit(cloudOf(dummyTopology), {
    surfaceKey: dummyTopology.surfaceKey,
    target: { kind: "vertex", nodeId: "spine:op1#road:0" },
    delta: { x: 2, y: 1, z: -3 },
  }, graphSnapshot);

  assert.equal(plan.kind, "apply");
  assert.equal(plan.role, PATH_ROLES.spine);
  assert.equal(plan.ops.length, 1);
  assert.deepEqual(plan.ops[0], {
    kind: "move-vertex",
    nodeId: "spine:op1#road:0",
    position: { x: 2, y: 1, z: -3 },
  });
});

test("planPathCloudMutation does not consume standing regions of unrelated path clouds with similar ID prefixes", () => {
  const unrelatedTopology = {
    surfaceKey: ["@region", "op-10#road:band-0:0"],
    surfaceType: "path",
    nodes: [
      { id: "contour:op-10#road:band-0:0:1", position: { x: 50, y: 0, z: 50 } },
      { id: "contour:op-10#road:band-0:0:2", position: { x: 60, y: 0, z: 50 } },
      { id: "contour:op-10#road:band-0:0:3", position: { x: 60, y: 0, z: 55 } },
      { id: "contour:op-10#road:band-0:0:4", position: { x: 50, y: 0, z: 55 } },
    ],
    outerLoops: [],
    holes: [],
  };

  const graphSnapshot = {
    nodes: [
      { id: "spine:op-10#road:0", position: { x: 50, y: 0, z: 52.5 } },
      { id: "spine:op-10#road:1", position: { x: 60, y: 0, z: 52.5 } },
    ],
    edges: [
      { edgeId: "spine-edge:op-10#road:0", startNodeId: "spine:op-10#road:0", endNodeId: "spine:op-10#road:1" },
    ],
  };

  const effect = createPathBrushEffect(
    {
      brushShape: { kind: "circle", radius: 2.5 },
      brushRegion: {
        samples: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
      observedElements: [],
      parameters: pathFormationFor(ROAD),
    },
    { operationId: "op-1", tableId: "table-1", initiatedBy: "path-brush" },
  );

  const plan = planPathCloudMutation({
    tableId: "table-1",
    snapToGrid: false,
    graphSnapshot,
    regionTopologies: [unrelatedTopology],
    coverageFor: () => [],
    effect,
    tolerance: 0.05,
  });

  assert.equal(plan.kind, "ready");
  assert.deepEqual(
    plan.request.sourceSurfaceKeys,
    [],
    "unrelated road op-10 must NOT be consumed or deleted when drawing op-1",
  );
});

function straightRoadEffect() {
  return createPathBrushEffect(
    {
      brushShape: { kind: "circle", radius: 2.5 },
      brushRegion: {
        samples: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
      observedElements: [],
      parameters: pathFormationFor(ROAD),
    },
    { operationId: "op-1", tableId: "table-1", initiatedBy: "path-brush" },
  );
}

test("a terrain face the road covers whole is consumed, and the request carries the road's own footprint", () => {
  const terrainFace = {
    surfaceKey: ["@region", "terrain:0:0"],
    surfaceType: "terrain",
    physical: true,
    coverage: "centroid",
    centroid: { x: 5, y: 0, z: 0 },
    nodeIds: ["terrain-node-a", "terrain-node-b"],
  };

  const plan = planPathCloudMutation({
    tableId: "table-1",
    snapToGrid: false,
    graphSnapshot: { nodes: [], edges: [] },
    regionTopologies: [],
    coverageFor: () => [terrainFace],
    effect: straightRoadEffect(),
    tolerance: 0.05,
  });

  assert.equal(plan.kind, "ready");
  assert.deepEqual(plan.request.sourceSurfaceKeys, [terrainFace.surfaceKey], "the whole terrain face is consumed");
  // planPathCloudMutation itself decides nothing about repairing what it
  // consumed -- that dispatch lives entirely in
  // TabletopRuntime.applyPatchReplacement, generic across every caller of
  // that method. This only checks the fact the request needs to carry for
  // that dispatch to be possible at all.
  assert.ok(plan.request.footprintOutline.length >= 3, "the road's own footprint rides along on the request");
});

test("a terrain face the road only clips is left standing, not consumed", () => {
  const clippedFace = {
    surfaceKey: ["@region", "terrain:1:0"],
    surfaceType: "terrain",
    physical: true,
    coverage: "overlap",
    centroid: { x: 5, y: 0, z: 4 },
    nodeIds: ["terrain-node-c", "terrain-node-d"],
  };

  const plan = planPathCloudMutation({
    tableId: "table-1",
    snapToGrid: false,
    graphSnapshot: { nodes: [], edges: [] },
    regionTopologies: [],
    coverageFor: () => [clippedFace],
    effect: straightRoadEffect(),
    tolerance: 0.05,
  });

  assert.equal(plan.kind, "ready");
  assert.deepEqual(plan.request.sourceSurfaceKeys, [], "a merely-clipped face is never consumed");
});

test("a wall the road crosses is left standing: panels have no repair for a cut yet", () => {
  const wallFace = {
    surfaceKey: ["@region", "wall-white:0:0"],
    surfaceType: "wall-white",
    physical: true,
    coverage: "centroid",
    centroid: { x: 5, y: 0, z: 0 },
    nodeIds: ["wall-node-a", "wall-node-b"],
  };

  const plan = planPathCloudMutation({
    tableId: "table-1",
    snapToGrid: false,
    graphSnapshot: { nodes: [], edges: [] },
    regionTopologies: [],
    coverageFor: () => [wallFace],
    effect: straightRoadEffect(),
    tolerance: 0.05,
  });

  assert.equal(plan.kind, "ready");
  assert.deepEqual(plan.request.sourceSurfaceKeys, [], "a wall is never consumed -- resolveCutRepair says unsupported");
});
