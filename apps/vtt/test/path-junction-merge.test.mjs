import assert from "node:assert/strict";
import test from "node:test";

import { junctionsWithStandingSpines } from "../src/composition/tabletop/tools/paths/path-shared.ts";
import { pathCorridorId } from "../src/features/edit-construction/path-corridor.ts";
import { stationNodeId } from "../src/features/edit-construction/station-node-id.ts";

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
      loop.push({
        edgeId: `along:${across}:${station}`,
        startNodeId: stationNodeId(STANDING, station, across),
        endNodeId: stationNodeId(STANDING, station + 1, across),
        reversed: false,
      });
    }
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

test("a crossing landing beside a station moves that station rather than adding one", () => {
  const ctx = contextWith([band([-1, 0]), band([0, 1])]);
  // Stations at x = 0, 0.4, 4. The crossing falls at x = 0.5, a tenth of a
  // metre from the middle one -- keeping both would declare a band of almost
  // no length, which is the sliver that ran along the contour.
  const drawn = [
    { x: 0.5, y: 0, z: -4 },
    { x: 0.5, y: 0, z: -0.1 },
    { x: 0.5, y: 0, z: 4 },
  ];

  const result = junctionsWithStandingSpines(ctx, drawn);
  assert.equal(result.inserts.length, 1);

  // Three stations in, three out: the crossing took the near one over.
  assert.equal(result.line.length, 3);
  const welded = [...result.welds.keys()];
  assert.equal(welded.length, 1);
  assert.deepEqual(result.line[welded[0]], { x: 0.5, y: 0, z: 0 });

  // And no two consecutive stations sit on top of each other.
  for (let index = 0; index + 1 < result.line.length; index += 1) {
    const gap = Math.hypot(
      result.line[index + 1].x - result.line[index].x,
      result.line[index + 1].z - result.line[index].z,
    );
    assert.ok(gap > 0.5, `stations ${index} and ${index + 1} are ${gap} apart`);
  }
});

test("a crossing well clear of every station is spliced in as a new one", () => {
  const ctx = contextWith([band([-1, 0]), band([0, 1])]);
  const drawn = [
    { x: 3, y: 0, z: -4 },
    { x: 3, y: 0, z: 4 },
  ];

  const result = junctionsWithStandingSpines(ctx, drawn);
  assert.equal(result.inserts.length, 1);
  assert.equal(result.line.length, 3, "the crossing is a station of its own");
  assert.deepEqual(result.line[1], { x: 3, y: 0, z: 0 });
  assert.equal(result.welds.get(1), result.inserts[0].nodeId);
});

test("the node minted for a crossing belongs to the crossed run's spine", () => {
  const ctx = contextWith([band([-1, 0]), band([0, 1])]);
  const result = junctionsWithStandingSpines(ctx, [
    { x: 3, y: 0, z: -4 },
    { x: 3, y: 0, z: 4 },
  ]);

  const insert = result.inserts[0];
  assert.equal(insert.edgeId, "along:0:1", "the spine edge, not a contour one");
  assert.equal(insert.position.z, 0, "and it sits on the travel line");
  // Both runs now reference one node, which is the whole of being joined.
  assert.equal(result.welds.get(1), insert.nodeId);
});

test("every committed station says which drawn one it came from", () => {
  const ctx = contextWith([band([-1, 0]), band([0, 1])]);
  const drawn = [
    { x: 3, y: 0, z: -4 },
    { x: 3, y: 0, z: 4 },
  ];

  const result = junctionsWithStandingSpines(ctx, drawn);
  assert.equal(result.origins.length, result.line.length);
  // Two drawn stations either side of one minted at the crossing.
  assert.deepEqual(result.origins, [0, -1, 1]);
});

test("a stroke that joined nothing reports itself, station for station", () => {
  const ctx = contextWith([band([-1, 0]), band([0, 1])]);
  const drawn = [
    { x: 30, y: 0, z: -4 },
    { x: 30, y: 0, z: 0 },
    { x: 30, y: 0, z: 4 },
  ];

  // The reason this is reported rather than compared: nothing here promises
  // to hand back the same array, and every step rebuilds one whether or not
  // it changed anything. Read by identity, a run that was never touched
  // looks spliced -- which silently threw away every curve the fit found.
  const result = junctionsWithStandingSpines(ctx, drawn);
  assert.deepEqual(result.origins, [0, 1, 2]);
  assert.equal(result.line.length, drawn.length);
});
