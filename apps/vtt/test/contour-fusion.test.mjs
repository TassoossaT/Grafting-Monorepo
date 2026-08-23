import assert from "node:assert/strict";
import test from "node:test";

import {
  contourFusionsAgainst,
  footprintOf,
} from "../src/composition/tabletop/tools/core/contour-fusion.ts";

/** A road standing along +X, four metres wide, from x = 0 to x = 10. */
const FOOTPRINT = footprintOf(
  [
    { x: 0, y: 0, z: -2 },
    { x: 10, y: 0, z: -2 },
  ],
  [
    { x: 0, y: 0, z: 2 },
    { x: 10, y: 0, z: 2 },
  ],
);

const NEAR_RIM = {
  points: [
    { x: 0, y: 0, z: -2 },
    { x: 10, y: 0, z: -2 },
  ],
  edgeIds: ["near"],
};

const FAR_RIM = {
  points: [
    { x: 0, y: 0, z: 2 },
    { x: 10, y: 0, z: 2 },
  ],
  edgeIds: ["far"],
};

test("a rim arriving into another reports the point where the two meet", () => {
  const arriving = {
    points: [
      { x: 5, y: 0, z: -6 },
      { x: 5, y: 0, z: 0 },
    ],
    edgeIds: [],
  };

  const [fusion, ...rest] = contourFusionsAgainst(arriving, NEAR_RIM, FOOTPRINT);
  assert.equal(rest.length, 0);
  // The loose end is the one inside the other road; it is the one that moves.
  assert.equal(fusion.ownIndex, 1);
  assert.deepEqual(fusion.position, { x: 5, y: 0, z: -2 });
  assert.equal(fusion.edgeId, "near");
  assert.equal(fusion.along, 0.5, "half way along the standing edge");
  assert.equal(fusion.standingIndex, 0);
});

test("the rim it never reached is left alone, so a T keeps its mouth open", () => {
  const arriving = {
    points: [
      { x: 5, y: 0, z: -6 },
      { x: 5, y: 0, z: 0 },
    ],
    edgeIds: [],
  };
  // Fusing here too would close the junction across the far side -- the
  // triangle the owner ruled out. Nothing crossed, so nothing fuses.
  assert.deepEqual(contourFusionsAgainst(arriving, FAR_RIM, FOOTPRINT), []);
});

test("a rim passing clean through is left alone rather than cut in two", () => {
  // In and out the far side: the point inside is an interior one, so there is
  // no loose end -- pulling it back would fold the rim over on itself.
  const through = {
    points: [
      { x: 5, y: 0, z: -6 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 0, z: 6 },
    ],
    edgeIds: [],
  };
  assert.deepEqual(contourFusionsAgainst(through, NEAR_RIM, FOOTPRINT), []);
  assert.deepEqual(contourFusionsAgainst(through, FAR_RIM, FOOTPRINT), []);
});

test("a rim stopping short of the other touches nothing", () => {
  const short = {
    points: [
      { x: 5, y: 0, z: -6 },
      { x: 5, y: 0, z: -4 },
    ],
    edgeIds: [],
  };
  assert.deepEqual(contourFusionsAgainst(short, NEAR_RIM, FOOTPRINT), []);
});

test("the meeting point carries the height the arriving rim has there", () => {
  const climbing = {
    points: [
      { x: 5, y: 0, z: -6 },
      { x: 5, y: 6, z: 0 },
    ],
    edgeIds: [],
  };
  const [fusion] = contourFusionsAgainst(climbing, NEAR_RIM, FOOTPRINT);
  assert.equal(fusion.position.y, 4, "two thirds of the way up");
});

test("a standing edge is split once, however many ends fall on it", () => {
  // Two loose ends, both nearest the same standing edge. The second would
  // name an edge the first has already replaced, so only one survives.
  const forked = {
    points: [
      { x: 3, y: 0, z: 0 },
      { x: 5, y: 0, z: -6 },
      { x: 7, y: 0, z: 0 },
    ],
    edgeIds: [],
  };
  const fusions = contourFusionsAgainst(forked, NEAR_RIM, FOOTPRINT);
  assert.equal(fusions.length, 1);
});

test("footprintOf walks the two rims as one closed ring", () => {
  const ring = footprintOf(
    [
      { x: 0, y: 0, z: -1 },
      { x: 4, y: 0, z: -1 },
    ],
    [
      { x: 0, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
    ],
  );
  assert.deepEqual(
    ring.map((point) => [point.x, point.z]),
    [
      [0, -1],
      [4, -1],
      [4, 1],
      [0, 1],
    ],
  );
});
