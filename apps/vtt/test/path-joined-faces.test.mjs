import assert from "node:assert/strict";
import test from "node:test";

import { joinedCoveredKeys } from "../src/composition/tabletop/tools/paths/path-shared.ts";
import { pathCorridorId } from "../src/features/edit-construction/structure-types/path/path-corridor.ts";
import { stationNodeId } from "../src/features/edit-construction/structure-types/path/station-node-id.ts";

const STANDING = pathCorridorId("table:path-brush:1", "road");
const OTHER = pathCorridorId("table:path-brush:9", "road");

/** One band of the standing run, as coverage reports a covered face. */
function coveredBand(corridor, station, slots) {
  return {
    surfaceKey: ["path", `${corridor}:path-band:${station}`],
    surfaceType: "path",
    nodeIds: [station, station + 1].flatMap((index) =>
      slots.map((across) => stationNodeId(corridor, index, across)),
    ),
  };
}

function contextWith(positions) {
  return {
    runtime: {
      getAllRegionTopologies: () => [
        {
          surfaceKey: ["path", "any"],
          surfaceType: "path",
          nodes: [...positions].map(([id, position]) => ({ id, position })),
          outerLoops: [],
          holes: [],
        },
      ],
    },
  };
}

/**
 * The footprint a road leaves once a junction has cut it back at the other
 * road's rim: it reaches the rim and no further, so it contains none of the
 * standing run's spine nodes.
 */
const CUT_BACK_OUTLINE = [
  [0.9, -6],
  [5.1, -6],
  [5.1, -2.1],
  [3, 0],
  [0.9, -2.1],
];

test("a face of a run this one joined is joined, however little of it is covered", () => {
  // Every spine node of the standing run sits outside the arriving footprint,
  // which is exactly what closing a junction at the rim produces. Read
  // geometrically this says "cut", and cutting here consumes the crossed
  // run's bands and its travel line with them.
  const positions = new Map([
    [stationNodeId(STANDING, 0, 0), { x: 0, y: 0, z: 0 }],
    [stationNodeId(STANDING, 1, 0), { x: 2, y: 0, z: 0 }],
  ]);
  const covered = [coveredBand(STANDING, 0, [-1, 0])];

  const geometric = joinedCoveredKeys(contextWith(positions), CUT_BACK_OUTLINE, covered, new Set());
  assert.equal(geometric.size, 0, "geometry alone no longer sees the join");

  const byIdentity = joinedCoveredKeys(
    contextWith(positions),
    CUT_BACK_OUTLINE,
    covered,
    new Set([STANDING]),
  );
  assert.equal(byIdentity.size, 1, "but the run was joined, so its faces are");
  assert.ok(byIdentity.has(covered[0].surfaceKey.join(":")));
});

test("a run that was not joined is still cut, junction or no junction", () => {
  const positions = new Map([[stationNodeId(OTHER, 0, 0), { x: 40, y: 0, z: 40 }]]);
  const covered = [coveredBand(OTHER, 0, [-1, 0])];

  const joined = joinedCoveredKeys(
    contextWith(positions),
    CUT_BACK_OUTLINE,
    covered,
    new Set([STANDING]),
  );
  assert.equal(joined.size, 0);
});

test("a footprint laid over a travel line still joins, with no junction made", () => {
  // The case identity cannot see: no weld happened, but the new road covers
  // the other one's centre line, so replacing it would erase a carriageway.
  const positions = new Map([[stationNodeId(OTHER, 0, 0), { x: 3, y: 0, z: -3 }]]);
  const covered = [coveredBand(OTHER, 0, [-1, 0])];

  const joined = joinedCoveredKeys(contextWith(positions), CUT_BACK_OUTLINE, covered, new Set());
  assert.equal(joined.size, 1);
});

test("terrain is never joined: it is what a road is cut out of", () => {
  const covered = [
    { surfaceKey: ["terrain", "cell"], surfaceType: "terrain", nodeIds: ["t0"] },
  ];
  const joined = joinedCoveredKeys(
    contextWith(new Map([["t0", { x: 3, y: 0, z: -3 }]])),
    CUT_BACK_OUTLINE,
    covered,
    new Set([STANDING]),
  );
  assert.equal(joined.size, 0);
});
