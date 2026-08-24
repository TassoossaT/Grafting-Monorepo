import assert from "node:assert/strict";
import test from "node:test";

import {
  spineSplitOps,
  throughCrossings,
  withStationsAt,
} from "../src/composition/tabletop/tools/paths/path-crossing.ts";
import { junctionWedges } from "../src/composition/tabletop/tools/paths/path-junction.ts";
import { pathPatch } from "../src/composition/tabletop/tools/paths/path-patch.ts";
import { pathMouthsInto } from "../src/composition/tabletop/tools/paths/path-shared.ts";
import { sweepFormation } from "../src/composition/tabletop/tools/core/sweep-formation.ts";
import { pathRunsIn } from "../src/features/edit-construction/paths/path-cloud.ts";
import { pathCorridorId } from "../src/features/edit-construction/paths/path-corridor.ts";
import { stationNodeId } from "../src/features/edit-construction/paths/station-node-id.ts";

const STANDING = pathCorridorId("table:path-brush:1", "road");
const CROSSING = pathCorridorId("table:path-brush:2", "road");
const TABLE = "table-1";
const HALF = 2;
/** Three slots: left rim, spine, right rim. */
const PROFILE = [
  { lateralOffset: -HALF, elevation: 0 },
  { lateralOffset: 0, elevation: 0 },
  { lateralOffset: HALF, elevation: 0 },
];

function line(points) {
  return points.map(([x, z]) => ({ x, y: 0, z }));
}

/** The patch as the graph would report it back: one topology per band. */
function topologiesFrom(formation) {
  const ends = new Map(formation.patch.edges.map((edge) => [edge.edgeId, edge]));
  const positions = new Map(formation.patch.nodes.map((node) => [node.id, node.position]));
  return formation.patch.regions.map((region) => {
    const loop = region.boundary.map((use) => {
      const edge = ends.get(use.edgeId);
      return {
        edgeId: use.edgeId,
        reversed: use.reversed,
        startNodeId: edge.startNodeId,
        endNodeId: edge.endNodeId,
        geometry: edge.geometry ?? { kind: "line" },
      };
    });
    const ids = new Set(loop.flatMap((edge) => [edge.startNodeId, edge.endNodeId]));
    return {
      surfaceKey: ["@region", region.regionId],
      surfaceType: "path",
      physical: true,
      outerLoops: [loop],
      holes: [],
      nodes: [...ids].map((id) => ({ id, position: positions.get(id) })),
    };
  });
}

/**
 * A road running west to east through x = 0..12 at z = 0, already standing,
 * with its spine cut wherever the crossing road's rims reach it.
 */
function standingRun(cuts = []) {
  const plan = sweepFormation(line([[0, 0], [4, 0], [8, 0], [12, 0]]), PROFILE, 4);
  let topologies = topologiesFrom(pathPatch(TABLE, STANDING, "path", plan, 3, 1));
  for (const cut of cuts) {
    const from = stationNodeId(STANDING, Math.floor(cut.station), 0);
    const to = stationNodeId(STANDING, Math.ceil(cut.station), 0);
    const edgeId = `${TABLE}:seg:${[from, to].sort().join("~")}`;
    topologies = topologies.map((topology) => {
      if (!topology.outerLoops[0].some((use) => use.edgeId === edgeId)) return topology;
      return {
        ...topology,
        nodes: [...topology.nodes, { id: cut.nodeId, position: cut.position }],
        outerLoops: [
          topology.outerLoops[0].flatMap((use) => {
            if (use.edgeId !== edgeId) return [use];
            const [start, end] = use.reversed ? [to, from] : [from, to];
            return [
              { ...use, edgeId: `${edgeId}|${cut.station}a`, startNodeId: start, endNodeId: cut.nodeId },
              { ...use, edgeId: `${edgeId}|${cut.station}b`, startNodeId: cut.nodeId, endNodeId: end },
            ];
          }),
        ],
      };
    });
  }
  const runs = pathRunsIn(topologies);
  assert.equal(runs.length, 1);
  return runs[0];
}

/** The road drawn south to north straight across it, at x = 6. */
const CROSSING_LINE = line([[6, -8], [6, 8]]);

test("a road running clean through another reports where its rims meet it", () => {
  const run = standingRun();
  const first = sweepFormation(CROSSING_LINE, PROFILE, 4);

  const crossings = throughCrossings(first, 3, 1, [run]);

  // Four corners where rim meets rim, and two more where each rim cuts the
  // standing travel line.
  assert.equal(crossings.stations.length, 6);
  assert.equal(crossings.meetings.length, 2);
  assert.deepEqual(
    [...new Set(crossings.meetings.map((meeting) => meeting.across))].sort(),
    [-1, 1],
    "one meeting per rim of the crossing road",
  );
  for (const meeting of crossings.meetings) {
    assert.ok(Math.abs(meeting.position.z) < 1e-9, "on the standing travel line");
    assert.equal(Math.abs(meeting.position.x - 6), HALF, "a road half-width either side");
  }
});

test("a road that merely arrives is left to fuse, not prepared as a crossing", () => {
  const run = standingRun();
  // Stops on the standing spine instead of running through it.
  const arriving = sweepFormation(line([[6, -8], [6, 0]]), PROFILE, 4);

  assert.deepEqual(throughCrossings(arriving, 3, 1, [run]).stations, []);
});

test("splicing a station in keeps every station's origin, and curves stay on the circle", () => {
  const straight = line([[0, 0], [4, 0], [8, 0]]);
  const spliced = withStationsAt(straight, [undefined, undefined], [0.5, 1.25]);

  assert.equal(spliced.line.length, 5);
  assert.deepEqual(spliced.origins, [0, -1, 1, -1, 2]);
  assert.deepEqual(spliced.indexOf, [1, 3]);
  assert.equal(spliced.line[1].x, 2);
  assert.equal(spliced.line[3].x, 5);

  // A station minted on a curved span lands on the curve, not on the chord.
  const quarter = line([[4, 0], [0, 4]]);
  const arc = { center: [0, 0], clockwise: false };
  const curved = withStationsAt(quarter, [arc], [0.5]);
  const minted = curved.line[1];
  assert.ok(Math.abs(Math.hypot(minted.x, minted.z) - 4) < 1e-9, "on the circle");
});

test("several cuts of one spine edge are chained, never all named after the original", () => {
  const ops = spineSplitOps(TABLE, [
    { nodeId: "n-far", position: { x: 3, y: 0, z: 0 }, edgeId: "e", along: 0.75, startNodeId: "a", endNodeId: "b" },
    { nodeId: "n-near", position: { x: 1, y: 0, z: 0 }, edgeId: "e", along: 0.25, startNodeId: "a", endNodeId: "b" },
  ]);

  assert.equal(ops.length, 2);
  assert.equal(ops[0].nodeId, "n-near", "the nearest cut goes first");
  assert.equal(ops[0].edgeId, "e");
  // The second cut is a cut of the half the first one left behind.
  assert.equal(ops[1].edgeId, ops[0].secondEdgeId);
  assert.equal(ops[1].nodeId, "n-far");
});

test("a prepared crossing opens both flanks of the road it runs through", () => {
  const run = standingRun();
  const first = sweepFormation(CROSSING_LINE, PROFILE, 4);
  const crossings = throughCrossings(first, 3, 1, [run]);
  const prepared = withStationsAt(CROSSING_LINE, [undefined], crossings.stations);

  // The spine of the standing road really is cut where each rim reached it,
  // and the crossing road's own rim node there is that very node.
  // Here each rim reaches the standing spine exactly at a station it already
  // has, so nothing is cut and both runs simply share the node standing there.
  assert.deepEqual(crossings.meetings.map((meeting) => meeting.split), [undefined, undefined]);
  const cut = [];
  const stationAt = new Map(
    crossings.stations.map((value, index) => [value, prepared.indexOf[index]]),
  );
  const welds = new Map(
    crossings.meetings.map((meeting) => [
      `${stationAt.get(meeting.at)}:${meeting.across}`,
      meeting.nodeId,
    ]),
  );

  const plan = sweepFormation(prepared.line, PROFILE, 4);
  const { mouths } = pathMouthsInto(plan, 3, 1, [standingRun(cut)], welds);

  assert.equal(mouths.length, 2, "one mouth per flank of the road being crossed");
  for (const mouth of mouths) {
    assert.equal(mouth.sides.length, 2, "two corners");
    // A crossing closes each bend on its own rim's meeting with the spine,
    // so the two pivots are different nodes -- the T's are the same one.
    assert.notEqual(mouth.sides[0].pivotNodeId, mouth.sides[1].pivotNodeId);
    for (const side of mouth.sides) {
      assert.equal(Math.abs(side.position.z), HALF, "the corner is on the standing rim");
    }
  }

  for (const mouth of mouths) {
    const wedges = junctionWedges(TABLE, "op-2", CROSSING, [mouth]);
    assert.ok(wedges !== undefined, `flank ${mouth.through} rebuilt`);
    assert.equal(wedges.patch.regions.length, 2, "a piece either side of the crossing");
    assert.ok(wedges.removed.length > 0);
  }
});
