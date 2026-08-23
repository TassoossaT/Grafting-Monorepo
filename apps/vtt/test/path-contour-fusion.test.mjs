import assert from "node:assert/strict";
import test from "node:test";

import { pathPatch } from "../src/composition/tabletop/tools/paths/path-patch.ts";
import { fuseContoursWithStandingRuns } from "../src/composition/tabletop/tools/paths/path-shared.ts";
import { pathRunsIn } from "../src/features/edit-construction/path-cloud.ts";
import { pathCorridorId } from "../src/features/edit-construction/path-corridor.ts";
import { parseStationNodeId } from "../src/features/edit-construction/station-node-id.ts";

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

/** The standing run: along +X from x = 0 to x = 6, rims at z = +-2.1. */
function standingRun() {
  const runs = pathRunsIn(topologiesFrom(pathPatch("table-1", STANDING, "path", planAlongX(4), 3, 1)));
  assert.equal(runs.length, 1);
  return runs[0];
}

/**
 * A run arriving from -Z at x = 3, its last station welded onto the standing
 * spine at (3, 0) -- the T the spine join leaves behind.
 */
function arrivingPlan(stationZ) {
  const vertices = [];
  for (const z of stationZ) {
    for (const across of [-HALF_WIDTH, 0, HALF_WIDTH]) {
      // Heading +Z, so the run's own left/right lie along -X/+X.
      vertices.push({ x: 3 - across, y: 0, z });
    }
  }
  return { referenceLine: [], vertices, quads: [], boundary: [] };
}

test("a T fuses both rims where they cross, and nowhere else", () => {
  const run = standingRun();
  const plan = arrivingPlan([-6, -3, 0]);

  const fused = fuseContoursWithStandingRuns(plan, 3, 1, [run]);

  // One meeting point per side of the arriving run: two, not four. The far
  // rim of the standing road was never crossed, so it is not touched --
  // which is what stops the junction closing into a triangle.
  assert.equal(fused.inserts.length, 2);
  assert.equal(fused.welds.size, 2);

  // Each loose end moved back onto the standing rim at z = -2.1, cutting the
  // stub that was sitting inside the other road.
  for (const across of [-1, 1]) {
    const moved = fused.vertices[2 * 3 + across + 1];
    assert.equal(moved.z, -HALF_WIDTH, `slot ${across} stops on the standing rim`);
  }
  // And the stations before the junction were left exactly where they were.
  assert.deepEqual(fused.vertices.slice(0, 6), plan.vertices.slice(0, 6));
});

test("the node a fused rim takes is one the standing run now owns", () => {
  const run = standingRun();
  const fused = fuseContoursWithStandingRuns(arrivingPlan([-6, -3, 0]), 3, 1, [run]);

  for (const [key, nodeId] of fused.welds) {
    const address = parseStationNodeId(nodeId);
    assert.equal(address.operationId, run.corridorId, "minted on the run that was crossed");
    assert.notEqual(address.across, 0, "on its rim, not on its travel line");
    assert.ok(
      !Number.isInteger(address.station),
      "between two of its stations, since a meeting point almost never lands on one",
    );
    // The arriving run's own end is what welds to it.
    assert.equal(key.split(":")[0], "2");
  }
});

test("each fused rim splits the standing edge it landed on", () => {
  const run = standingRun();
  const fused = fuseContoursWithStandingRuns(arrivingPlan([-6, -3, 0]), 3, 1, [run]);

  const nearRim = run.contours.find((contour) => contour.across < 0);
  for (const insert of fused.inserts) {
    assert.equal(insert.kind, "insert-vertex");
    assert.ok(nearRim.edgeIds.includes(insert.edgeId), "the rim that was crossed, not the far one");
    assert.notEqual(insert.firstEdgeId, insert.secondEdgeId);
  }
  // Two ends, two different edges: an edge split twice would name one the
  // first split has already replaced.
  assert.equal(new Set(fused.inserts.map((insert) => insert.edgeId)).size, 2);
});

test("a run passing clean through keeps its rims, having no loose end to cut", () => {
  const run = standingRun();
  // Straight across and out the other side: every rim point beyond the road
  // is outside it, and the pair that brackets the road brackets it wholly.
  const fused = fuseContoursWithStandingRuns(arrivingPlan([-6, 0, 6]), 3, 1, [run]);
  assert.equal(fused.inserts.length, 0);
  assert.deepEqual(fused.vertices, arrivingPlan([-6, 0, 6]).vertices);
});

test("a run that joined nothing is committed exactly as the sweep planned it", () => {
  const plan = arrivingPlan([-6, -3, 0]);
  const fused = fuseContoursWithStandingRuns(plan, 3, 1, []);
  assert.deepEqual(fused.vertices, plan.vertices);
  assert.equal(fused.inserts.length, 0);
  assert.equal(fused.welds.size, 0);
});

test("a fused rim node reaches the patch, so both runs reference one node", () => {
  const run = standingRun();
  const arriving = pathCorridorId("table:path-brush:2", "road");
  const plan = arrivingPlan([-6, -3, 0]);
  const fused = fuseContoursWithStandingRuns(plan, 3, 1, [run]);

  const formation = pathPatch(
    "table-1",
    arriving,
    "path",
    { ...plan, vertices: fused.vertices, quads: planAlongX(3).quads, boundary: planAlongX(3).boundary },
    3,
    1,
    fused.welds,
  );

  const declared = new Set(formation.patch.nodes.map((node) => node.id));
  for (const nodeId of fused.welds.values()) {
    assert.ok(declared.has(nodeId), `the patch declares ${nodeId} rather than minting its own`);
  }
});
