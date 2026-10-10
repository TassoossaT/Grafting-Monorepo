import assert from "node:assert/strict";
import test from "node:test";

import { adoptContourNodes } from "../src/composition/tabletop/terrain/terrain-constraints.ts";

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

test("a fragment is named for the half it actually becomes, not the half the ring walked", () => {
  // The engine splits by what the *edge* stores -- first fragment from
  // `start_node` to the new node, second from there to `end_node` -- and takes
  // both names on trust. The ring hands its edges over pointing the other way,
  // because the free side of a boundary runs opposite the face that owns it.
  //
  // Naming from the ring's direction put the two names on the wrong halves, so
  // the graph ended up holding an edge whose id names a pair it does not
  // connect. Nothing complains until something walks it, and then one face
  // reports a loop that will not close and its neighbour an arbitrary "no room
  // on edge".
  const edge = {
    edgeId: "t:seg:a~b",
    // The ring walks b -> a; the edge stores a -> b. This is the ordinary
    // case, not a corner one: it holds for every edge whose owning face walks
    // it forwards.
    reversed: true,
    startNodeId: "b",
    endNodeId: "a",
    geometry: { kind: "line" },
  };

  const ops = [];
  const outcome = adoptContourNodes(
    { applyRegionEdit: (batch) => { ops.push(...batch); return {}; } },
    "t",
    "cause",
    [{ vertex: 7, edge, along: 0.25 }],
    () => "m",
    () => ({ x: 0, y: 0, z: 0 }),
  );

  assert.equal(outcome.adopted.size, 1);
  assert.equal(ops.length, 1);
  // The half from the stored start `a` to `m` must carry the name the pair
  // (a, m) derives, and the half from `m` to the stored end `b` the name (m, b).
  assert.equal(ops[0].firstEdgeId, "t:seg:a~m", "first fragment runs from the STORED start");
  assert.equal(ops[0].secondEdgeId, "t:seg:b~m", "second runs to the STORED end");
});

test("several nodes on a ring-reversed edge still split from the stored start outward", () => {
  // Ordering has to follow the stored direction too. Handed ascending along
  // the ring, these run *descending* along the edge, so splitting "the tail"
  // in the order given would consume a fragment that no longer contains the
  // next node.
  const edge = {
    edgeId: "t:seg:a~b",
    reversed: true,
    startNodeId: "b",
    endNodeId: "a",
    geometry: { kind: "line" },
  };

  const ops = [];
  adoptContourNodes(
    { applyRegionEdit: (batch) => { ops.push(...batch); return {}; } },
    "t",
    "cause",
    [
      { vertex: 1, edge, along: 0.25 },
      { vertex: 2, edge, along: 0.75 },
    ],
    (vertex) => `m${vertex}`,
    () => ({ x: 0, y: 0, z: 0 }),
  );

  assert.equal(ops.length, 2);
  // Ring 0.25 is stored 0.75, so vertex 2 (stored 0.25) is nearer the stored
  // start and must be cut first.
  assert.equal(ops[0].nodeId, "m2");
  assert.equal(ops[0].edgeId, "t:seg:a~b", "the first cut takes the original edge");
  assert.equal(ops[1].edgeId, ops[0].secondEdgeId, "the second takes what the first left");
  assert.equal(ops[1].nodeId, "m1");
});
