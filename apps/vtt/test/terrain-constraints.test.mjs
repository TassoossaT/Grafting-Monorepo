import assert from "node:assert/strict";
import test from "node:test";

import {
  adoptContourNodes,
  outlineConstraints,
  perimeterConstraints,
  resolveAdoptions,
  SHORTEST_USEFUL_FRACTION,
} from "../src/composition/tabletop/tools/terrain/terrain-constraints.ts";

/**
 * A square face `a b c d`, as the engine reports one: each boundary use
 * carries the edge id and the two nodes it runs between, in that face's own
 * walk direction.
 */
function squareTopology(surfaceKey, corners) {
  const outer = corners.map((corner, index) => {
    const next = corners[(index + 1) % corners.length];
    return {
      edgeId: `e:${corner.id}~${next.id}`,
      reversed: false,
      startNodeId: corner.id,
      endNodeId: next.id,
      geometry: { kind: "line" },
    };
  });
  return {
    surfaceKey,
    surfaceType: "terrain",
    physical: true,
    outerLoops: [outer],
    holes: [],
    nodes: corners.map((corner) => ({ id: corner.id, position: { x: corner.x, y: 0, z: corner.z } })),
  };
}

const SQUARE = [
  { id: "n0", x: 0, z: 0 },
  { id: "n1", x: 4, z: 0 },
  { id: "n2", x: 4, z: 4 },
  { id: "n3", x: 0, z: 4 },
];

test("a standing face goes down as a ring carrying the node id of every corner", () => {
  const table = perimeterConstraints([squareTopology(["s", "0"], SQUARE)], 0);

  assert.equal(table.rings.length, 1, "one cloud, one ring");
  const ring = table.rings[0];
  assert.equal(ring.points.length, 4);
  // Every corner names a source, and every source resolves back to a real id.
  for (const point of ring.points) {
    assert.equal(typeof point.source, "number");
    assert.ok(table.sources[point.source] !== undefined);
  }
  assert.deepEqual([...table.sources].sort(), ["n0", "n1", "n2", "n3"]);
  // The edges are index-aligned with the points, which is what lets a
  // reported segment index name an edge by id rather than by position.
  assert.equal(ring.edges.length, ring.points.length);
});

test("source indices start where the caller says, so two tables can share one numbering", () => {
  const table = perimeterConstraints([squareTopology(["s", "0"], SQUARE)], 100);
  for (const point of table.rings[0].points) assert.ok(point.source >= 100);
});

test("the stroke's own outline drops the repeated closing point polygon-clipping adds", () => {
  const closed = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
    [0, 0],
  ];
  const rings = outlineConstraints([closed]);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].points.length, 4, "the repeat would be a zero-length segment");
  // Nobody owns the stroke's own boundary yet, so there is nothing to adopt onto.
  assert.deepEqual(rings[0].edges, []);
  assert.ok(rings[0].points.every((point) => point.source === undefined));
});

test("a ring of fewer than three points describes nothing and is dropped", () => {
  assert.deepEqual(outlineConstraints([[[0, 0], [1, 1]]]), []);
});

test("a reported node resolves to the edge it landed on, never to the nearest one", () => {
  const table = perimeterConstraints([squareTopology(["s", "0"], SQUARE)], 0);
  const ring = table.rings[0];

  // A node halfway along the ring's second segment.
  const from = ring.points[1];
  const to = ring.points[2];
  const midpoint = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };

  const { adoptions } = resolveAdoptions(
    table.rings,
    [],
    [{ vertex: 7, ringKind: "hole", ring: 0, segment: 1 }],
    () => midpoint,
  );

  assert.equal(adoptions.length, 1);
  assert.equal(adoptions[0].vertex, 7);
  assert.equal(adoptions[0].edge.edgeId, ring.edges[1].edgeId);
  assert.ok(Math.abs(adoptions[0].along - 0.5) < 1e-9);
});

test("a node landing exactly on a corner is not adopted -- that node is already shared", () => {
  const table = perimeterConstraints([squareTopology(["s", "0"], SQUARE)], 0);
  const corner = table.rings[0].points[1];
  const { adoptions } = resolveAdoptions(
    table.rings,
    [],
    [{ vertex: 1, ringKind: "hole", ring: 0, segment: 1 }],
    () => ({ x: corner.x, z: corner.z }),
  );
  assert.deepEqual(adoptions, []);
});

test("a node on the stroke's own outline is not adopted -- nothing owns that boundary yet", () => {
  const outline = outlineConstraints([[[0, 0], [4, 0], [4, 4], [0, 4]]]);
  const { adoptions } = resolveAdoptions(
    [],
    outline,
    [{ vertex: 3, ringKind: "boundary", ring: 0, segment: 0 }],
    () => ({ x: 2, z: 0 }),
  );
  assert.deepEqual(adoptions, [], "there is no edge to split");
});

test("several nodes on one edge are inserted in the order they sit along it", () => {
  const table = perimeterConstraints([squareTopology(["s", "0"], SQUARE)], 0);
  const ring = table.rings[0];
  // Three nodes on segment 0, handed over out of order.
  const positions = new Map([
    [10, { x: 3, z: 0 }],
    [11, { x: 1, z: 0 }],
    [12, { x: 2, z: 0 }],
  ]);
  const { adoptions } = resolveAdoptions(
    table.rings,
    [],
    [10, 11, 12].map((vertex) => ({ vertex, ringKind: "hole", ring: 0, segment: 0 })),
    (vertex) => positions.get(vertex),
  );
  // Ascending by position along the edge, not by any fixed vertex order: an
  // outward perimeter runs opposite to the face that owns it, so which end of
  // a segment is its start is the graph's business and not this test's.
  assert.equal(adoptions.length, 3);
  for (let index = 1; index < adoptions.length; index += 1) {
    assert.ok(
      adoptions[index].along > adoptions[index - 1].along,
      "sorted along the edge, because each split shortens what is left to split",
    );
  }

  // And each split after the first must consume the fragment the previous one
  // left, never the original edge again.
  const calls = [];
  const runtime = {
    applyRegionEdit(ops) {
      calls.push(ops[0]);
      return {};
    },
  };
  const outcome = adoptContourNodes(
    runtime,
    "t",
    "cause",
    adoptions,
    (vertex) => `new:${vertex}`,
    (vertex) => ({ ...positions.get(vertex), y: 0 }),
  );

  assert.equal(outcome.adopted.size, 3);
  assert.deepEqual([...outcome.refused], []);
  assert.equal(calls[0].edgeId, ring.edges[0].edgeId, "the first split takes the original edge");
  assert.equal(calls[1].edgeId, calls[0].secondEdgeId, "the second takes what the first left");
  assert.equal(calls[2].edgeId, calls[1].secondEdgeId);
  // Every fragment id is distinct, or a later split would collide with an
  // earlier one's output.
  const minted = calls.flatMap((call) => [call.firstEdgeId, call.secondEdgeId]);
  assert.equal(new Set(minted).size, minted.length);
  // And every one of them is the name the pair derives, not a name this
  // splitting invented -- otherwise a face declared later over those two
  // nodes mints a second edge coincident with the fragment.
  for (const call of calls) {
    const ends = [call.firstEdgeId, call.secondEdgeId];
    for (const id of ends) {
      assert.ok(id.startsWith("t:seg:"), `fragments carry the shared name; got ${id}`);
      assert.ok(id.includes(call.nodeId), `and both name the node they meet at; got ${id}`);
    }
  }
});

test("a refused split costs that node its shared edge, never the stroke", () => {
  const table = perimeterConstraints([squareTopology(["s", "0"], SQUARE)], 0);
  const { adoptions } = resolveAdoptions(
    table.rings,
    [],
    [
      { vertex: 1, ringKind: "hole", ring: 0, segment: 0 },
      { vertex: 2, ringKind: "hole", ring: 0, segment: 1 },
    ],
    (vertex) => (vertex === 1 ? { x: 2, z: 0 } : { x: 4, z: 2 }),
  );

  let seen = 0;
  const runtime = {
    applyRegionEdit() {
      seen += 1;
      if (seen === 1) throw new Error("no room");
      return {};
    },
  };
  const outcome = adoptContourNodes(
    runtime,
    "t",
    "cause",
    adoptions,
    (vertex) => `new:${vertex}`,
    (vertex) => ({ x: 0, y: 0, z: 0, vertex }),
  );

  assert.equal(outcome.adopted.size, 1, "the second node still gets its shared edge");
  assert.equal(outcome.refused.length, 1, "the first is reported so its node lands as plain geometry");
});

test("a corner too near the end of an edge takes that node instead of slicing a sliver off it", () => {
  // The whole reason the mesh degraded over strokes. A split accepted here
  // leaves a fragment in the graph a hundredth of a face long, which the next
  // stroke has to honour as a constraint and comes back as slivers.
  const table = perimeterConstraints([squareTopology(["s", "0"], SQUARE)], 0);
  const ring = table.rings[0];
  const from = ring.points[0];
  const to = ring.points[1];
  // Half a percent along a segment four units long: a 0.02 fragment.
  const near = { x: from.x + (to.x - from.x) * 0.005, z: from.z + (to.z - from.z) * 0.005 };

  const loose = resolveAdoptions(table.rings, [], [{ vertex: 9, ringKind: "hole", ring: 0, segment: 0 }], () => near, 0);
  assert.equal(loose.adoptions.length, 1, "with no floor this is the sliver that was being created");
  assert.deepEqual(loose.snaps, []);

  const { adoptions, snaps } = resolveAdoptions(
    table.rings,
    [],
    [{ vertex: 9, ringKind: "hole", ring: 0, segment: 0 }],
    () => near,
    // A face of 2 at the fraction the tool uses.
    2 * SHORTEST_USEFUL_FRACTION,
  );
  assert.deepEqual(adoptions, [], "nothing is split");
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].vertex, 9);
  assert.equal(
    table.sources[snaps[0].source],
    ring.edges[0].startNodeId,
    "it becomes the node it was nearly standing on",
  );
});

test("a corner near the far end snaps to that end, not to the near one", () => {
  const table = perimeterConstraints([squareTopology(["s", "0"], SQUARE)], 0);
  const ring = table.rings[0];
  const from = ring.points[0];
  const to = ring.points[1];
  const near = { x: from.x + (to.x - from.x) * 0.995, z: from.z + (to.z - from.z) * 0.995 };
  const { snaps } = resolveAdoptions(
    table.rings,
    [],
    [{ vertex: 9, ringKind: "hole", ring: 0, segment: 0 }],
    () => near,
    2 * SHORTEST_USEFUL_FRACTION,
  );
  assert.equal(snaps.length, 1);
  assert.equal(table.sources[snaps[0].source], ring.edges[0].endNodeId);
});

test("a corner comfortably inside an edge is still adopted -- the floor is not a ban on splitting", () => {
  const table = perimeterConstraints([squareTopology(["s", "0"], SQUARE)], 0);
  const ring = table.rings[0];
  const from = ring.points[0];
  const to = ring.points[1];
  const middle = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
  const { adoptions, snaps } = resolveAdoptions(
    table.rings,
    [],
    [{ vertex: 9, ringKind: "hole", ring: 0, segment: 0 }],
    () => middle,
    2 * SHORTEST_USEFUL_FRACTION,
  );
  assert.equal(adoptions.length, 1);
  assert.deepEqual(snaps, []);
});

test("the swept outline welds coincident points, and welding moves none of them", () => {
  // Where two of the brush's capsules meet, the union leaves points a
  // thousandth apart. A segment that short forces the same slivers a split
  // fragment does.
  const ring = [
    [0, 0],
    [4, 0],
    [4.001, 0.0005],
    [4, 4],
    [0, 4],
  ];
  const welded = outlineConstraints([ring], 0.4)[0];
  assert.equal(welded.points.length, 4, "the near-duplicate is dropped");
  // Every surviving point is one of the originals, at its original position:
  // this is welding, not the corner-cutting simplification that was reverted.
  for (const point of welded.points) {
    assert.ok(
      ring.some(([x, z]) => x === point.x && z === point.z),
      `points are kept or dropped, never moved; got ${point.x},${point.z}`,
    );
  }
  assert.equal(outlineConstraints([ring])[0].points.length, 5, "and with no tolerance nothing is welded");
});

test("welding never eats a ring down past a triangle", () => {
  const collapsing = [[0, 0], [0.01, 0], [0.02, 0.01], [0.01, 0.02]];
  const rings = outlineConstraints([collapsing], 5);
  for (const ring of rings) assert.ok(ring.points.length >= 3);
});
