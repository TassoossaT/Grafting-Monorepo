import assert from "node:assert/strict";
import test from "node:test";

import { junctionsWithStandingSpines } from "../src/composition/tabletop/tools/paths/path-shared.ts";
import { pathCorridorId } from "../src/features/edit-construction/path-corridor.ts";
import { parseStationNodeId, stationNodeId } from "../src/features/edit-construction/station-node-id.ts";

const STANDING = pathCorridorId("op-a", "road");

/** One band of a run standing along +X, stations every 2 m. */
function band(acrossPair) {
  const nodes = [];
  for (const station of [0, 1, 2]) {
    for (const across of acrossPair) {
      nodes.push({
        id: stationNodeId(STANDING, station, across),
        position: { x: station * 2, y: 0, z: across * 2.1 },
      });
    }
  }
  const loop = [];
  for (const station of [0, 1]) {
    for (const across of acrossPair) {
      const from = stationNodeId(STANDING, station, across);
      const to = stationNodeId(STANDING, station + 1, across);
      loop.push({ edgeId: `along:${across}:${station}`, startNodeId: from, endNodeId: to, reversed: false });
    }
  }
  for (const station of [0, 1, 2]) {
    loop.push({
      edgeId: `across:${acrossPair.join("")}:${station}`,
      startNodeId: stationNodeId(STANDING, station, acrossPair[0]),
      endNodeId: stationNodeId(STANDING, station, acrossPair[1]),
      reversed: false,
    });
  }
  return {
    surfaceKey: [`band-${acrossPair.join("")}`],
    surfaceType: "path",
    nodes,
    outerLoops: [loop],
    holes: [],
  };
}

function contextWith(topologies) {
  return { runtime: { getAllRegionTopologies: () => topologies } };
}

test("a crossing splits the standing spine and both runs share the node it mints", () => {
  const ctx = contextWith([band([-1, 0]), band([0, 1])]);
  // A run drawn across the standing one at x = 3, between its stations 1 and 2.
  const drawn = [
    { x: 3, y: 0, z: -4 },
    { x: 3, y: 0, z: 4 },
  ];

  const result = junctionsWithStandingSpines(ctx, drawn);

  assert.equal(result.inserts.length, 1, "one node inserted into the crossed spine");
  const insert = result.inserts[0];
  assert.equal(insert.kind, "insert-vertex");
  assert.equal(insert.edgeId, "along:0:1", "the crossed spine edge, not a contour one");
  assert.deepEqual(insert.position, { x: 3, y: 0, z: 0 });
  assert.notEqual(insert.firstEdgeId, insert.secondEdgeId);

  // The node belongs to the crossed run's own spine, numbered between its
  // stations so it stays in that chain and in order.
  const address = parseStationNodeId(insert.nodeId);
  assert.equal(address.operationId, STANDING);
  assert.equal(address.across, 0);
  assert.equal(address.station, 1.5);

  // The run being drawn gains a station at exactly that point, welded to it.
  assert.equal(result.line.length, 3);
  assert.deepEqual(result.line[1], { x: 3, y: 0, z: 0 });
  assert.equal(result.welds.get(1), insert.nodeId);
});

test("a run that never crosses a spine changes nothing", () => {
  const ctx = contextWith([band([-1, 0]), band([0, 1])]);
  const drawn = [
    { x: 3, y: 0, z: 6 },
    { x: 3, y: 0, z: 9 },
  ];

  const result = junctionsWithStandingSpines(ctx, drawn);
  assert.equal(result.inserts.length, 0);
  assert.equal(result.welds.size, 0);
  assert.deepEqual(result.line, drawn);
});

test("crossing a run twice splits it once, because the second names an edge already gone", () => {
  const ctx = contextWith([band([-1, 0]), band([0, 1])]);
  // A hairpin crossing the same spine edge on the way out and back.
  const drawn = [
    { x: 3, y: 0, z: -2 },
    { x: 3, y: 0, z: 2 },
    { x: 3.2, y: 0, z: 2 },
    { x: 3.2, y: 0, z: -2 },
  ];

  const result = junctionsWithStandingSpines(ctx, drawn);
  assert.equal(result.inserts.length, 1, "one insert per crossed edge per commit");
});

test("an empty table leaves the drawn line untouched", () => {
  const result = junctionsWithStandingSpines(contextWith([]), [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]);
  assert.equal(result.inserts.length, 0);
  assert.equal(result.line.length, 2);
});
