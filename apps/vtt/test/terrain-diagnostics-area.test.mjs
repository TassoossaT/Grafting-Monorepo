import assert from "node:assert/strict";
import test from "node:test";

import { logTerrainCommit } from "../src/composition/tabletop/terrain/terrain-diagnostics.ts";

/**
 * The reading a hole is visible in.
 *
 * Every other number in the terrain log counts something that went wrong, and
 * a hole can happen with all of them at zero: each face laid is fine, there
 * are simply not enough of them to fill the area asked for. So the log has to
 * say how much ground it laid against how much it meant to -- and these hold
 * that arithmetic, because a number nobody can trust is worse than no number.
 */

/** A square ring of constraint points, side `side`, cornered at the origin. */
function square(side, offset = 0) {
  return {
    points: [
      { x: offset, z: offset },
      { x: offset + side, z: offset },
      { x: offset + side, z: offset + side },
      { x: offset, z: offset + side },
    ],
    edges: [],
  };
}

/** Captures the one line the diagnostic prints. */
function logged(report) {
  const lines = [];
  const warn = console.warn;
  const info = console.info;
  console.warn = (line) => lines.push(line);
  console.info = (line) => lines.push(line);
  try {
    logTerrainCommit(report);
  } finally {
    console.warn = warn;
    console.info = info;
  }
  assert.equal(lines.length, 1, "exactly one line describes a commit");
  return lines[0];
}

/** A report with nothing wrong, so each test varies only what it is about. */
function report(overrides) {
  return {
    what: "regeneração",
    faceSideAsked: 2,
    boundary: [square(10)],
    holes: [],
    grid: { vertices: [], quads: [], onContour: [], refinementComplete: true },
    adopted: 0,
    unadopted: 0,
    landings: 0,
    unstitched: 0,
    built: 0,
    refusedFaces: 0,
    refusals: [],
    declaredNodes: 0,
    ...overrides,
  };
}

test("ground laid against ground asked for is reported, holes discounted from the ask", () => {
  // A 10x10 boundary with a 4x4 hole asks for 100 - 16 = 84.
  const line = logged(report({ holes: [square(4, 3)], coveredArea: 84 }));

  assert.match(line, /área 84 de 84 pedida \(0% sem chão\)/);
});

test("ground missing from the area asked for is named as a percentage", () => {
  const line = logged(report({ coveredArea: 75 }));

  assert.match(line, /área 75 de 100 pedida \(25% sem chão\)/);
});

test("a commit that laid every metre it asked for is not warned about", () => {
  const warned = [];
  const warn = console.warn;
  console.warn = (line) => warned.push(line);
  try {
    // Segments of 10 against a face side of 2 keep the ratio above 2, so the
    // area is the only thing that could raise the alarm here.
    logTerrainCommit(report({ coveredArea: 100 }));
  } finally {
    console.warn = warn;
  }

  assert.deepEqual(warned, [], "nothing was wrong, so nothing was warned");
});

test("a tenth of the ground gone raises the alarm even with every other count at zero", () => {
  const warned = [];
  const warn = console.warn;
  console.warn = (line) => warned.push(line);
  try {
    logTerrainCommit(report({ coveredArea: 90 }));
  } finally {
    console.warn = warn;
  }

  assert.equal(warned.length, 1, "missing ground is a warning on its own");
});
