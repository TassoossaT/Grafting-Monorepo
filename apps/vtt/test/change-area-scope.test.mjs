import assert from "node:assert/strict";
import test from "node:test";

import { dispatchEffects } from "../src/composition/tabletop/effects/effect-commit.ts";
import { changeAreaOf } from "../src/composition/tabletop/effects/change-area.ts";
import { shapeChangeOfReplacement } from "../src/composition/tabletop/effects/shape-change.ts";
import { latticeRegenerateReaction } from "../src/composition/tabletop/terrain/terrain-lattice-reaction.ts";
import { planarPort } from "./engine-planar.mjs";

/**
 * An edit is scoped by where its shape went, never by what it rebuilt.
 *
 * A spine type regenerates its whole connected component on every edit, so
 * the faces it produces -- and any outline a type builds from them -- name the
 * entire network. Scoping ground's repair by that rebuilt every metre of
 * terrain along the network on each drag, and every rebuild came back finer
 * against the road's contour, so each edit made the next heavier.
 */

function faceFrom(key, type, corners) {
  return {
    surfaceKey: ["@region", key],
    surfaceType: type,
    physical: true,
    nodes: corners.map(([id, x, z]) => ({ id, position: { x, y: 0, z } })),
    outerLoops: [corners.map(([id], index) => ({ edgeId: `e:${key}:${index}`, reversed: false, startNodeId: id, endNodeId: corners[(index + 1) % corners.length][0], geometry: { kind: "line" } }))],
    holes: [],
  };
}

function patchOf(faces) {
  const nodes = new Map();
  const edges = [];
  const regions = [];
  for (const face of faces) {
    for (const node of face.nodes) nodes.set(node.id, node);
    const loop = face.outerLoops[0];
    for (const use of loop) edges.push({ edgeId: use.edgeId, startNodeId: use.startNodeId, endNodeId: use.endNodeId });
    regions.push({ regionId: face.surfaceKey[1], surfaceType: face.surfaceType, boundary: loop.map((use) => ({ edgeId: use.edgeId, reversed: false })) });
  }
  return { nodes: [...nodes.values()], edges, regions };
}

// A long road of two spans: the first untouched, the far end of the second
// dragged sideways.
const spanA = faceFrom("A", "path", [["a0", 0, 0], ["a1", 2, 0], ["a2", 2, 30], ["a3", 0, 30]]);
const spanB = faceFrom("B", "path", [["a3", 0, 30], ["a2", 2, 30], ["b2", 2, 40], ["b3", 0, 40]]);
const movedB = faceFrom("B2", "path", [["a3", 0, 30], ["a2", 2, 30], ["m2", 5, 40], ["m3", 3, 40]]);

const besideUntouched = faceFrom("T_A", "terrain", [["ta0", 2, 0], ["ta1", 4, 0], ["ta2", 4, 20], ["ta3", 2, 20]]);
const besideMoved = faceFrom("T_B", "terrain", [["tb0", 2, 32], ["tb1", 4, 32], ["tb2", 4, 40], ["tb3", 2, 40]]);

function runtimeOver(terrain) {
  const positions = new Map();
  for (const face of [spanA, spanB, movedB, ...terrain]) for (const node of face.nodes) positions.set(node.id, { position: node.position });
  return {
    planarBoolean: planarPort.planarBoolean,
    getAllRegionTopologies: () => terrain,
    getSnapshot: () => ({ tableId: "tbl-scope", map: { nodePositions: positions } }),
  };
}

test("the claimed and vacated ground of an edit is only where its shape moved", () => {
  const area = changeAreaOf(planarPort, { before: [spanA, spanB], after: [spanA, movedB] });
  assert.ok(area !== undefined, "the engine's boolean answers");
  const zs = [...area.claimed, ...area.vacated].flatMap((piece) => piece[0].map(([, z]) => z));
  assert.ok(zs.length > 0, "the dragged end moved somewhere");
  assert.ok(Math.min(...zs) >= 30 - 1e-6, `nothing along the untouched span counts as changed; lowest z ${Math.min(...zs)}`);
});

test("an edit whose type names the whole component still repairs only the ground beside what moved", () => {
  let fallout;
  const runtime = runtimeOver([besideUntouched, besideMoved]);
  const change = shapeChangeOfReplacement(runtime, {
    operationId: "op:drag",
    sourceSurfaceKeys: [spanA.surfaceKey, spanB.surfaceKey],
    patch: patchOf([spanA, movedB]),
    // What a type regenerating its component hands over: the whole network.
    footprintOutline: [[0, 0], [5, 0], [5, 40], [0, 40]],
  }, [spanA, spanB], undefined);
  dispatchEffects(runtime, [{ kind: "cut", causeId: "cause:drag", change }], {
    "lattice-regenerate": latticeRegenerateReaction((_runtime, received) => { fallout = received; return 1; }),
  });

  assert.ok(fallout !== undefined, "the ground beside the dragged end is repaired");
  const consumed = fallout.consumedSurfaceKeys.map((key) => key.join("/"));
  assert.ok(consumed.includes("@region/T_B"), "ground the road moved onto is consumed");
  assert.ok(!consumed.includes("@region/T_A"), "ground beside the untouched span is left alone");
  assert.ok(fallout.footprintOutline.every(([, z]) => z >= 30 - 1e-6), "the footprint handed on is the moved area, not the type's");
});
