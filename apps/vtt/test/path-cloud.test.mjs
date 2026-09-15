import assert from "node:assert/strict";
import test from "node:test";

import { pathRunsIn, pathRunFor } from "../src/features/edit-construction/structure-types/path/path-cloud.ts";
import { pathCorridorId } from "../src/features/edit-construction/structure-types/path/path-corridor.ts";
import { pathFormationFor, pathSpineSlot } from "../src/features/edit-construction/structure-types/path/path-recipe.ts";
import { stationNodeId } from "../src/features/edit-construction/structure-types/path/station-node-id.ts";

const ROAD = Object.freeze({
  shape: "circle",
  radius: 3,
  rotationDegrees: 0,
  pathKind: "road",
  bedWidth: 3,
  shoulderWidth: 0.6,
  shoulderHeight: 0.15,
  miterLimit: 4,
});

test("a run is flat and exactly three slots wide: contour, spine, contour", () => {
  const profile = pathFormationFor(ROAD).profile;
  assert.equal(profile.length, 3);
  assert.equal(pathSpineSlot(profile), 1);
  assert.deepEqual(
    profile.map((point) => point.lateralOffset),
    [-2.1, 0, 2.1],
  );
  assert.ok(profile.every((point) => point.elevation === 0), "no raised rim in this version");

  // A street is narrower but the same three parts.
  const street = pathFormationFor({ ...ROAD, pathKind: "street" }).profile;
  assert.deepEqual(
    street.map((point) => point.lateralOffset),
    [-1.5, 0, 1.5],
  );
});

/** One band of a run, as the region topology the graph would report. */
function band(corridor, acrossPair, stations) {
  const nodes = [];
  for (const station of stations) {
    for (const across of acrossPair) {
      nodes.push({
        id: stationNodeId(corridor, station, across),
        position: { x: station * 2, y: 0, z: across * 2.1 },
      });
    }
  }
  const loop = [];
  for (let index = 0; index + 1 < stations.length; index += 1) {
    for (const across of acrossPair) {
      const from = stationNodeId(corridor, stations[index], across);
      const to = stationNodeId(corridor, stations[index + 1], across);
      loop.push({ edgeId: `along:${from}~${to}`, startNodeId: from, endNodeId: to, reversed: false });
    }
  }
  for (const station of stations) {
    const from = stationNodeId(corridor, station, acrossPair[0]);
    const to = stationNodeId(corridor, station, acrossPair[1]);
    loop.push({ edgeId: `across:${from}~${to}`, startNodeId: from, endNodeId: to, reversed: false });
  }
  return {
    surfaceKey: [`band-${acrossPair.join("")}`],
    surfaceType: "path",
    nodes,
    outerLoops: [loop],
    holes: [],
  };
}

test("a cloud reads back the spine, both contours and every rib", () => {
  const corridor = pathCorridorId("table:path-brush:1", "road");
  const stations = [0, 1, 2];
  const topologies = [
    band(corridor, [-1, 0], stations),
    band(corridor, [0, 1], stations),
  ];

  const cloud = pathRunFor(topologies, corridor);
  assert.ok(cloud !== undefined);
  assert.equal(cloud.subtype, "road");

  assert.equal(cloud.spine.across, 0);
  assert.deepEqual(cloud.spine.nodes.map((node) => node.station), [0, 1, 2]);
  assert.equal(cloud.spine.edgeIds.length, 2, "the spine is a connected chain");

  assert.equal(cloud.contours.length, 2, "one contour per side");
  assert.deepEqual(cloud.contours.map((chain) => chain.across), [-1, 1]);
  for (const contour of cloud.contours) {
    assert.deepEqual(contour.nodes.map((node) => node.station), [0, 1, 2]);
    assert.equal(contour.edgeIds.length, 2, "a contour runs parallel to the spine");
  }

  assert.equal(cloud.ribs.length, 3, "one rib per station");
  for (const rib of cloud.ribs) {
    assert.deepEqual(rib.nodes.map((node) => node.across), [-1, 0, 1], "contour to contour");
    assert.equal(rib.edgeIds.length, 2, "the rib links spine to each contour");
    assert.ok(rib.bands.length > 0, "a rib bounds the faces it separates");
  }
  assert.equal(cloud.bands.length, 2);
  assert.deepEqual(cloud.junctionStations, []);
});

test("two runs are two clouds, and a welded station is reported as a junction", () => {
  const first = pathCorridorId("op-a", "road");
  const second = pathCorridorId("op-b", "road");
  const topologies = [
    band(first, [-1, 0], [0, 1, 2]),
    band(first, [0, 1], [0, 1, 2]),
    // The second run's station 0 has no spine node of its own: it welded onto
    // the first run's, which the cloud finds by what it connects to.
    {
      surfaceKey: ["welded-band"],
      surfaceType: "path",
      nodes: [
        { id: stationNodeId(second, 0, -1), position: { x: 2, y: 0, z: -2.1 } },
        { id: stationNodeId(second, 0, 1), position: { x: 2, y: 0, z: 2.1 } },
        { id: stationNodeId(first, 1, 0), position: { x: 2, y: 0, z: 0 } },
      ],
      outerLoops: [
        [
          {
            edgeId: "weld-left",
            startNodeId: stationNodeId(second, 0, -1),
            endNodeId: stationNodeId(first, 1, 0),
            reversed: false,
          },
          {
            edgeId: "weld-right",
            startNodeId: stationNodeId(first, 1, 0),
            endNodeId: stationNodeId(second, 0, 1),
            reversed: false,
          },
        ],
      ],
      holes: [],
    },
  ];

  const clouds = pathRunsIn(topologies);
  assert.equal(clouds.length, 2, "one cloud per run");
  const joined = clouds.find((cloud) => cloud.corridorId === second);
  assert.deepEqual(joined.junctionStations, [0], "the welded station is a junction");

  // The shared node belongs to the run that was crossed, but it is still on
  // this run's travel line -- adopted into the chain, so both runs report it
  // and the two are visibly joined at one point rather than reading as a gap.
  assert.ok(joined.spine !== undefined, "the joined run still has a spine");
  assert.equal(joined.spine.nodes.length, 1);
  assert.equal(joined.spine.nodes[0].nodeId, stationNodeId(first, 1, 0));
  assert.deepEqual(joined.spine.nodes[0].position, { x: 2, y: 0, z: 0 });

  // And the run it joined reports the very same node as its own.
  const crossed = clouds.find((cloud) => cloud.corridorId === first);
  assert.ok(
    crossed.spine.nodes.some((node) => node.nodeId === joined.spine.nodes[0].nodeId),
    "one node, referenced by both runs",
  );
});
