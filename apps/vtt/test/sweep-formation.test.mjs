import assert from "node:assert/strict";
import test from "node:test";

import {
  SweepFormationError,
  stationFrame,
  sweepFormation,
  sweptBoundary,
  withoutCoincidentStations,
} from "../src/composition/tabletop/tools/core/sweep-formation.ts";

const FLAT = [
  { lateralOffset: -2, elevation: 0 },
  { lateralOffset: 0, elevation: 0 },
  { lateralOffset: 2, elevation: 0 },
];

function along(points) {
  return points.map(([x, z], index) => ({ x, y: index, z }));
}

test("a straight line sweeps a straight strip, station by station", () => {
  const plan = sweepFormation(
    [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    FLAT,
    4,
  );

  // Station-major: three vertices per station, in profile order.
  assert.equal(plan.vertices.length, 6);
  assert.deepEqual(plan.vertices[0], { x: 0, y: 0, z: -2 });
  assert.deepEqual(plan.vertices[1], { x: 0, y: 0, z: 0 });
  assert.deepEqual(plan.vertices[2], { x: 0, y: 0, z: 2 });
  assert.deepEqual(plan.vertices[3], { x: 4, y: 0, z: -2 });

  // Two bands between the two stations, sharing the middle column.
  assert.deepEqual(plan.quads, [
    [0, 3, 4, 1],
    [1, 4, 5, 2],
  ]);
});

test("a station carries the height it was drawn at, plus the profile's own", () => {
  const plan = sweepFormation(
    [
      { x: 0, y: 5, z: 0 },
      { x: 4, y: 9, z: 0 },
    ],
    [
      { lateralOffset: -2, elevation: 0.5 },
      { lateralOffset: 2, elevation: 0.5 },
    ],
    4,
  );
  assert.equal(plan.vertices[0].y, 5.5, "elevation is measured from the line, not the floor");
  assert.equal(plan.vertices[2].y, 9.5);
});

test("a corner mitres, so the offset rim still meets both straight stretches", () => {
  // A right angle: +X then +Z. The outer offset has to reach sqrt(2) times
  // the half width, which is what a mitre is for.
  const line = [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 4, y: 0, z: 4 },
  ];
  const frame = stationFrame(line, 1, 4);
  assert.ok(Math.abs(Math.hypot(frame[0], frame[1]) - Math.SQRT2) < 1e-6, `${frame}`);

  // Turning +X into +Z is a left turn, so the outside of it is the right of
  // travel -- the negative lateral slot, out at (6, -2).
  const plan = sweepFormation(line, FLAT, 4);
  const outer = plan.vertices[3 + 0];
  assert.ok(Math.abs(outer.x - 6) < 1e-6, `outer x ${outer.x}`);
  assert.ok(Math.abs(outer.z + 2) < 1e-6, `outer z ${outer.z}`);

  // The inside of the same corner is the mirror of it through the station.
  const inner = plan.vertices[3 + 2];
  assert.ok(Math.abs(inner.x - 2) < 1e-6, `inner x ${inner.x}`);
  assert.ok(Math.abs(inner.z - 2) < 1e-6, `inner z ${inner.z}`);
});

test("the mitre is bounded, so a hairpin gets a corner and not a spike", () => {
  const hairpin = [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 0, y: 0, z: 0.01 },
  ];
  const frame = stationFrame(hairpin, 1, 2);
  assert.ok(Math.hypot(frame[0], frame[1]) <= 2 + 1e-6, `${frame}`);
});

test("the ends read the one direction they have", () => {
  const line = [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 4, y: 0, z: 4 },
  ];
  // Compared componentwise: a zero component can come out negative, and -0
  // is not 0 to a strict deep comparison.
  const close = (frame, expected) => {
    assert.ok(Math.abs(frame[0] - expected[0]) < 1e-9, `${frame} vs ${expected}`);
    assert.ok(Math.abs(frame[1] - expected[1]) < 1e-9, `${frame} vs ${expected}`);
  };
  close(stationFrame(line, 0, 4), [0, 1]);
  close(stationFrame(line, 2, 4), [-1, 0]);
});

test("the rim walks the outside once and closes", () => {
  const boundary = sweptBoundary(3, 3);
  // First column down, last station across, last column back, first station in.
  assert.deepEqual(boundary, [0, 3, 6, 7, 8, 5, 2, 1]);
  assert.equal(new Set(boundary).size, boundary.length, "no vertex twice");

  // Every interior vertex stays out of it: with three slots the middle column
  // is the spine, and only its two ends are on the rim.
  const interior = [4];
  for (const index of interior) assert.ok(!boundary.includes(index));
});

test("the rim the sweep reports is exactly the rim of the faces it built", () => {
  const plan = sweepFormation(
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    FLAT,
    4,
  );
  // Count how often each undirected vertex pair is used by a quad; the pairs
  // used once are the rim, and they must be the ones the walk names.
  const uses = new Map();
  for (const quad of plan.quads) {
    for (const [index, start] of quad.entries()) {
      const end = quad[(index + 1) % quad.length];
      const key = [start, end].sort((l, r) => l - r).join("~");
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const rim = new Set([...uses].filter(([, count]) => count === 1).map(([key]) => key));
  const walked = new Set(
    plan.boundary.map((start, index) =>
      [start, plan.boundary[(index + 1) % plan.boundary.length]].sort((l, r) => l - r).join("~"),
    ),
  );
  assert.deepEqual(walked, rim);
});

test("a station repeated at one spot is dropped, never resampled", () => {
  const held = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
  ];
  assert.equal(withoutCoincidentStations(held).length, 2);
  // And nothing is ever added: the caller decides where stations go.
  assert.equal(withoutCoincidentStations(along([[0, 0], [9, 0]])).length, 2);
});

test("a sweep refuses what it cannot make sense of", () => {
  const line = [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
  ];
  assert.throws(() => sweepFormation(line, FLAT, 0.5), SweepFormationError);
  assert.throws(() => sweepFormation(line, [{ lateralOffset: 0, elevation: 0 }], 4), SweepFormationError);
  assert.throws(
    () => sweepFormation(line, [...FLAT].reverse(), 4),
    SweepFormationError,
    "a profile has to run left to right",
  );
  assert.throws(
    () => sweepFormation([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], FLAT, 4),
    SweepFormationError,
  );
});
