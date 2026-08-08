import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_MODULE_NAME,
  MODULE_FACES,
  SOCKET,
  STARTING_COMPATIBILITY,
  STARTING_TILESET,
  edgeProfile,
  flattenCompatibility,
  flattenModules,
  moduleMesh,
  rotateUnitCell,
} from "../src/vtt/terrain-modules.ts";

const CORNER_UV = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

test("one turn sends the unit cell's edge i to edge i+1", () => {
  // The property the whole rotation feature rests on: the crate moves the
  // socket on face i to face i+1, so the geometry must move the same way or a
  // solved map's shape stops matching the constraints that produced it.
  const midpoints = [
    { u: 0.5, v: 0 }, // bottom, edge 0
    { u: 1, v: 0.5 }, // right, edge 1
    { u: 0.5, v: 1 }, // top, edge 2
    { u: 0, v: 0.5 }, // left, edge 3
  ];
  midpoints.forEach((point, edge) => {
    const turned = rotateUnitCell(point.u, point.v, 1);
    const expected = midpoints[(edge + 1) % 4];
    assert.ok(
      Math.abs(turned.u - expected.u) < 1e-12 && Math.abs(turned.v - expected.v) < 1e-12,
      `edge ${edge} went to ${JSON.stringify(turned)}, expected edge ${(edge + 1) % 4}`,
    );
  });
});

test("four turns is the identity, and turns wrap in both directions", () => {
  const point = { u: 0.3, v: 0.8 };
  [0, 4, 8, -4].forEach((turns) => {
    const turned = rotateUnitCell(point.u, point.v, turns);
    assert.ok(Math.abs(turned.u - point.u) < 1e-12 && Math.abs(turned.v - point.v) < 1e-12);
  });
  assert.deepEqual(rotateUnitCell(0, 0, -1), rotateUnitCell(0, 0, 3));
});

test("rotating carries a corner's height with it", () => {
  // A ramp turned once must be a ramp facing the next way round, not a ramp
  // with its heights left behind.
  const ramp = STARTING_TILESET.find((module) => module.name === "ramp");
  const turned = moduleMesh(ramp, 1);
  CORNER_UV.forEach(([u, v], corner) => {
    const expected = rotateUnitCell(u, v, 1);
    const vertex = turned.vertices[corner];
    assert.ok(Math.abs(vertex.u - expected.u) < 1e-12, `corner ${corner} u`);
    assert.ok(Math.abs(vertex.v - expected.v) < 1e-12, `corner ${corner} v`);
    assert.equal(vertex.height, ramp.corners[corner], `corner ${corner} height`);
  });
});

test("a module's mesh is a top quad plus a closing skirt", () => {
  const mesh = moduleMesh(STARTING_TILESET[0], 0);
  assert.equal(mesh.vertices.length, 4 + 4 * 4, "four top corners, four skirt quads");
  assert.equal(mesh.indices.length, (1 + 4) * 6, "five quads, two triangles each");
  assert.ok(
    [...mesh.indices].every((index) => index < mesh.vertices.length),
    "every index must address a vertex",
  );
});

test("a module missing a corner height is refused rather than rendered as a hole", () => {
  assert.throws(
    () => moduleMesh({ ...STARTING_TILESET[0], corners: [1, 1, 1] }, 0),
    RangeError,
  );
});

test("the starting tileset's sockets describe its corner heights", () => {
  // The starting set is meant to be geometrically continuous, so every
  // departure a user then sees is one they made. Sockets are authored, not
  // derived, so nothing but this test keeps the two in step.
  const label = ([from, to]) => {
    if (from === to) return from === 1 ? SOCKET.HIGH : SOCKET.LOW;
    return to > from ? SOCKET.RISE : SOCKET.FALL;
  };
  // `empty` is exempt: its lateral sockets say "this face is exposed", which is
  // a fact about the neighbourhood rather than about any corner height. Nothing
  // is drawn for it either way.
  STARTING_TILESET.filter((module) => module.visible).forEach((module) => {
    for (let face = 0; face < 4; face += 1) {
      assert.equal(
        module.sockets[face],
        label(edgeProfile(module, face)),
        `module "${module.name}" face ${face} is labelled inconsistently with its corners`,
      );
    }
  });
});

test("rise only meets fall, so two ramps cannot climb the same way", () => {
  const meets = (a, b) =>
    STARTING_COMPATIBILITY.some(
      ([left, right]) => (left === a && right === b) || (left === b && right === a),
    );
  assert.ok(meets(SOCKET.RISE, SOCKET.FALL));
  assert.ok(!meets(SOCKET.RISE, SOCKET.RISE), "a cliff would open between them");
  assert.ok(!meets(SOCKET.FALL, SOCKET.FALL));
  assert.ok(!meets(SOCKET.HIGH, SOCKET.LOW), "a flat top cannot meet a flat floor");
});

test("all-flat is a solution, so the starting tileset cannot be unsatisfiable", () => {
  const flat = STARTING_TILESET.find((module) => module.name === "flat");
  const meets = (a, b) =>
    STARTING_COMPATIBILITY.some(
      ([left, right]) => (left === a && right === b) || (left === b && right === a),
    );
  for (let face = 0; face < 4; face += 1) {
    assert.ok(meets(flat.sockets[face], flat.sockets[(face + 2) % 4]), `flat face ${face}`);
  }
  assert.ok(meets(flat.sockets[4], flat.sockets[5]), "a flat cell must stack on a flat cell");
});

test("flattening produces the arrays the wasm boundary takes", () => {
  const { sockets, weights } = flattenModules(STARTING_TILESET);
  assert.equal(sockets.length, STARTING_TILESET.length * MODULE_FACES);
  assert.equal(weights.length, STARTING_TILESET.length);
  assert.deepEqual([...sockets.slice(0, MODULE_FACES)], [...STARTING_TILESET[0].sockets]);

  const compatible = flattenCompatibility(STARTING_COMPATIBILITY);
  assert.equal(compatible.length, STARTING_COMPATIBILITY.length * 2);
  assert.deepEqual([...compatible.slice(0, 2)], [...STARTING_COMPATIBILITY[0]]);
});

test("a malformed module is named rather than sent across the boundary", () => {
  const broken = { ...STARTING_TILESET[0], sockets: [0, 0, 0, 0] };
  assert.throws(() => flattenModules([broken]), /flat.*4 faces/s);
  assert.throws(() => flattenModules([{ ...STARTING_TILESET[0], weight: 0 }]), /flat/);
  assert.throws(() => flattenModules([{ ...STARTING_TILESET[0], weight: NaN }]), /flat/);
});

test("the tileset carries an empty module for air to be pinned to", () => {
  const empty = STARTING_TILESET.find((module) => module.name === EMPTY_MODULE_NAME);
  assert.ok(empty, "air has nothing to be pinned to without it");
  assert.equal(empty.visible, false, "air must draw nothing");
  for (let face = 0; face < 4; face += 1) assert.equal(empty.sockets[face], SOCKET.AIR);
});

test("air may be a cliff face but may not close a hollow", () => {
  const meets = (a, b) =>
    STARTING_COMPATIBILITY.some(
      ([left, right]) => (left === a && right === b) || (left === b && right === a),
    );
  // Keeps all-`flat` a solution however the terrain steps, so the starting
  // tileset stays satisfiable now that exposed faces are constrained at all.
  assert.ok(meets(SOCKET.AIR, SOCKET.HIGH));
  assert.ok(meets(SOCKET.AIR, SOCKET.AIR));
  // A depression open on one side is not a depression.
  assert.ok(!meets(SOCKET.AIR, SOCKET.LOW));
});

test("the skirt drops to where it is told, not always to the cell floor", () => {
  const flat = STARTING_TILESET.find((module) => module.name === "flat");
  const shallow = moduleMesh(flat, 0);
  const deep = moduleMesh(flat, 0, { skirtBottom: -3 });

  assert.equal(Math.min(...shallow.vertices.map((vertex) => vertex.height)), 0);
  assert.equal(Math.min(...deep.vertices.map((vertex) => vertex.height)), -3);
  // Only the skirt moves: the top surface is still the corner profile.
  assert.deepEqual(
    deep.vertices.slice(0, 4).map((vertex) => vertex.height),
    shallow.vertices.slice(0, 4).map((vertex) => vertex.height),
  );
  assert.deepEqual(deep.indices, shallow.indices);
});
