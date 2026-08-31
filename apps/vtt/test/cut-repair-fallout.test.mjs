import assert from "node:assert/strict";
import test from "node:test";

import { paintedGeometryOf } from "../src/composition/tabletop/tools/cut-repair-dispatch.ts";

/**
 * What the repair is *handed* has been the cause of every cut-repair failure
 * so far -- never its own arithmetic. This is that hand-off, on its own.
 *
 * The shape that broke it: a brush resubmits only its latest increment each
 * tick, so the stroke's own footprint coverage names a fraction of the road
 * it has drawn. Anything built from coverage alone subtracts a fraction of
 * the road from the hole, computes the fill over ground the road really
 * occupies, and gets the whole face refused by the engine for trying to take
 * a side of an edge the road already holds.
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
  positions.set("t1", { x: 20, y: 0, z: 20 });
  positions.set("t2", { x: 24, y: 0, z: 20 });
  positions.set("t3", { x: 24, y: 0, z: 24 });
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
  const runtime = createRoadGraph();

  const { paintedNodes, paintedLoops } = paintedGeometryOf(runtime, "path");

  // All three bands, not the one a brush tick would have named.
  assert.equal(paintedLoops.length, 3, "every live face of the painter's type contributes its own ring");
  assert.equal(paintedNodes.length, 12, "and every one of their nodes is a weld candidate");

  // The rings reach the road's whole length: a fill computed against these
  // cannot land on the far bands, which is exactly what it was doing.
  const zs = paintedLoops.flat().map((point) => point.z);
  assert.equal(Math.min(...zs), 0);
  assert.equal(Math.max(...zs), 12, "the first band's ring alone would have stopped at z = 4");
});

test("only the painter's own type is handed over", () => {
  const runtime = createRoadGraph();

  const { paintedNodes, paintedLoops } = paintedGeometryOf(runtime, "path");

  assert.ok(!paintedNodes.some((node) => node.id.startsWith("t")), "terrain nodes are not the painter's own");
  assert.ok(
    !paintedLoops.some((ring) => ring.some((point) => point.x > 4)),
    "the terrain face at x = 20 contributed nothing",
  );
});

test("a type with no faces on the table hands over nothing, rather than failing", () => {
  const runtime = createRoadGraph();

  const { paintedNodes, paintedLoops } = paintedGeometryOf(runtime, "wall");

  assert.deepEqual(paintedNodes, []);
  assert.deepEqual(paintedLoops, []);
});
