import assert from "node:assert/strict";
import test from "node:test";

import { settleMoves } from "../src/features/edit-construction/index.ts";

/**
 * Each type's own law, held by the one generic mechanism
 * (`orchestration/type-law.ts`) wherever a change moved its nodes: a floor
 * stays at one elevation, a straight ramp stays a symmetric trapezoid. No
 * tool or gesture re-implements either.
 */

const P = (x, y, z) => ({ x, y, z });
function face(key, surfaceType, corners, ids = corners.map((_, i) => `${key}:${i}`), edgeIds = ids.map((_, i) => `${key}:e${i}`)) {
  return {
    surfaceKey: ["@region", key],
    surfaceType,
    physical: true,
    nodes: ids.map((id, i) => ({ id, position: corners[i] })),
    outerLoops: [ids.map((id, i) => ({ edgeId: edgeIds[i], reversed: false, startNodeId: id, endNodeId: ids[(i + 1) % ids.length], geometry: { kind: "line" } }))],
    holes: [],
  };
}

test("a floor's law: one elevation -- the one the change placed; the rest of the face follows it", () => {
  const floor = face("f", "platform", [P(0, 0, 0), P(4, 0, 0), P(4, 0, 4), P(0, 0, 4)]);
  const settled = settleMoves([floor], new Map([["f:0", P(0, 2, 0)], ["f:1", P(4, 2, 0)]]), new Set(["f:0", "f:1"]));
  for (const id of ["f:2", "f:3"]) assert.equal(settled.get(id).y, 2, `${id} rose with it`);
  // Placed at two heights, nothing is settled: the type's validation judges it.
  const torn = settleMoves([floor], new Map([["f:0", P(0, 2, 0)], ["f:1", P(4, 1, 0)]]), new Set(["f:0", "f:1"]));
  assert.equal(torn.has("f:2"), false);
});

test("a straight ramp's law: a corner moved alone is mirrored by its twin across its end's centre, the axis kept", () => {
  // Ramp ids as `rampPatch` names them: ends bottom and top, sides min and max.
  const op = "r";
  const ids = [`${op}:ramp:bottom:min`, `${op}:ramp:bottom:max`, `${op}:ramp:top:max`, `${op}:ramp:top:min`];
  const edges = [`${op}:ramp:edge:bottom`, `${op}:ramp:edge:max`, `${op}:ramp:edge:top`, `${op}:ramp:edge:min`];
  const ramp = face("r", "platform-ramp", [P(0, 0, -1), P(0, 0, 1), P(6, 2, 1), P(6, 2, -1)], ids, edges);
  // The bottom's max corner pulled out to widen that end.
  const settled = settleMoves([ramp], new Map([[ids[1], P(0, 0, 1.5)]]), new Set([ids[1]]));
  const twin = settled.get(ids[0]);
  assert.ok(twin && Math.abs(twin.z + 1.5) < 1e-9 && Math.abs(twin.x) < 1e-9, `the twin mirrored it: ${JSON.stringify(twin)}`);
  assert.equal(settled.has(ids[2]), false, "the top end kept");
});
