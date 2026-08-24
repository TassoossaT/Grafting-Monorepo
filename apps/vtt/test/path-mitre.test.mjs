import assert from "node:assert/strict";
import test from "node:test";

import { pathPatch } from "../src/composition/tabletop/tools/paths/path-patch.ts";
import {
  junctionsWithStandingSpines,
  mitreTerminalRibs,
} from "../src/composition/tabletop/tools/paths/path-shared.ts";
import { pathRunsIn } from "../src/features/edit-construction/structure-types/path/path-cloud.ts";
import { pathCorridorId } from "../src/features/edit-construction/structure-types/path/path-corridor.ts";
import { parseStationNodeId } from "../src/features/edit-construction/structure-types/path/station-node-id.ts";

const STANDING = pathCorridorId("table:path-brush:1", "road");
const HALF_WIDTH = 2.1;

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

/** The standing run: along +X from x = 0 to x = 6, ending at (6, 0). */
function standingRun() {
  const runs = pathRunsIn(
    topologiesFrom(pathPatch("table-1", STANDING, "path", planAlongX(4), 3, 1)),
  );
  return runs[0];
}

function contextWithStanding() {
  const formation = pathPatch("table-1", STANDING, "path", planAlongX(4), 3, 1);
  return { runtime: { getAllRegionTopologies: () => topologiesFrom(formation) } };
}

/** The join the arrival reports when a stroke starts at the standing run's end. */
function endJoin(run, standingIndex = 3, terminal = true) {
  return {
    run,
    at: 0,
    nodeId: run.spine.nodes[standingIndex].nodeId,
    position: run.spine.nodes[standingIndex].position,
    standingIndex,
    terminal,
  };
}

/** A run leaving (6, 0) towards +Z, three stations three metres apart. */
function bendPlan() {
  const vertices = [];
  for (const z of [0, 3, 6]) {
    for (const across of [-1, 0, 1]) {
      vertices.push({ x: 6 - across * HALF_WIDTH, y: 0, z });
    }
  }
  return { referenceLine: [], vertices, quads: [], boundary: [] };
}

/** The vertex this run put at one slot of its own end station. */
function endRim(vertices, across) {
  return vertices[across + 1];
}

test("a stroke starting at the end of a run welds to that station, without splitting", () => {
  // Drawn by hand, so it starts a little past the corner rather than on it.
  const result = junctionsWithStandingSpines(contextWithStanding(), [
    { x: 6.3, y: 0, z: 0.2 },
    { x: 6, y: 0, z: 6 },
  ]);

  assert.equal(result.inserts.length, 0, "no edge is split: the station is already there");
  assert.equal(result.terminals.length, 1);
  const [join] = result.terminals;
  assert.equal(join.terminal, true, "and it is an end of the standing run, so an L");
  assert.deepEqual(join.position, { x: 6, y: 0, z: 0 });
  // The drawn end moved onto that station.
  assert.deepEqual(result.line[0], { x: 6, y: 0, z: 0 });
  assert.equal(result.welds.get(0), join.nodeId);
});

test("an end drawn past the other run still joins it", () => {
  // Overshooting by a few centimetres used to fall outside the segment and be
  // thrown away, which is most of why an L never bent into anything.
  const result = junctionsWithStandingSpines(contextWithStanding(), [
    { x: 6.4, y: 0, z: 0 },
    { x: 6.4, y: 0, z: 6 },
  ]);
  assert.equal(result.terminals.length, 1);
  assert.deepEqual(result.line[0], { x: 6, y: 0, z: 0 });
});

test("a right-angle bend mitres both rims onto the corners they share", () => {
  const run = standingRun();
  const mitred = mitreTerminalRibs(bendPlan(), 3, 1, [endJoin(run)]);

  assert.equal(mitred.welds.size, 2, "one corner per side of the road");
  assert.equal(mitred.moves.length, 2);

  // Outside of the bend: +X then +Z, so the outer corner is at +X / -Z, and
  // it sits a half width out along each -- the 1.414 pinch a mitre has.
  const outer = endRim(mitred.vertices, -1);
  assert.ok(Math.abs(outer.x - 8.1) < 1e-9, `outer x ${outer.x}`);
  assert.ok(Math.abs(outer.z + 2.1) < 1e-9, `outer z ${outer.z}`);

  // Inside of the bend: the two rims cross behind themselves, which is the
  // same intersection and needs no separate case.
  const inner = endRim(mitred.vertices, 1);
  assert.ok(Math.abs(inner.x - 3.9) < 1e-9, `inner x ${inner.x}`);
  assert.ok(Math.abs(inner.z - 2.1) < 1e-9, `inner z ${inner.z}`);
});

test("the corner is one node: the standing rim moves onto it and this run welds to it", () => {
  const run = standingRun();
  const mitred = mitreTerminalRibs(bendPlan(), 3, 1, [endJoin(run)]);

  const standingEnds = new Set(
    run.contours.map((contour) => contour.nodes[contour.nodes.length - 1].nodeId),
  );
  for (const [key, nodeId] of mitred.welds) {
    assert.ok(standingEnds.has(nodeId), "welded to the standing run's own rim node");
    assert.equal(key.split(":")[0], "0", "at this run's own end station");
  }
  // Every weld has a move behind it, to the very place this run put its rim.
  for (const move of mitred.moves) {
    assert.equal(move.kind, "move-vertex");
    assert.ok(standingEnds.has(move.nodeId));
    const [key] = [...mitred.welds].find(([, id]) => id === move.nodeId);
    assert.deepEqual(move.position, endRim(mitred.vertices, Number(key.split(":")[1])));
  }
});

test("a run continuing straight on meets its rims half way, not nowhere", () => {
  const run = standingRun();
  // Straight on along +X: the rims are parallel and meet at no point at all.
  const straight = { referenceLine: [], vertices: [], quads: [], boundary: [] };
  for (const x of [6, 8, 10]) {
    for (const across of [-1, 0, 1]) {
      straight.vertices.push({ x, y: 0, z: across * HALF_WIDTH });
    }
  }

  const mitred = mitreTerminalRibs(straight, 3, 1, [endJoin(run)]);
  assert.equal(mitred.welds.size, 2);
  for (const across of [-1, 1]) {
    const corner = endRim(mitred.vertices, across);
    assert.ok(Math.abs(corner.x - 6) < 1e-9, `corner stays at the joint: ${corner.x}`);
    assert.ok(Math.abs(Math.abs(corner.z) - HALF_WIDTH) < 1e-9, `and at full width: ${corner.z}`);
  }
});

test("a run met in its middle is not mitred: that rib has road on both sides", () => {
  const run = standingRun();
  const mitred = mitreTerminalRibs(bendPlan(), 3, 1, [endJoin(run, 1, false)]);
  assert.equal(mitred.moves.length, 0);
  assert.equal(mitred.welds.size, 0);
});

test("an end drawn well past a run welds to its last station, never splitting at it", () => {
  // Overshooting by more than the merge distance used to measure the
  // unclamped projection, report a distance the run does not have, and fall
  // through to a split at `along` exactly 1 -- minting a node id the run
  // already had, and naming one half of the split after the very edge being
  // split. The graph refuses that, and the whole stroke was lost.
  // Past the end by more than the merge distance, but still inside the run's
  // own reach -- which is what makes it a join at all.
  const result = junctionsWithStandingSpines(contextWithStanding(), [
    { x: 7.5, y: 0, z: 0 },
    { x: 7.5, y: 0, z: 6 },
  ]);

  assert.equal(result.inserts.length, 0, "nothing is split at a station that exists");
  assert.equal(result.terminals.length, 1);
  assert.deepEqual(result.line[0], { x: 6, y: 0, z: 0 }, "it welds to the run's own end");
});

test("no split ever mints a node the run already carries", () => {
  const ctx = contextWithStanding();
  // Swept across the run at every offset, including dead on its stations.
  for (let x = 0; x <= 6; x += 0.25) {
    const result = junctionsWithStandingSpines(ctx, [
      { x, y: 0, z: -5 },
      { x, y: 0, z: 5 },
    ]);
    for (const insert of result.inserts) {
      const address = parseStationNodeId(insert.nodeId);
      assert.ok(
        !Number.isInteger(address.station),
        `x=${x} split at station ${address.station}, which the run already has`,
      );
      assert.notEqual(
        insert.firstEdgeId,
        insert.edgeId,
        `x=${x} named a half after the edge it is splitting`,
      );
      assert.notEqual(insert.secondEdgeId, insert.edgeId);
    }
  }
});
