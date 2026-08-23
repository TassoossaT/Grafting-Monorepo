import assert from "node:assert/strict";
import test from "node:test";

import {
  PATH_EDGE_CHANNELS,
  PATH_EDGE_COLORS,
  pathEdgeOverlayIn,
  pathEdgeOverlayOf,
} from "../src/composition/tabletop/tools/paths/path-edge-overlay.ts";
import { pathCorridorId } from "../src/features/edit-construction/path-corridor.ts";
import { pathRunsIn } from "../src/features/edit-construction/path-cloud.ts";
import { stationNodeId } from "../src/features/edit-construction/station-node-id.ts";

const CORRIDOR = pathCorridorId("op-a", "road");

/** One band of a run along +X, stations every 2 m, three slots wide. */
function band(acrossPair, stations) {
  const nodes = [];
  for (const station of stations) {
    for (const across of acrossPair) {
      nodes.push({
        id: stationNodeId(CORRIDOR, station, across),
        position: { x: station * 2, y: 0, z: across * 2.1 },
      });
    }
  }
  const loop = [];
  for (let index = 0; index + 1 < stations.length; index += 1) {
    for (const across of acrossPair) {
      loop.push({
        edgeId: `along:${across}:${stations[index]}`,
        startNodeId: stationNodeId(CORRIDOR, stations[index], across),
        endNodeId: stationNodeId(CORRIDOR, stations[index + 1], across),
        reversed: false,
      });
    }
  }
  for (const station of stations) {
    loop.push({
      edgeId: `across:${acrossPair.join("")}:${station}`,
      startNodeId: stationNodeId(CORRIDOR, station, acrossPair[0]),
      endNodeId: stationNodeId(CORRIDOR, station, acrossPair[1]),
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

test("each part of a run is drawn separately, so the three can be told apart", () => {
  const stations = [0, 1, 2];
  const overlay = pathEdgeOverlayIn([band([-1, 0], stations), band([0, 1], stations)]);

  // Six floats a segment. The spine runs the length of the run: two segments
  // for three stations.
  assert.equal(overlay.spine.length, 2 * 6);
  // Two contours, two segments each.
  assert.equal(overlay.contour.length, 4 * 6);
  // One rib per station, contour to spine to contour: two segments each.
  assert.equal(overlay.rib.length, 6 * 6);

  // The spine really is the middle: every one of its points sits at z = 0.
  for (let index = 2; index < overlay.spine.length; index += 3) {
    assert.equal(overlay.spine[index], 0);
  }
  // Neither contour does.
  for (let index = 2; index < overlay.contour.length; index += 3) {
    assert.notEqual(overlay.contour[index], 0);
  }
});

test("a break in a chain shows as a missing segment rather than being papered over", () => {
  // Station 1 is absent from the spine -- what a crossing does to it today.
  const topologies = [band([-1, 0], [0, 2]), band([0, 1], [0, 2])];
  const overlay = pathEdgeOverlayIn(topologies);
  // Two stations left, so one spine segment, drawn straight across the gap.
  assert.equal(overlay.spine.length, 1 * 6);
});

test("nothing standing draws nothing at all", () => {
  const overlay = pathEdgeOverlayOf([]);
  assert.equal(overlay.spine.length, 0);
  assert.equal(overlay.contour.length, 0);
  assert.equal(overlay.rib.length, 0);
});

test("the three parts have their own colours and their own channels", () => {
  const values = Object.values(PATH_EDGE_COLORS);
  assert.equal(new Set(values).size, values.length, "no two parts share a colour");
  const channels = Object.values(PATH_EDGE_CHANNELS);
  assert.equal(new Set(channels).size, channels.length, "no two parts share a channel");
  assert.ok(
    channels.every((channel) => channel !== "active"),
    "and none of them is the tool ghost's own channel",
  );
});

test("the overlay reads the same runs the rest of the system does", () => {
  const stations = [0, 1];
  const topologies = [band([-1, 0], stations), band([0, 1], stations)];
  assert.deepEqual(pathEdgeOverlayOf(pathRunsIn(topologies)), pathEdgeOverlayIn(topologies));
});
