import assert from "node:assert/strict";
import test from "node:test";

import { findEnclosingRoom } from "../src/composition/tabletop/tools/house/room-lookup.ts";
import { panelTopology } from "./wall-spans-fixture.mjs";


/** Named corners of a 4x4 exterior square already split (by "Gerar Interiores") into a west and an east 2x4 half, sharing node ids wherever their positions coincide -- exactly how real, position-derived corner ids weld. */
const CORNERS = {
  sw: { x: 0, z: 0 },
  ms: { x: 2, z: 0 },
  se: { x: 4, z: 0 },
  ne: { x: 4, z: 4 },
  mn: { x: 2, z: 4 },
  nw: { x: 0, z: 4 },
};

function bottomId(name) {
  return `${name}:bottom`;
}
function topId(name) {
  return `${name}:top`;
}

function wallTopology(id, fromName, toName) {
  return panelTopology(
    id,
    { from: CORNERS[fromName], to: CORNERS[toName] },
    {
      bottomFrom: bottomId(fromName),
      bottomTo: bottomId(toName),
      topTo: topId(toName),
      topFrom: topId(fromName),
    },
  );
}

/** A 4x4 exterior square, already subdivided by one interior wall down the middle (x=2) into two 2x4 halves -- mirrors what `interior-wall-tool.ts` leaves behind after one "Gerar Interiores" click. Corner node ids are shared wherever positions coincide, exactly how real, position-derived ids weld. */
function subdividedSquareTopologies() {
  return [
    wallTopology("south-west", "sw", "ms"),
    wallTopology("south-east", "ms", "se"),
    wallTopology("east", "se", "ne"),
    wallTopology("north-east", "ne", "mn"),
    wallTopology("north-west", "mn", "nw"),
    wallTopology("west", "nw", "sw"),
    wallTopology("mid", "ms", "mn"),
  ];
}

function contextWith(topologies) {
  return { runtime: { getAllRegionTopologies: () => topologies } };
}

/** Shoelace formula -- used instead of comparing raw vertex lists, since a loop crossing a T-junction (the mid wall meeting the south/north walls) picks up extra colinear vertices there without changing its own area or true shape. */
function polygonArea(polygon) {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    sum += (polygon[j].x + polygon[i].x) * (polygon[j].z - polygon[i].z);
  }
  return Math.abs(sum) / 2;
}

test("findEnclosingRoom defaults to the smallest loop -- a subdivided half, not the whole exterior", () => {
  const ctx = contextWith(subdividedSquareTopologies());
  const room = findEnclosingRoom(ctx, { x: 1, y: 0, z: 2 });
  assert.ok(room !== undefined);
  assert.equal(polygonArea(room.polygon), 8, "the smallest loop containing (1,2) is the 2x4 west half");
});

test("findEnclosingRoom with preference 'largest' resolves to the whole exterior even after subdivision", () => {
  const ctx = contextWith(subdividedSquareTopologies());
  const room = findEnclosingRoom(ctx, { x: 1, y: 0, z: 2 }, "largest");
  assert.ok(room !== undefined);
  assert.equal(polygonArea(room.polygon), 16, "the largest loop containing (1,2) is the whole 4x4 exterior");
});

test("findEnclosingRoom with preference 'largest' still resolves consistently regardless of which half is clicked", () => {
  const ctx = contextWith(subdividedSquareTopologies());
  const fromWestHalf = findEnclosingRoom(ctx, { x: 1, y: 0, z: 2 }, "largest");
  const fromEastHalf = findEnclosingRoom(ctx, { x: 3, y: 0, z: 2 }, "largest");
  assert.ok(fromWestHalf !== undefined);
  assert.ok(fromEastHalf !== undefined);
  assert.deepEqual(new Set(fromWestHalf.bottomCycle), new Set(fromEastHalf.bottomCycle));
});
