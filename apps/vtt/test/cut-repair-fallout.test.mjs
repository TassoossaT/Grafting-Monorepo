import assert from "node:assert/strict";
import test from "node:test";

import { paintedNodesOf } from "../src/composition/tabletop/tools/cut-repair-dispatch.ts";

/**
 * What the repair is *handed* has been the cause of every cut-repair failure
 * so far, never its own arithmetic. This is that hand-off, on its own.
 *
 * The painter's nodes are the far side of the hole's scope: the engine treats
 * an edge as free boundary only when both of its nodes are named, so a repair
 * that names only its own consumed ground finds no closed loop at all and
 * regenerates nothing. A brush resubmits only its latest increment each tick,
 * so anything derived from the stroke's own footprint names a fraction of the
 * road it has drawn -- which is why this reads every live face of the type.
 */

/** A road of three bands laid end to end, of which a stroke's footprint would report only the last. */
function createRoadGraph() {
  const positions = new Map();
  const topologies = [];

  // Four rows of two nodes, three bands laid between them. Consecutive bands
  // share the row between them *by node id* -- which is what makes them one
  // cloud rather than two coincident shapes, and what a perimeter is derived
  // from.
  for (let row = 0; row < 4; row += 1) {
    positions.set(`row-${row}-l`, { x: 0, y: 0, z: row * 4 });
    positions.set(`row-${row}-r`, { x: 2, y: 0, z: row * 4 });
  }

  const edgeBetween = (from, to) => {
    const [low, high] = from < to ? [from, to] : [to, from];
    return { edgeId: `e:${low}~${high}`, reversed: from !== low, startNodeId: from, endNodeId: to, geometry: { kind: "line" } };
  };

  for (let band = 0; band < 3; band += 1) {
    const ids = [`row-${band}-l`, `row-${band}-r`, `row-${band + 1}-r`, `row-${band + 1}-l`];
    topologies.push({
      surfaceKey: ["@region", `R${band}`],
      surfaceType: "path",
      physical: true,
      outerLoops: [ids.map((id, index) => edgeBetween(id, ids[(index + 1) % ids.length]))],
      holes: [],
      nodes: ids.map((id) => ({ id, position: positions.get(id) })),
    });
  }

  // One terrain face, so the filter has something of another type to reject.
  for (const [id, position] of [["t1", { x: 20, y: 0, z: 20 }], ["t2", { x: 24, y: 0, z: 20 }], ["t3", { x: 24, y: 0, z: 24 }]]) {
    positions.set(id, position);
  }
  const terrain = ["t1", "t2", "t3"];
  topologies.push({
    surfaceKey: ["@region", "T1"],
    surfaceType: "terrain",
    physical: true,
    outerLoops: [
      terrain.map((id, index) => ({
        edgeId: `e:t${index}`,
        reversed: false,
        startNodeId: id,
        endNodeId: terrain[(index + 1) % terrain.length],
        geometry: { kind: "line" },
      })),
    ],
    holes: [],
    nodes: terrain.map((id) => ({ id, position: positions.get(id) })),
  });

  return {
    getAllRegionTopologies: () => topologies,
    getSnapshot: () => ({
      tableId: "table-1",
      map: { nodePositions: new Map([...positions].map(([id, position]) => [id, { position }])) },
    }),
  };
}

test("the painter's whole cloud is handed over, not only the increment a footprint would report", () => {
  const { paintedNodes: painted, paintedLoops } = paintedNodesOf(createRoadGraph(), "path");

  // One ring around the whole road, not one per band: the bands touch, and a
  // mend opening around each of them separately would describe a shape
  // overlapping itself along every shared edge.
  assert.equal(paintedLoops.length, 1, "the painter's cloud has one outline");
  const rim = new Set(paintedLoops[0].flatMap((edge) => [edge.startNodeId, edge.endNodeId]));
  assert.equal(paintedLoops[0].length, 8, "six side edges and the two ends, the shared rows dissolved");
  assert.equal(painted.length, 8, "every node of all three bands, not the four a brush tick would have named");
  const zs = painted.map((node) => node.position.z);
  assert.equal(Math.max(...zs), 12, "the newest band alone would have stopped at z = 4");
});

test("only the painter's own type is handed over", () => {
  const { paintedNodes: painted } = paintedNodesOf(createRoadGraph(), "path");

  assert.ok(painted.every((node) => node.id.startsWith("row-")), "terrain nodes are not the painter's own");
});

test("a type with no faces on the table hands over nothing, rather than failing", () => {
  assert.deepEqual(paintedNodesOf(createRoadGraph(), "wall"), { paintedNodes: [], paintedLoops: [] });
});
