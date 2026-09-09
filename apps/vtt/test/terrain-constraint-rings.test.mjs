import assert from "node:assert/strict";
import test from "node:test";

import { buildConstraintRings } from "../src/composition/tabletop/terrain/terrain-cut-executor.ts";

/**
 * Giving a boolean's output its identity back.
 *
 * `polygon-clipping` answers in bare floats, so every corner of the result has
 * to be matched against the corners that did carry a node. These are the ways
 * that matching used to guess wrong, and every one of them got likelier as the
 * road network grew: more junctions means more nodes within snapping distance
 * of each other and of the ground's own rim.
 */

const FACE = 2;
// What the executor derives from it: max(0.25, face * 0.18) and max(0.08, face * 0.08).
const SNAP = 0.36;
const MIN_STEP = 0.16;

/** A closed square, as `polygon-clipping` hands one back. */
function square(x0, z0, x1, z1) {
  return [
    [
      [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
        [x0, z0],
      ],
    ],
  ];
}

/** A perimeter table of standing nodes, each at a position, numbered in order. */
function standing(positions, edges = []) {
  return {
    rings: [
      {
        points: positions.map(([x, z], index) => ({ x, z, source: index })),
        edges: positions.map((_, index) => edges[index]),
      },
    ],
    sources: positions.map((_, index) => `n${index}`),
  };
}

function sourcesOf(ring) {
  return ring.points.map((point) => point.source);
}

test("a corner sitting on a node takes it", () => {
  const rings = buildConstraintRings(square(0, 0, 4, 4), FACE, standing([[0, 0]]));
  assert.equal(rings.length, 1);
  const named = rings[0].points.filter((point) => point.source !== undefined);
  assert.equal(named.length, 1);
  assert.deepEqual({ x: named[0].x, z: named[0].z }, { x: 0, z: 0 });
});

test("one node is taken by one corner, never by two", () => {
  // Both corners of this sliver are inside the snapping radius of the same
  // node. Letting both take it does not make a duplicate -- it collapses two
  // distinct mesh edges into one, so two faces of the same fill walk it the
  // same way and the engine refuses the second, or the cell is dropped
  // outright for naming one node twice.
  const node = [0.5, 0];
  const rings = buildConstraintRings(square(0.3, 0, 0.7, 4), FACE, standing([node]));
  const named = rings.flatMap((ring) => sourcesOf(ring)).filter((source) => source !== undefined);

  assert.equal(named.length, 1, "the node is claimed once");
  assert.ok(Math.hypot(0.3 - node[0], 0) < SNAP, "and both corners really were in reach of it");
  assert.ok(Math.hypot(0.7 - node[0], 0) < SNAP);
});

test("the closest corner wins the node, not whichever comes first in the ring", () => {
  // The ring visits (0,0) before (4,0). The node sits exactly on the second.
  // Matching in ring order hands it to the corner a third of a face away.
  const node = [4, 0];
  const rings = buildConstraintRings(square(0, 0, 4, 4), FACE, standing([[3.7, 0]]));
  assert.ok(rings.length === 1);

  const exact = buildConstraintRings(square(0, 0, 4, 4), FACE, standing([node]));
  const named = exact[0].points.find((point) => point.source !== undefined);
  assert.deepEqual({ x: named.x, z: named.z }, { x: 4, z: 0 }, "the corner it sits on is the one that takes it");

  // And with two nodes competing for one corner, the nearer one takes it.
  const both = buildConstraintRings(square(0, 0, 4, 4), FACE, standing([[4.3, 0], [4, 0]]));
  const atCorner = both[0].points.find((point) => point.x === 4 && point.z === 0);
  assert.equal(atCorner.source, 1, "the node it sits on, not the one a third of a face away");
});

test("welding never throws away a corner that names a node", () => {
  // Two nodes closer together than the welding step. Welding first would drop
  // the second and lose its identity; a corner the ground has to meet exactly
  // is not a corner worth shortening a ring over.
  const rings = buildConstraintRings(
    [
      [
        [
          [0, 0],
          [0.1, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    ],
    FACE,
    standing([[0, 0], [0.1, 0]]),
  );

  assert.ok(0.1 < MIN_STEP, "the two really are closer than the welding step");
  const named = sourcesOf(rings[0]).filter((source) => source !== undefined);
  assert.deepEqual([...named].sort(), [0, 1], "both nodes survive");
});

test("a corner too far from every node stays anonymous rather than taking the nearest", () => {
  const rings = buildConstraintRings(square(0, 0, 4, 4), FACE, standing([[-1, -1]]));
  assert.deepEqual(sourcesOf(rings[0]), [undefined, undefined, undefined, undefined]);
});

test("two corners that both name a node carry the edge standing between them", () => {
  const edge = { edgeId: "e:n0~n1", reversed: false, startNodeId: "n0", endNodeId: "n1", geometry: { kind: "line" } };
  // The table's ring is the square itself, so its segment 0 runs n0 -> n1.
  const perimeters = standing([[0, 0], [4, 0], [4, 4], [0, 4]], [edge]);
  const rings = buildConstraintRings(square(0, 0, 4, 4), FACE, perimeters);

  const points = rings[0].points;
  const at = points.findIndex((point) => point.source === 0);
  const next = points[(at + 1) % points.length];
  assert.ok(next.source === 1 || points[(at - 1 + points.length) % points.length].source === 1);

  const carried = rings[0].edges.filter((candidate) => candidate !== undefined);
  assert.equal(carried.length, 1, "one segment of this ring is a standing edge");
  assert.equal(carried[0].edgeId, "e:n0~n1");
});

test("a hole ring is reported as one, because the caller lays ground in one and not the other", () => {
  const withHole = [
    [
      [
        [0, 0],
        [8, 0],
        [8, 8],
        [0, 8],
        [0, 0],
      ],
      [
        [3, 3],
        [3, 5],
        [5, 5],
        [5, 3],
        [3, 3],
      ],
    ],
  ];
  const rings = buildConstraintRings(withHole, FACE, standing([]));
  assert.equal(rings.length, 2);
  assert.equal(rings.filter((ring) => ring.isHole).length, 1);
  assert.equal(rings.find((ring) => ring.isHole).points.length, 4);
});

test("matching stays linear as the standing network grows", () => {
  // Ten thousand nodes nowhere near the ring. An exhaustive search visits all
  // of them for every corner; a bucketed one visits none.
  const far = [];
  for (let index = 0; index < 10000; index += 1) far.push([1000 + index, 1000]);
  far.push([0, 0]);

  const started = performance.now();
  const rings = buildConstraintRings(square(0, 0, 4, 4), FACE, standing(far));
  const elapsed = performance.now() - started;

  assert.equal(sourcesOf(rings[0]).filter((source) => source !== undefined).length, 1);
  assert.ok(elapsed < 250, `matching took ${elapsed.toFixed(0)}ms`);
});
