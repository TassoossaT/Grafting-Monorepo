import assert from "node:assert/strict";
import test from "node:test";

import {
  lengthInsideStandingPath,
  overlapRefusal,
} from "../src/features/edit-construction/structure-types/path/path-overlap.ts";

const WIDTH = 4;

/** A standing road running along +x from `0` to `length`, `WIDTH` wide. */
function standingRoad(length = 40) {
  const corners = [
    { x: 0, y: 0, z: -WIDTH / 2 },
    { x: length, y: 0, z: -WIDTH / 2 },
    { x: length, y: 0, z: WIDTH / 2 },
    { x: 0, y: 0, z: WIDTH / 2 },
  ];
  const nodes = corners.map((position, index) => ({ id: `n${index}`, position }));
  return {
    surfaceKey: ["@region", "standing:band-0:0"],
    surfaceType: "path",
    physical: true,
    outerLoops: [
      nodes.map((node, index) => ({
        edgeId: `e${index}`,
        reversed: false,
        startNodeId: node.id,
        endNodeId: nodes[(index + 1) % nodes.length].id,
        geometry: { kind: "line" },
      })),
    ],
    holes: [],
    nodes,
  };
}

/** A spine sampled finely enough that a step is far shorter than the road is wide. */
function spine(from, to, steps = 200) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return { x: from[0] + (to[0] - from[0]) * t, y: 0, z: from[1] + (to[1] - from[1]) * t };
  });
}

test("a square crossing is a junction, not a duplicate", () => {
  const crossing = spine([20, -15], [20, 15]);
  const inside = lengthInsideStandingPath(crossing, [standingRoad()]);
  assert.ok(Math.abs(inside - WIDTH) < 0.5, `expected about one width inside, got ${inside}`);
  assert.equal(overlapRefusal(crossing, [standingRoad()], WIDTH), undefined);
});

test("a short stroke crossing a long road is still a junction", () => {
  // The case a fraction-of-the-stroke rule gets wrong: most of this run is
  // inside the standing road, and it is still an ordinary crossing.
  const stub = spine([20, -3], [20, 3]);
  assert.equal(overlapRefusal(stub, [standingRoad()], WIDTH), undefined);
});

test("a run laid along a standing road is refused", () => {
  const alongside = spine([2, 0], [38, 0]);
  const refusal = overlapRefusal(alongside, [standingRoad()], WIDTH);
  assert.ok(refusal !== undefined, "a road drawn on top of a road must be refused");
  assert.match(refusal, /por cima/);
});

test("a run beside a standing road, not on it, is allowed", () => {
  const beside = spine([2, WIDTH], [38, WIDTH]);
  assert.equal(overlapRefusal(beside, [standingRoad()], WIDTH), undefined);
});

test("a shallow crossing is allowed but a near-parallel one is not", () => {
  // Twenty degrees still reads as crossing; running dead level with the road
  // for its whole length does not.
  const shallow = spine([6, -6], [30, 6]);
  assert.equal(overlapRefusal(shallow, [standingRoad()], WIDTH), undefined);
  const parallel = spine([4, 1], [36, -1]);
  assert.ok(overlapRefusal(parallel, [standingRoad()], WIDTH) !== undefined);
});

test("empty table and degenerate input refuse nothing", () => {
  assert.equal(overlapRefusal(spine([0, 0], [10, 0]), [], WIDTH), undefined);
  assert.equal(overlapRefusal([], [standingRoad()], WIDTH), undefined);
  assert.equal(overlapRefusal(spine([2, 0], [38, 0]), [standingRoad()], 0), undefined);
});
