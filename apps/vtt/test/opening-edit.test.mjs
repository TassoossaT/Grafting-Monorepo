import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveOpeningParams,
  hostWallOf,
  openingOverlapsSibling,
  openingSpan,
  rimCorners,
  commitOpeningReplacement,
} from "../src/composition/tabletop/tools/openings/opening-shared.ts";

/** A straight rail along +X at z=0, the simplest case `panel-rail.ts` itself would resolve to. */
function straightRail(length, baseY = 0, topY = 3) {
  return {
    length,
    baseY,
    topY,
    travelTo(point) {
      return Math.min(Math.max(point.x, 0), length);
    },
    positionAt(travel, y) {
      return { x: travel, y, z: 0 };
    },
    geometryBetween() {
      return { kind: "line" };
    },
  };
}

const RAIL = straightRail(10);
const OPENING_PARAMS = { openingKind: "window", width: 1.2, height: 1.2, sill: 1 };

/** An opening's own topology, built the same way `opening-tool.ts` walks a rim into a face's boundary. */
function openingTopologyAt(id, rail, at, params) {
  const rim = rimCorners(rail, at, params);
  const nodes = rim.corners.map((position, index) => ({ id: `${id}:c${index}`, position }));
  const outerLoop = nodes.map((node, index) => ({
    edgeId: `${id}-${index}`,
    reversed: false,
    startNodeId: node.id,
    endNodeId: nodes[(index + 1) % nodes.length].id,
    geometry: { kind: "line" },
  }));
  return { surfaceKey: ["@region", id], surfaceType: "opening", physical: false, outerLoops: [outerLoop], holes: [], nodes };
}

/** A wall topology carrying one or more holes at known rim spans, each hole's nodes taken straight from an opening built the same way. */
function wallWithHoles(id, length, openings) {
  const holes = openings.map((opening) => opening.outerLoops[0].map((edge) => ({ ...edge, reversed: !edge.reversed, startNodeId: edge.endNodeId, endNodeId: edge.startNodeId })).reverse());
  const nodes = openings.flatMap((opening) => opening.nodes);
  return { surfaceKey: ["@region", id], surfaceType: "wall-white", physical: true, outerLoops: [[]], holes, nodes };
}

test("rimCorners and deriveOpeningParams round-trip: reading a rim back gives the params it was built from", () => {
  const opening = openingTopologyAt("op-1", RAIL, 4, OPENING_PARAMS);
  const derived = deriveOpeningParams(RAIL, opening);
  assert.ok(derived !== undefined);
  assert.ok(Math.abs(derived.width - OPENING_PARAMS.width) < 1e-6);
  assert.ok(Math.abs(derived.height - OPENING_PARAMS.height) < 1e-6);
  assert.ok(Math.abs(derived.sill - OPENING_PARAMS.sill) < 1e-6);
});

test("deriveOpeningParams reads a floor-sitting opening back as a door", () => {
  const door = openingTopologyAt("op-door", RAIL, 4, { openingKind: "door", width: 1, height: 2.1, sill: 0 });
  const derived = deriveOpeningParams(RAIL, door);
  assert.equal(derived.openingKind, "door");
});

test("openingSpan reads back the travel and height range a rim already occupies", () => {
  const opening = openingTopologyAt("op-2", RAIL, 5, OPENING_PARAMS);
  const span = openingSpan(RAIL, opening);
  assert.ok(Math.abs(span.to - span.from - OPENING_PARAMS.width) < 1e-6);
  assert.ok(Math.abs(span.top - span.bottom - OPENING_PARAMS.height) < 1e-6);
});

test("openingOverlapsSibling refuses a rim that would overlap another hole on the same wall", () => {
  const existing = openingTopologyAt("op-existing", RAIL, 4, OPENING_PARAMS); // travel ~3.4..4.6
  const wall = wallWithHoles("wall-1", 10, [existing]);
  // A rim centered right on top of the existing one, same height range.
  const overlapping = rimCorners(RAIL, 4.2, OPENING_PARAMS);
  assert.equal(openingOverlapsSibling(RAIL, wall, overlapping.from, overlapping.to, overlapping.bottom, overlapping.top), true);
});

test("openingOverlapsSibling allows two openings that do not share travel range", () => {
  const existing = openingTopologyAt("op-existing", RAIL, 4, OPENING_PARAMS); // travel ~3.4..4.6
  const wall = wallWithHoles("wall-1", 10, [existing]);
  const farAway = rimCorners(RAIL, 8, OPENING_PARAMS); // travel ~7.4..8.6
  assert.equal(openingOverlapsSibling(RAIL, wall, farAway.from, farAway.to, farAway.bottom, farAway.top), false);
});

test("openingOverlapsSibling excludes the opening's own hole -- moving/resizing in place is not a collision with itself", () => {
  const existing = openingTopologyAt("op-existing", RAIL, 4, OPENING_PARAMS);
  const wall = wallWithHoles("wall-1", 10, [existing]);
  const sameSpot = rimCorners(RAIL, 4, OPENING_PARAMS);
  assert.equal(openingOverlapsSibling(RAIL, wall, sameSpot.from, sameSpot.to, sameSpot.bottom, sameSpot.top, 0), false);
  assert.equal(openingOverlapsSibling(RAIL, wall, sameSpot.from, sameSpot.to, sameSpot.bottom, sameSpot.top), true, "without the exclusion, it does collide with itself");
});

test("hostWallOf finds the wall whose hole shares the opening's own rim edges", () => {
  const opening = openingTopologyAt("op-3", RAIL, 4, OPENING_PARAMS);
  const wall = wallWithHoles("wall-1", 10, [opening]);
  const ctx = { runtime: { getAllRegionTopologies: () => [wall, opening] } };
  const host = hostWallOf(ctx, opening);
  assert.ok(host !== undefined);
  assert.deepEqual(host.wall.surfaceKey, wall.surfaceKey);
  assert.equal(host.holeIndex, 0);
});

function fakeToolContext() {
  const calls = [];
  let sequence = 0;
  const runtime = {
    getSnapshot: () => ({ map: { nodePositions: new Map() } }),
    getAllRegionTopologies: () => [],
    getRegionTopologiesInBounds: () => [],
    transact(transactionId, origin, work) {
      const value = work();
      return { value, recorded: true };
    },
    applyRegionEdit(ops) {
      calls.push(["applyRegionEdit", ops]);
      return { affectedSurfaceKeys: [], createdSurfaceKeys: [], removedSurfaceKeys: [], createdNodeIds: [], removedNodeIds: [] };
    },
    removeHole(request) {
      calls.push(["removeHole", request]);
      return { affectedSurfaceKeys: [], createdSurfaceKeys: [], removedSurfaceKeys: [], createdNodeIds: [], removedNodeIds: [] };
    },
    addPatch(patch) {
      calls.push(["addPatch", patch]);
      return { skippedRegionIds: [], createdSurfaceKeys: [["@region", patch.regions[0].regionId]], removedNodeIds: [] };
    },
    addHole(request) {
      calls.push(["addHole", request]);
      return { affectedSurfaceKeys: [], createdSurfaceKeys: [], removedSurfaceKeys: [], createdNodeIds: [], removedNodeIds: [] };
    },
  };
  const ctx = {
    runtime,
    tableId: "table-1",
    nextSequence: () => (sequence += 1),
  };
  return { ctx, calls };
}

test("commitOpeningReplacement, deleting only: removes the face and closes the hole, in that order, with no place call", () => {
  const { ctx, calls } = fakeToolContext();
  const removal = { faceSurfaceKey: ["@region", "op-1"], wallSurfaceKey: ["@region", "wall-1"], holeIndex: 2 };
  const result = commitOpeningReplacement(ctx, "cause-1", removal, undefined);
  assert.equal(result.recorded, true);
  assert.equal(result.error, undefined);
  assert.deepEqual(calls.map((call) => call[0]), ["applyRegionEdit", "removeHole"]);
  assert.deepEqual(calls[0][1], [{ kind: "delete-region", surfaceKey: removal.faceSurfaceKey }]);
  assert.deepEqual(calls[1][1], { surfaceKey: removal.wallSurfaceKey, index: removal.holeIndex });
});

test("commitOpeningReplacement, placing only: creates a patch and opens the hole, with no removal call", () => {
  const { ctx, calls } = fakeToolContext();
  const rim = rimCorners(RAIL, 4, OPENING_PARAMS);
  const place = { wallSurfaceKey: ["@region", "wall-1"], rail: RAIL, from: rim.from, to: rim.to, bottom: rim.bottom, top: rim.top, openingKind: "window" };
  const result = commitOpeningReplacement(ctx, "cause-2", undefined, place);
  assert.equal(result.recorded, true);
  assert.equal(result.error, undefined);
  assert.deepEqual(calls.map((call) => call[0]), ["addPatch", "addHole"]);
  assert.equal(calls[1][1].surfaceKey, place.wallSurfaceKey);
});

test("commitOpeningReplacement, both: removes the old opening before placing the new one, one transaction", () => {
  const { ctx, calls } = fakeToolContext();
  const removal = { faceSurfaceKey: ["@region", "op-1"], wallSurfaceKey: ["@region", "wall-1"], holeIndex: 0 };
  const rim = rimCorners(RAIL, 7, OPENING_PARAMS);
  const place = { wallSurfaceKey: removal.wallSurfaceKey, rail: RAIL, from: rim.from, to: rim.to, bottom: rim.bottom, top: rim.top, openingKind: "window" };
  const result = commitOpeningReplacement(ctx, "cause-3", removal, place);
  assert.equal(result.recorded, true);
  assert.deepEqual(calls.map((call) => call[0]), ["applyRegionEdit", "removeHole", "addPatch", "addHole"]);
});
