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

  for (let band = 0; band < 3; band += 1) {
    const z0 = band * 4;
    const corners = [
      [`band-${band}-a`, { x: 0, y: 0, z: z0 }],
      [`band-${band}-b`, { x: 2, y: 0, z: z0 }],
      [`band-${band}-c`, { x: 2, y: 0, z: z0 + 4 }],
      [`band-${band}-d`, { x: 0, y: 0, z: z0 + 4 }],
    ];
    for (const [id, position] of corners) positions.set(id, position);
    const ids = corners.map(([id]) => id);
    topologies.push({
      surfaceKey: ["@region", `R${band}`],
      surfaceType: "path",
      physical: true,
      outerLoops: [ids.map((id) => ({ startNodeId: id }))],
      nodes: ids.map((id) => ({ id, position: positions.get(id) })),
    });
  }

  // One terrain face, so the filter has something of another type to reject.
  for (const [id, position] of [["t1", { x: 20, y: 0, z: 20 }], ["t2", { x: 24, y: 0, z: 20 }], ["t3", { x: 24, y: 0, z: 24 }]]) {
    positions.set(id, position);
  }
  topologies.push({
    surfaceKey: ["@region", "T1"],
    surfaceType: "terrain",
    physical: true,
    outerLoops: [["t1", "t2", "t3"].map((id) => ({ startNodeId: id }))],
    nodes: ["t1", "t2", "t3"].map((id) => ({ id, position: positions.get(id) })),
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

  assert.equal(paintedLoops.length, 3, "one boundary loop per face, so a mend can open around each");
  assert.equal(painted.length, 12, "all three bands' nodes, not the four a brush tick would have named");
  const zs = painted.map((node) => node.position.z);
  assert.equal(Math.max(...zs), 12, "the newest band alone would have stopped at z = 4");
});

test("only the painter's own type is handed over", () => {
  const { paintedNodes: painted } = paintedNodesOf(createRoadGraph(), "path");

  assert.ok(!painted.some((node) => node.id.startsWith("t")), "terrain nodes are not the painter's own");
});

test("a type with no faces on the table hands over nothing, rather than failing", () => {
  assert.deepEqual(paintedNodesOf(createRoadGraph(), "wall"), { paintedNodes: [], paintedLoops: [] });
});
