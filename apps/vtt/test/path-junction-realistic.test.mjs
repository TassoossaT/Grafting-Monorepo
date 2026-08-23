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
