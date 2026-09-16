import assert from "node:assert/strict";
import test from "node:test";
import { enginePort } from "./engine-planar.mjs";

import { groupLoopsByContainment, loopSignedArea, splitContourAtPoints } from "../src/composition/tabletop/tools/platform/platform-contour-merge.ts";

/**
 * Welding a stroke onto a platform's contour asks the engine where a point
 * sits on a curved edge and how far an arc turns, instead of carrying its own
 * angle math. These hold that behaviour on a real arc, answered by the real
 * engine -- a mock would only measure a second implementation.
 */

const CORNERS = {
  a: [0, 0],
  b: [4, 0],
  belly: [2, -2],
  off: [2, -0.5],
};

const positionOf = (id) => CORNERS[id];

/** The half-circle from `a` to `b` that bulges to `z = -2`. */
const semicircle = { a: "a", b: "b", geometry: { kind: "arc", center: [2, 0], clockwise: false } };

test("a weld point on an arc splits it, and one off the arc does not", () => {
  const split = splitContourAtPoints(enginePort, [semicircle], [{ id: "belly", position: CORNERS.belly }], positionOf, 0.05);
  assert.equal(split.length, 2, "the arc was split at the point standing on it");
  assert.deepEqual([split[0].a, split[0].b, split[1].a, split[1].b], ["a", "belly", "belly", "b"]);
  assert.equal(split[0].geometry.kind, "arc", "each half is still an arc of the same circle");

  const untouched = splitContourAtPoints(enginePort, [semicircle], [{ id: "off", position: CORNERS.off }], positionOf, 0.05);
  assert.equal(untouched.length, 1, "a point well off the arc is no weld");
});

test("a loop's area counts what its arc bulges out, not just its chords", () => {
  const loop = [semicircle, { a: "b", b: "a", geometry: { kind: "line" } }];
  const area = loopSignedArea(enginePort, loop, positionOf);

  assert.ok(Math.abs(Math.abs(area) - 2 * Math.PI) < 0.05, `a half disc of radius 2 has area ~6.28, got ${area}`);
});

test("a loop nests under the bigger loop that contains it", () => {
  const square = (name, size) => [
    { a: `${name}0`, b: `${name}1`, geometry: { kind: "line" } },
    { a: `${name}1`, b: `${name}2`, geometry: { kind: "line" } },
    { a: `${name}2`, b: `${name}3`, geometry: { kind: "line" } },
    { a: `${name}3`, b: `${name}0`, geometry: { kind: "line" } },
  ].map((edge) => ({ ...edge, size }));
  const places = {
    big0: [0, 0], big1: [10, 0], big2: [10, 10], big3: [0, 10],
    small0: [4, 4], small1: [6, 4], small2: [6, 6], small3: [4, 6],
  };
  const groups = groupLoopsByContainment(enginePort, [square("big"), square("small")], (id) => places[id]);

  assert.equal(groups.length, 1, "the small loop is a hole, not its own face");
  assert.equal(groups[0].holes.length, 1);
});
