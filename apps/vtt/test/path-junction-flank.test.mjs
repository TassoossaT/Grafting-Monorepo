import assert from "node:assert/strict";
import test from "node:test";

import {
  junctionWedges,
  patchRestoring,
} from "../src/composition/tabletop/tools/paths/path-junction.ts";
import { pathPatch } from "../src/composition/tabletop/tools/paths/path-patch.ts";
import { pathMouthsInto } from "../src/composition/tabletop/tools/paths/path-shared.ts";
import { pathRunsIn } from "../src/features/edit-construction/paths/path-cloud.ts";
import { pathCorridorId } from "../src/features/edit-construction/paths/path-corridor.ts";
import { stationNodeId } from "../src/features/edit-construction/paths/station-node-id.ts";

const STANDING = pathCorridorId("table:path-brush:1", "road");
const ARRIVING = pathCorridorId("table:path-brush:2", "road");
const HALF_WIDTH = 2.1;
const TABLE = "table-1";

/** A three-slot sweep plan along +X, stations two metres apart. */
function planAlongX(stationCount) {
  const vertices = [];
  for (let station = 0; station < stationCount; station += 1) {
    for (const across of [-HALF_WIDTH, 0, HALF_WIDTH]) {
      vertices.push({ x: station * 2, y: 0, z: across });
    }
  }
  const quads = [];
  for (let station = 0; station + 1 < stationCount; station += 1) {
    for (const slot of [0, 1]) {
      const current = station * 3 + slot;
      const next = (station + 1) * 3 + slot;
      quads.push([current, next, next + 1, current + 1]);
    }
  }
  const boundary = [];
  for (let station = 0; station < stationCount; station += 1) boundary.push(station * 3);
  boundary.push((stationCount - 1) * 3 + 1, (stationCount - 1) * 3 + 2);
  for (let station = stationCount - 2; station >= 0; station -= 1) boundary.push(station * 3 + 2);
  boundary.push(1);
  return { referenceLine: [], vertices, quads, boundary };
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

/** One junction node on the standing spine, as its split would leave it. */
function junctionAt(station) {
  return {
    nodeId: stationNodeId(STANDING, station, 0),
    station,
    position: { x: station * 2, y: 0, z: 0 },
  };
}

/**
 * The spine splits a pair of junctions perform, applied to the topologies.
 *
 * The road is *already joined* by the time its flank is rebuilt, and the code
 * reads the junction nodes off the chain rather than working out where they
 * ought to be -- so a fixture that skips the split describes a table that
 * never exists at the moment the code under test runs.
 */
function withSpineSplits(topologies, junctions) {
  let split = topologies;
  for (const junction of junctions) {
    const from = stationNodeId(STANDING, Math.floor(junction.station), 0);
    const to = stationNodeId(STANDING, Math.ceil(junction.station), 0);
    const edgeId = `${TABLE}:seg:${[from, to].sort().join("~")}`;
    split = split.map((topology) => {
      if (!topology.outerLoops[0].some((use) => use.edgeId === edgeId)) return topology;
      return {
        ...topology,
        nodes: [...topology.nodes, { id: junction.nodeId, position: junction.position }],
        outerLoops: [
          topology.outerLoops[0].flatMap((use) => {
            if (use.edgeId !== edgeId) return [use];
            const [start, end] = use.reversed ? [to, from] : [from, to];
            return [
              { ...use, edgeId: `${edgeId}|a`, startNodeId: start, endNodeId: junction.nodeId },
              { ...use, edgeId: `${edgeId}|b`, startNodeId: junction.nodeId, endNodeId: end },
            ];
          }),
        ],
      };
    });
  }
  return split;
}

/** The standing run: along +X from x = 0 to x = 6, rims at z = +-2.1. */
function standingRun(junctions) {
  const runs = pathRunsIn(
    withSpineSplits(topologiesFrom(pathPatch(TABLE, STANDING, "path", planAlongX(4), 3, 1)), junctions),
  );
  assert.equal(runs.length, 1);
  return runs[0];
}

/** The weld an arrival leaves: its last station is a node of the standing spine. */
function weldAt(station, junction) {
  return new Map([[`${station}:0`, junction.nodeId]]);
}

/** A narrow run arriving from -Z at `x`, its last station on the standing spine. */
function arrivingPlan(stationZ, x, half) {
  const vertices = [];
  for (const z of stationZ) {
    for (const across of [-1, 0, 1]) vertices.push({ x: x - across * half, y: 0, z });
  }
  return { referenceLine: [], vertices, quads: [], boundary: [] };
}

test("two mouths into one flank are rebuilt together, as three pieces", () => {
  const west = junctionAt(0.5);
  const east = junctionAt(2.5);
  const run = standingRun([west, east]);

  // One stroke opening into the same rim twice: two arrivals, two stations.
  const [first] = pathMouthsInto(arrivingPlan([-6, -3, 0], 1, 0.5), 3, 1, [run], weldAt(2, west)).mouths;
  const [second] = pathMouthsInto(arrivingPlan([-9, -6, -3, 0], 5, 0.5), 3, 1, [run], weldAt(3, east)).mouths;
  assert.ok(first !== undefined && second !== undefined);
  assert.equal(first.through, -1);
  assert.equal(second.through, -1);

  const wedges = junctionWedges(TABLE, "op-2", ARRIVING, [first, second]);

  assert.ok(wedges !== undefined, "one rebuild covers both mouths");
  // Two mouths cut the flank into three pieces: before the first, between
  // them, and after the second.
  assert.equal(wedges.patch.regions.length, 3);
  assert.deepEqual(
    wedges.patch.regions.map((region) => region.regionId),
    ["op-2:junction-0", "op-2:junction-1", "op-2:junction-2"],
  );

  // Every near-side band over the stretch goes, and only those.
  assert.ok(wedges.removed.length > 0);
  const removed = new Set(wedges.removed.map((key) => key.join(":")));
  for (const band of run.bands) {
    if (!removed.has(band.surfaceKey.join(":"))) continue;
    assert.ok(band.slots.includes(-1), "a near-side band");
    assert.ok(!band.slots.includes(1), "never a far-side one");
  }

  // Both mouths are open: neither pair of corners is joined by a piece.
  const walks = wedges.patch.regions.map((region) => new Set(
    region.boundary.flatMap((use) => {
      const edge = wedges.patch.edges.find((candidate) => candidate.edgeId === use.edgeId);
      return [edge.startNodeId, edge.endNodeId];
    }),
  ));
  for (const mouth of [first, second]) {
    const corners = mouth.sides.map((side) => stationNodeId(ARRIVING, side.station, side.across));
    for (const walk of walks) {
      assert.ok(
        !(walk.has(corners[0]) && walk.has(corners[1])),
        "no piece spans a mouth from one corner to the other",
      );
    }
  }
});

test("mouths that overlap on the rim close nothing at all", () => {
  const west = junctionAt(0.9);
  const east = junctionAt(2.1);
  const run = standingRun([west, east]);

  // Two wide arrivals whose openings run into each other on the rim.
  const [first] = pathMouthsInto(arrivingPlan([-6, -3, 0], 1.8, 1.5), 3, 1, [run], weldAt(2, west)).mouths;
  const [second] = pathMouthsInto(arrivingPlan([-9, -6, -3, 0], 4.2, 1.5), 3, 1, [run], weldAt(3, east)).mouths;
  assert.ok(first !== undefined && second !== undefined);

  assert.equal(
    junctionWedges(TABLE, "op-2", ARRIVING, [first, second]),
    undefined,
    "no flank left between them to lay a piece over",
  );
});

test("the flank about to be removed can be put back exactly as it stood", () => {
  const run = standingRun([junctionAt(1.5)]);
  const topologies = withSpineSplits(
    topologiesFrom(pathPatch(TABLE, STANDING, "path", planAlongX(4), 3, 1)),
    [junctionAt(1.5)],
  );

  const restore = patchRestoring(topologies);

  // Every face comes back under the id it stands as, which is the last part
  // of its surface key.
  assert.deepEqual(
    restore.regions.map((region) => region.regionId),
    topologies.map((topology) => topology.surfaceKey[topology.surfaceKey.length - 1]),
  );
  // Every edge of every loop is declared, once, in the edge's own direction.
  const declared = new Set(restore.edges.map((edge) => edge.edgeId));
  for (const topology of topologies) {
    for (const use of topology.outerLoops[0]) {
      assert.ok(declared.has(use.edgeId), `edge ${use.edgeId} declared`);
    }
  }
  assert.equal(declared.size, restore.edges.length, "no edge declared twice");
  // And every node those edges walk has a position to come back to.
  const positioned = new Set(restore.nodes.map((node) => node.id));
  for (const edge of restore.edges) {
    assert.ok(positioned.has(edge.startNodeId), `node ${edge.startNodeId} placed`);
    assert.ok(positioned.has(edge.endNodeId), `node ${edge.endNodeId} placed`);
  }
  assert.ok(run.bands.length > 0);
});
