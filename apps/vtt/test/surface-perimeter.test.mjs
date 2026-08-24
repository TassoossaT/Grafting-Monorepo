import assert from "node:assert/strict";
import test from "node:test";

import {
  edgeUseCounts,
  perimeterOf,
} from "../src/features/edit-construction/topology/surface-perimeter.ts";

/** One face, given its ring of node ids. Edges are named after node pairs. */
function face(regionId, ring, positions) {
  return {
    surfaceKey: ["path", regionId],
    surfaceType: "path",
    physical: true,
    nodes: ring.map((id) => ({ id, position: positions[id] })),
    outerLoops: [
      ring.map((id, index) => {
        const next = ring[(index + 1) % ring.length];
        const [start, end] = [id, next].sort();
        return { edgeId: `seg:${start}~${end}`, startNodeId: id, endNodeId: next, reversed: false };
      }),
    ],
    holes: [],
  };
}

/**
 * Two bands side by side, sharing the seam b--e:
 *
 *   a --- b --- c
 *   |     |     |
 *   d --- e --- f
 */
const POSITIONS = {
  a: { x: 0, y: 0, z: 0 },
  b: { x: 1, y: 0, z: 0 },
  c: { x: 2, y: 0, z: 0 },
  d: { x: 0, y: 0, z: 1 },
  e: { x: 1, y: 0, z: 1 },
  f: { x: 2, y: 0, z: 1 },
};
const LEFT = face("left", ["a", "b", "e", "d"], POSITIONS);
const RIGHT = face("right", ["b", "c", "f", "e"], POSITIONS);

test("an edge with a face on both sides is interior, whatever it looks like", () => {
  const counts = edgeUseCounts([LEFT, RIGHT]);
  assert.equal(counts.get("seg:b~e"), 2, "the seam");
  assert.equal(counts.get("seg:a~b"), 1, "the rim");
});

test("the perimeter is what has a face on one side, and it closes", () => {
  const [loop, ...rest] = perimeterOf([LEFT, RIGHT]);
  assert.equal(rest.length, 0, "one surface, one perimeter");
  assert.ok(loop.closed, "a perimeter that does not close is not a perimeter");

  // Six rim edges around the pair; the seam is not one of them.
  assert.equal(loop.edgeIds.length, 6);
  assert.ok(!loop.edgeIds.includes("seg:b~e"), "the seam is inside, so it is not contour");
  assert.deepEqual(new Set(loop.nodeIds), new Set(["a", "b", "c", "d", "e", "f"]));
});

test("a face on its own is all perimeter", () => {
  const [loop] = perimeterOf([LEFT]);
  assert.equal(loop.edgeIds.length, 4);
  assert.ok(loop.closed);
  assert.ok(loop.edgeIds.includes("seg:b~e"), "with nothing beside it, the seam is rim");
});

test("the perimeter is a question about a set, so removing a face changes it", () => {
  // Exactly the junction case: take the middle band out and what was interior
  // becomes rim, without any node moving or any address changing.
  const joined = perimeterOf([LEFT, RIGHT]);
  const alone = perimeterOf([RIGHT]);
  assert.ok(!joined[0].edgeIds.includes("seg:b~e"));
  assert.ok(alone[0].edgeIds.includes("seg:b~e"));
});

test("nothing standing has no perimeter", () => {
  assert.deepEqual(perimeterOf([]), []);
});

test("the walk carries the positions, in the order it walked them", () => {
  const [loop] = perimeterOf([LEFT]);
  assert.equal(loop.positions.length, loop.nodeIds.length);
  for (const [index, nodeId] of loop.nodeIds.entries()) {
    assert.deepEqual(loop.positions[index], POSITIONS[nodeId]);
  }
});
