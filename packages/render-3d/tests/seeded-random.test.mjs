import assert from "node:assert/strict";
import test from "node:test";

import { lerp, mulberry32 } from "../dist/index.js";

test("mulberry32 is deterministic for a given seed", () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  assert.equal(a(), b());
  assert.equal(a(), b());
});

test("mulberry32 differs across seeds", () => {
  const a = mulberry32(1)();
  const b = mulberry32(2)();
  assert.notEqual(a, b);
});

test("mulberry32 produces values in [0, 1)", () => {
  const random = mulberry32(42);
  for (let i = 0; i < 50; i += 1) {
    const value = random();
    assert.ok(value >= 0 && value < 1, `value ${value} out of [0, 1)`);
  }
});

test("lerp interpolates linearly between min and max", () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(4, 6, 0.25), 4.5);
});
