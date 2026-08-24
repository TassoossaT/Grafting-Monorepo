import assert from "node:assert/strict";
import test from "node:test";

import { junctionRemovals, junctionWedges } from "../src/composition/tabletop/tools/paths/path-junction.ts";
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
      surfaceKey: ["path", region.regionId],
      surfaceType: "path",
      physical: true,
      outerLoops: [loop],
      holes: [],
      nodes: [...ids].map((id) => ({ id, position: positions.get(id) })),
    };
  });
}

/** The junction node the spine split mints at x = 3, between stations 1 and 2. */
const JUNCTION = { nodeId: stationNodeId(STANDING, 1.5, 0), station: 1.5 };
const JUNCTION_AT = { x: 3, y: 0, z: 0 };

/**
 * The spine split a junction performs, applied to the reported topologies.
 *
 * The road is *already joined* by the time its flank is rebuilt: the spine
 * edge between two stations has been cut and the junction node stands on the
 * chain. A fixture that skips that step describes a table that never exists
 * at the moment the code under test runs -- and the code is entitled to
 * expect it, because it reads the junction node off the chain rather than
 * working out where one ought to be.
 */
function withSpineSplit(topologies) {
  const from = stationNodeId(STANDING, 1, 0);
  const to = stationNodeId(STANDING, 2, 0);
  const split = `${TABLE}:seg:${[from, to].sort().join("~")}`;
  return topologies.map((topology) => {
    if (!topology.outerLoops[0].some((use) => use.edgeId === split)) return topology;
    return {
      ...topology,
      nodes: [...topology.nodes, { id: JUNCTION.nodeId, position: JUNCTION_AT }],
      outerLoops: [
        topology.outerLoops[0].flatMap((use) => {
          if (use.edgeId !== split) return [use];
          const [start, end] = use.reversed ? [to, from] : [from, to];
          return [
            { ...use, edgeId: `${split}|a`, startNodeId: start, endNodeId: JUNCTION.nodeId },
            { ...use, edgeId: `${split}|b`, startNodeId: JUNCTION.nodeId, endNodeId: end },
          ];
        }),
      ],
    };
  });
}

/** The standing run: along +X from x = 0 to x = 6, rims at z = +-2.1. */
function standingRun() {
  const runs = pathRunsIn(
    withSpineSplit(topologiesFrom(pathPatch(TABLE, STANDING, "path", planAlongX(4), 3, 1))),
  );
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
    for (const across of [-1, 0, 1]) {
      // Heading +Z, so the run's own left and right lie along -X and +X.
      vertices.push({ x: 3 - across * HALF_WIDTH, y: 0, z });
    }
  }
  return { referenceLine: [], vertices, quads: [], boundary: [] };
}

function mouthInto(run, stationZ = [-6, -3, 0]) {
  const found = pathMouthsInto(arrivingPlan(stationZ), 3, 1, [run]);
  return found;
}

test("a T reports one mouth, its two corners on the rim it arrived through", () => {
  const run = standingRun();
  const { mouths, vertices } = mouthInto(run);

  assert.equal(mouths.length, 1, "one opening, in the near flank");
  const [mouth] = mouths;
  assert.equal(mouth.through, -1, "the rim the road came in through");
  assert.equal(mouth.station, 2, "made by this run's own end rib");
  assert.equal(mouth.sides.length, 2);

  // Both corners sit on the standing rim, ordered along it.
  for (const side of mouth.sides) {
    assert.ok(Math.abs(side.position.z + HALF_WIDTH) < 1e-9, `corner z ${side.position.z}`);
  }
  assert.ok(mouth.sides[0].standingStation < mouth.sides[1].standingStation);
  assert.ok(Math.abs(mouth.sides[0].standingStation - 0.45) < 1e-6);
  assert.ok(Math.abs(mouth.sides[1].standingStation - 2.55) < 1e-6);

  // And this run's own rim ends were cut back onto them.
  for (const across of [-1, 1]) {
    assert.equal(vertices[2 * 3 + across + 1].z, -HALF_WIDTH);
  }
});

test("closing the mouth takes out the flank it opens into", () => {
  const run = standingRun();
  const [mouth] = mouthInto(run).mouths;
  const wedges = junctionWedges(TABLE, "op-2", ARRIVING, mouth, JUNCTION);

  assert.ok(wedges !== undefined);
  // Only the near side goes: the road stopped at the spine, so the far flank
  // was never opened and has no business being rebuilt.
  assert.ok(wedges.removed.length > 0);
  const removed = new Set(wedges.removed.map((key) => key.join(":")));
  for (const band of run.bands) {
    if (!removed.has(band.surfaceKey.join(":"))) continue;
    assert.ok(band.slots.includes(-1), "a near-side band");
    assert.ok(!band.slots.includes(1), "never a far-side one");
  }

  const ops = junctionRemovals([wedges]);
  assert.equal(ops.length, wedges.removed.length);
  for (const op of ops) assert.equal(op.kind, "delete-region");
});

test("what replaces it is two wedges, one either side of the arriving road", () => {
  const run = standingRun();
  const [mouth] = mouthInto(run).mouths;
  const wedges = junctionWedges(TABLE, "op-2", ARRIVING, mouth, JUNCTION);

  assert.equal(wedges.patch.regions.length, 2);
  const ids = wedges.patch.regions.map((region) => region.regionId);
  assert.deepEqual(ids, ["op-2:junction-left", "op-2:junction-right"]);
  for (const region of wedges.patch.regions) {
    assert.equal(region.surfaceType, "path");
    assert.ok(region.boundary.length >= 3, "a face needs a ring");
  }
});

test("the kerb across the junction is gone: no wedge declares the rim it spanned", () => {
  const run = standingRun();
  const [mouth] = mouthInto(run).mouths;
  const wedges = junctionWedges(TABLE, "op-2", ARRIVING, mouth, JUNCTION);

  const rim = run.contours.find((contour) => contour.across === -1);
  const spanned = rim.nodes
    .filter((node) => node.station > 0.45 && node.station < 2.55)
    .map((node) => node.nodeId);
  assert.ok(spanned.length > 0, "the mouth really does span rim stations");

  // The old rim ran straight through those nodes. Nothing declares them now,
  // so the line that read as a kerb laid across the road is not there at all.
  const declared = new Set(
    wedges.patch.edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId]),
  );
  for (const nodeId of spanned) {
    assert.ok(!declared.has(nodeId), `${nodeId} is no longer on any rim`);
  }
});

test("each wedge bounds the arriving road's own end rib, so the two are one surface", () => {
  const run = standingRun();
  const [mouth] = mouthInto(run).mouths;
  const wedges = junctionWedges(TABLE, "op-2", ARRIVING, mouth, JUNCTION);

  // The rib between the junction node and each corner. Named after the pair
  // of nodes it runs between, exactly as the road's own patch names it, so
  // the wedge and the road's last band walk the very same edge.
  for (const side of mouth.sides) {
    const corner = stationNodeId(ARRIVING, mouth.station, side.across);
    const [start, end] = [JUNCTION.nodeId, corner].sort();
    const seam = `${TABLE}:seg:${start}~${end}`;
    assert.ok(
      wedges.patch.edges.some((edge) => edge.edgeId === seam),
      `the wedge walks ${seam}`,
    );
  }
});

test("a wedge is wound the way the sweep winds its own faces", () => {
  const run = standingRun();
  const [mouth] = mouthInto(run).mouths;
  const wedges = junctionWedges(TABLE, "op-2", ARRIVING, mouth, JUNCTION);

  const positions = new Map();
  for (const node of [...run.spine.nodes, ...run.contours.flatMap((chain) => chain.nodes)]) {
    positions.set(node.nodeId, node.position);
  }
  for (const side of mouth.sides) {
    positions.set(stationNodeId(ARRIVING, mouth.station, side.across), side.position);
  }
  positions.set(JUNCTION.nodeId, JUNCTION_AT);
  const ends = new Map(wedges.patch.edges.map((edge) => [edge.edgeId, edge]));

  for (const region of wedges.patch.regions) {
    const ring = region.boundary.map((use) => {
      const edge = ends.get(use.edgeId);
      return positions.get(use.reversed ? edge.endNodeId : edge.startNodeId);
    });
    let area = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      area += current.x * next.z - next.x * current.z;
    }
    assert.ok(area > 0, `${region.regionId} winds positive, area ${area}`);
  }
});

test("a run that joined nothing opens no mouth at all", () => {
  const plan = arrivingPlan([-6, -3, 0]);
  const found = pathMouthsInto(plan, 3, 1, []);
  assert.deepEqual(found.vertices, plan.vertices);
  assert.equal(found.mouths.length, 0);
});

test("a run passing clean through opens nothing either: that is not an arrival", () => {
  const run = standingRun();
  const found = mouthInto(run, [-6, 0, 6]);
  assert.equal(found.mouths.length, 0);
  assert.deepEqual(found.vertices, arrivingPlan([-6, 0, 6]).vertices);
});

test("a fractional station on the spine does not hide the flank from the rebuild", () => {
  // The junction node sits at station 1.5, and the rim has no node there --
  // which is exactly what a spine split leaves behind. Anything locating the
  // stretch by matching station numbers finds nothing here and gives up
  // without a word, so the kerb comes back depending on where you drew last.
  const run = standingRun();
  assert.ok(
    run.spine.nodes.some((node) => !Number.isInteger(node.station)),
    "the fixture really does carry a fractional station",
  );
  const rim = run.contours.find((contour) => contour.across === -1);
  assert.ok(
    rim.nodes.every((node) => Number.isInteger(node.station)),
    "and the rim really does not",
  );

  const [mouth] = mouthInto(run).mouths;
  const wedges = junctionWedges(TABLE, "op-2", ARRIVING, mouth, JUNCTION);
  assert.ok(wedges !== undefined, "the flank is still found and rebuilt");
  assert.equal(wedges.patch.regions.length, 2);
});

test("a junction node the run does not carry rebuilds nothing, rather than half", () => {
  const run = standingRun();
  const [mouth] = mouthInto(run).mouths;
  const stranger = { nodeId: stationNodeId(STANDING, 9.5, 0), station: 9.5 };

  // One wedge alone leaves the flank it replaced half open, which is worse
  // than the kerb it was meant to remove.
  assert.equal(junctionWedges(TABLE, "op-2", ARRIVING, mouth, stranger), undefined);
});

test("the wedge patch declares every node its edges walk", () => {
  // Removing the flank prunes any node left bounding nothing, and a rim node
  // at the end of the rebuilt stretch is bounded only by the very bands being
  // removed. Assume it survives and the patch lands on a node that is gone --
  // "edge references unknown node", with the road already committed.
  const run = standingRun();
  const [mouth] = mouthInto(run).mouths;
  const wedges = junctionWedges(TABLE, "op-2", ARRIVING, mouth, JUNCTION);

  const declared = new Set(wedges.patch.nodes.map((node) => node.id));
  for (const edge of wedges.patch.edges) {
    for (const nodeId of [edge.startNodeId, edge.endNodeId]) {
      assert.ok(declared.has(nodeId), `${nodeId} is walked but never declared`);
    }
  }
  for (const node of wedges.patch.nodes) {
    assert.ok(Number.isFinite(node.position.x), `${node.id} has no position`);
  }
});

test("a rim node the removal orphans comes back with the wedge that needs it", () => {
  const run = standingRun();
  const [mouth] = mouthInto(run).mouths;
  const wedges = junctionWedges(TABLE, "op-2", ARRIVING, mouth, JUNCTION);

  // The bands going away carry rim nodes with them. Whichever of those the
  // wedges still walk must be in the patch, at the place it stood.
  const removed = new Set(wedges.removed.map((key) => key.join(":")));
  const doomed = run.bands
    .filter((band) => removed.has(band.surfaceKey.join(":")))
    .flatMap((band) => band.stations.flatMap((station) => band.slots.map((across) => stationNodeId(STANDING, station, across))));

  const declared = new Map(wedges.patch.nodes.map((node) => [node.id, node.position]));
  const walked = new Set(
    wedges.patch.edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId]),
  );
  const rescued = doomed.filter((nodeId) => walked.has(nodeId));
  assert.ok(rescued.length > 0, "the rebuilt stretch really does reuse removed nodes");
  for (const nodeId of rescued) {
    assert.ok(declared.has(nodeId), `${nodeId} would be pruned and never come back`);
  }
});
