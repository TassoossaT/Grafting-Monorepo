import assert from "node:assert/strict";
import test from "node:test";

import { pathPatch } from "../src/composition/tabletop/tools/paths/path-patch.ts";
import { junctionsWithStandingSpines } from "../src/composition/tabletop/tools/paths/path-shared.ts";
import { pathRunsIn } from "../src/features/edit-construction/path-cloud.ts";
import { pathCorridorId } from "../src/features/edit-construction/path-corridor.ts";

const CORRIDOR = pathCorridorId("table:path-brush:1", "road");

/** A three-slot sweep plan along +X, stations two metres apart. */
function planAlongX(stationCount) {
  const vertices = [];
  for (let station = 0; station < stationCount; station += 1) {
    for (const across of [-2.1, 0, 2.1]) {
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
      surfaceKey: ["path", region.regionId],
      surfaceType: "path",
      physical: true,
      outerLoops: [loop],
      holes: [],
      nodes: [...ids].map((id) => ({ id, position: positions.get(id) })),
    };
  });
}

test("a run committed the way the tool commits it reads back with a whole spine", () => {
  const formation = pathPatch("table-1", CORRIDOR, "path", planAlongX(4), 3, 1);
  const runs = pathRunsIn(topologiesFrom(formation));

  assert.equal(runs.length, 1);
  const spine = runs[0].spine;
  assert.ok(spine !== undefined, "the run has a spine at all");
  assert.equal(spine.nodes.length, 4, "one spine node per station");
  assert.equal(
    spine.edgeIds.length,
    spine.nodes.length - 1,
    "and an edge between every consecutive pair -- a chain with a hole in it " +
      "silently misaligns edgeIds against nodes, which is what a crossing indexes by",
  );
});

test("a stroke drawn across that run finds the crossing and splits its spine", () => {
  const formation = pathPatch("table-1", CORRIDOR, "path", planAlongX(4), 3, 1);
  const ctx = { runtime: { getAllRegionTopologies: () => topologiesFrom(formation) } };

  // Straight across the standing run at x = 3, between its stations 1 and 2.
  const result = junctionsWithStandingSpines(ctx, [
    { x: 3, y: 0, z: -5 },
    { x: 3, y: 0, z: 5 },
  ]);

  assert.equal(result.inserts.length, 1, "the crossing is found");
  assert.equal(result.inserts[0].position.x, 3);
  assert.equal(result.inserts[0].position.z, 0, "and it sits on the travel line");
  assert.equal(result.welds.size, 1, "the new run welds a station to it");
});

test("a stroke that ends on a standing run joins it, without ever crossing it", () => {
  const formation = pathPatch("table-1", CORRIDOR, "path", planAlongX(4), 3, 1);
  const ctx = { runtime: { getAllRegionTopologies: () => topologiesFrom(formation) } };

  // Arrives from the side and stops on the road, a metre short of its spine.
  // No segment intersection exists here at all: the stroke simply ends.
  const result = junctionsWithStandingSpines(ctx, [
    { x: 3, y: 0, z: -5 },
    { x: 3, y: 0, z: -1 },
  ]);

  assert.equal(result.inserts.length, 1, "the arrival is found and the spine split");
  assert.equal(result.inserts[0].position.z, 0, "the node lands on the travel line");
  assert.equal(result.inserts[0].position.x, 3);

  // The drawn end moved onto the spine rather than a station being added
  // beside it: still two stations, and the last one is the junction.
  assert.equal(result.line.length, 2);
  assert.deepEqual(result.line[1], { x: 3, y: 0, z: 0 });
  assert.equal(result.welds.get(1), result.inserts[0].nodeId);
});

test("a stroke that stops well clear of every run joins nothing", () => {
  const formation = pathPatch("table-1", CORRIDOR, "path", planAlongX(4), 3, 1);
  const ctx = { runtime: { getAllRegionTopologies: () => topologiesFrom(formation) } };

  const result = junctionsWithStandingSpines(ctx, [
    { x: 3, y: 0, z: -9 },
    { x: 3, y: 0, z: -5 },
  ]);

  assert.equal(result.inserts.length, 0, "arriving near is not arriving on");
  assert.equal(result.welds.size, 0);
  assert.equal(result.line.length, 2);
});

test("a stroke starting on one run and ending on another joins both", () => {
  const first = pathPatch("table-1", CORRIDOR, "path", planAlongX(4), 3, 1);
  const other = pathCorridorId("table:path-brush:2", "road");
  const shifted = planAlongX(4);
  const second = pathPatch(
    "table-1",
    other,
    "path",
    { ...shifted, vertices: shifted.vertices.map((v) => ({ ...v, z: v.z + 12 })) },
    3,
    1,
  );
  const ctx = {
    runtime: {
      getAllRegionTopologies: () => [...topologiesFrom(first), ...topologiesFrom(second)],
    },
  };

  const result = junctionsWithStandingSpines(ctx, [
    { x: 3, y: 0, z: 0 },
    { x: 3, y: 0, z: 12 },
  ]);

  assert.equal(result.inserts.length, 2, "one split per run joined");
  assert.equal(result.welds.size, 2);
  assert.deepEqual(result.line[0], { x: 3, y: 0, z: 0 });
  assert.deepEqual(result.line[result.line.length - 1], { x: 3, y: 0, z: 12 });
});

test("two roads join when their surfaces touch, not when one reaches the other's spine", () => {
  const formation = pathPatch("table-1", CORRIDOR, "path", planAlongX(4), 3, 1);
  const ctx = { runtime: { getAllRegionTopologies: () => topologiesFrom(formation) } };

  // The standing run reaches 2.1 from its spine. A stroke stopping at z = -4
  // is well outside it -- nobody draws up to another road's centre line.
  const stopsShort = [
    { x: 3, y: 0, z: -9 },
    { x: 3, y: 0, z: -4 },
  ];

  // Reaching only the spine: no join, which is the snap that felt too weak.
  assert.equal(junctionsWithStandingSpines(ctx, stopsShort).inserts.length, 0);

  // Counting the drawn road's own half width, the two surfaces overlap there,
  // and they join.
  const joined = junctionsWithStandingSpines(ctx, stopsShort, 2.1);
  assert.equal(joined.inserts.length, 1);
  assert.deepEqual(joined.line[joined.line.length - 1], { x: 3, y: 0, z: 0 });
});
