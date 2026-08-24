import assert from "node:assert/strict";
import test from "node:test";

import { pathPatch } from "../src/composition/tabletop/tools/paths/path-patch.ts";
import { pathCorridorId, pathSubtypeOf } from "../src/features/edit-construction/paths/path-corridor.ts";
import { pathCarvesGround, pathRidesTerrain } from "../src/features/edit-construction/paths/path-recipe.ts";
import { parseStationNodeId, stationNodeId } from "../src/features/edit-construction/paths/station-node-id.ts";
import { resolveCreationInteraction } from "../src/features/edit-construction/structure-types/index.ts";

test("a corridor id carries its subtype without disturbing station addressing", () => {
  const corridor = pathCorridorId("table-1:path-brush:3", "road");
  assert.equal(corridor, "table-1:path-brush:3#road");
  assert.equal(pathSubtypeOf(corridor), "road");

  // The marker is appended, so a node id built on it still parses whole.
  const node = stationNodeId(corridor, 4, -2);
  assert.deepEqual(parseStationNodeId(node), {
    operationId: corridor,
    station: 4,
    across: -2,
  });
  assert.equal(pathSubtypeOf(parseStationNodeId(node).operationId), "road");
  assert.equal(pathSubtypeOf("some-wall-node"), undefined);
});

test("a deck spans and consumes nothing; every other subtype rides and carves", () => {
  assert.equal(pathRidesTerrain("bridge"), false);
  assert.equal(pathCarvesGround("bridge"), false);
  for (const kind of ["road", "street", "trail"]) {
    assert.equal(pathRidesTerrain(kind), true, kind);
    assert.equal(pathCarvesGround(kind), true, kind);
  }
});

test("the interaction table reads the painted subtype, so an overpass declares itself", () => {
  // Same pair of types, opposite outcomes -- decided by the run that spans,
  // never inferred from a flat footprint that cannot see height at all.
  assert.equal(resolveCreationInteraction("path", "terrain", "road").kind, "cut");
  assert.equal(resolveCreationInteraction("path", "terrain", "bridge").kind, "ignore");
  assert.equal(resolveCreationInteraction("path", "path", "bridge").kind, "ignore");
  assert.equal(resolveCreationInteraction("path", "terrain").kind, "cut");
});

/** Two stations of a three-slot profile: rim, spine, rim. */
function twoStationPlan() {
  const vertices = [];
  for (const x of [0, 1]) {
    for (const z of [-1, 0, 1]) vertices.push({ x, y: 0, z });
  }
  return {
    referenceLine: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    vertices,
    quads: [[0, 3, 4, 1], [1, 4, 5, 2]],
    boundary: [0, 3, 4, 5, 2, 1],
  };
}

test("a welded station reuses the standing spine node instead of minting one", () => {
  const corridor = pathCorridorId("op-b", "road");
  const standing = stationNodeId(pathCorridorId("op-a", "road"), 7, 0);

  const formation = pathPatch(
    "table-1",
    corridor,
    "path",
    twoStationPlan(),
    3,
    1,
    new Map([["0:0", standing]]),
  );

  const ids = formation.patch.nodes.map((node) => node.id);
  // Station 0's spine is the other corridor's node -- the two runs are joined
  // because they reference it, not because they touch the same coordinate.
  assert.equal(ids[1], standing);
  // Everything else is this run's own, station 1's spine included.
  assert.equal(ids[0], stationNodeId(corridor, 0, -1));
  assert.equal(ids[2], stationNodeId(corridor, 0, 1));
  assert.equal(ids[4], stationNodeId(corridor, 1, 0));
  assert.equal(new Set(ids).size, 6, "no id is minted twice");
});

test("without a weld every node belongs to the run that drew it", () => {
  const corridor = pathCorridorId("op-b", "road");
  const formation = pathPatch("table-1", corridor, "path", twoStationPlan(), 3, 1);
  for (const node of formation.patch.nodes) {
    assert.equal(parseStationNodeId(node.id).operationId, corridor);
  }
});

test("a welded node still bounds the bands it belongs to, so the junction is one surface", () => {
  const corridor = pathCorridorId("op-b", "road");
  const standing = stationNodeId(pathCorridorId("op-a", "road"), 7, 0);
  const formation = pathPatch(
    "table-1",
    corridor,
    "path",
    twoStationPlan(),
    3,
    1,
    new Map([["0:0", standing]]),
  );

  const touching = formation.patch.edges.filter(
    (edge) => edge.startNodeId === standing || edge.endNodeId === standing,
  );
  assert.ok(touching.length >= 2, "the shared node carries this run's own edges too");
  const bands = formation.patch.regions.filter((region) =>
    region.boundary.some((use) => touching.some((edge) => edge.edgeId === use.edgeId)),
  );
  assert.equal(bands.length, 2, "both bands either side of the spine meet at it");
});
