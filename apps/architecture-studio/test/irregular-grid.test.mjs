import assert from "node:assert/strict";
import test from "node:test";

import {
  boundaryVertices,
  buildIrregularQuadGrid,
  buildTriangleHex,
  createRandom,
  ortho,
  pairTriangles,
  relax,
  weld,
} from "../src/vtt/irregular-grid.ts";

const hex = () => buildTriangleHex({ trianglesPerSide: 4, triangleSide: 0.5 });

test("the triangle hexagon is built from equilateral triangles only", () => {
  const mesh = hex();

  assert.ok(mesh.faces.length > 0);
  for (const face of mesh.faces) {
    assert.equal(face.length, 3);
    const [a, b, c] = face.map((index) => mesh.vertices[index]);
    const sides = [distance(a, b), distance(b, c), distance(c, a)];
    for (const side of sides) {
      assert.ok(Math.abs(side - 0.5) < 1e-9, `side was ${side}, expected 0.5`);
    }
  }
});

test("the hexagon holds the triangle count its side length implies", () => {
  // A hexagon of side n triangles is six n-triangle-per-side equilateral
  // triangles, each holding n^2 lattice triangles: 6 * n^2.
  for (const perSide of [2, 3, 4]) {
    const mesh = buildTriangleHex({ trianglesPerSide: perSide, triangleSide: 0.5 });
    assert.equal(mesh.faces.length, 6 * perSide * perSide, `perSide ${perSide}`);
  }
});

test("pairing leaves only triangles and rhombi, and merges at least some", () => {
  const paired = pairTriangles(hex(), createRandom(7));

  const sizes = new Set(paired.faces.map((face) => face.length));
  for (const size of sizes) assert.ok(size === 3 || size === 4, `unexpected face size ${size}`);
  assert.ok(
    paired.faces.some((face) => face.length === 4),
    "the step exists to create rhombi; none appeared",
  );
  assert.ok(paired.faces.length < hex().faces.length, "merging must reduce the face count");
});

test("ortho makes every face a quad, whatever the pairing left behind", () => {
  // The property that lets pairing be aesthetic rather than structural: a
  // triangle that never found a partner still ends up as quads.
  const triangleOnly = { vertices: hex().vertices, faces: hex().faces };
  const quads = ortho(triangleOnly);

  for (const quad of quads.quads) assert.equal(quad.length, 4);
  assert.equal(quads.quads.length, triangleOnly.faces.length * 3, "a triangle yields three quads");
});

test("ortho yields four quads per rhombus", () => {
  const rhombus = {
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1.5, y: 1 },
      { x: 0.5, y: 1 },
    ],
    faces: [[0, 1, 2, 3]],
  };

  assert.equal(ortho(rhombus).quads.length, 4);
});

test("welding unifies the duplicate midpoints ortho emitted per face", () => {
  const before = ortho(pairTriangles(hex(), createRandom(3)));
  const after = weld(before);

  assert.ok(
    after.vertices.length < before.vertices.length,
    "shared edge midpoints must collapse into one vertex each",
  );
  assert.equal(after.quads.length, before.quads.length, "welding must not drop cells");

  // Every quad must still reference four distinct, in-range vertices.
  for (const quad of after.quads) {
    assert.equal(new Set(quad).size, 4);
    for (const index of quad) {
      assert.ok(index >= 0 && index < after.vertices.length, `index ${index} out of range`);
    }
  }
});

test("relaxation makes cells more square without collapsing the mesh", () => {
  const welded = weld(ortho(pairTriangles(hex(), createRandom(11))));
  const relaxed = relax(welded, { iterations: 12 });

  assert.ok(
    squareness(relaxed) < squareness(welded),
    "cells must be closer to square after relaxing",
  );
  assert.equal(relaxed.quads.length, welded.quads.length);
  for (const vertex of relaxed.vertices) {
    assert.ok(Number.isFinite(vertex.x) && Number.isFinite(vertex.y), "relaxation diverged");
  }
});

test("pinned boundary vertices do not move", () => {
  const welded = weld(ortho(pairTriangles(hex(), createRandom(5))));
  const boundary = boundaryVertices(welded);
  const relaxed = relax(welded, { iterations: 20 });

  assert.ok(boundary.size > 0, "a single chunk must have a boundary");
  for (const index of boundary) {
    assert.deepEqual(relaxed.vertices[index], welded.vertices[index]);
  }
});

test("the same seed always produces the same grid", () => {
  // The map is replicated authoritative state, so two hosts generating the
  // same chunk must agree vertex for vertex.
  const options = { trianglesPerSide: 3, triangleSide: 0.5, seed: 1234 };
  const a = buildIrregularQuadGrid(options);
  const b = buildIrregularQuadGrid(options);

  assert.deepEqual(a.quads, b.quads);
  assert.deepEqual(a.vertices, b.vertices);
});

test("different seeds produce different grids", () => {
  const a = buildIrregularQuadGrid({ trianglesPerSide: 3, triangleSide: 0.5, seed: 1 });
  const b = buildIrregularQuadGrid({ trianglesPerSide: 3, triangleSide: 0.5, seed: 2 });

  assert.notDeepEqual(a.quads, b.quads, "the pairing is what varies; it must actually vary");
});

test("the finished grid is all quads and every cell has area", () => {
  const grid = buildIrregularQuadGrid({ trianglesPerSide: 4, triangleSide: 0.5, seed: 99 });

  assert.ok(grid.quads.length > 0);
  for (const quad of grid.quads) {
    assert.equal(quad.length, 4);
    const corners = quad.map((index) => grid.vertices[index]);
    assert.ok(Math.abs(signedArea(corners)) > 1e-9, "a zero-area cell reached the output");
  }
});

test("the finished grid keeps a consistent winding", () => {
  // A cell wound the other way survives every later stage and only shows up
  // as a backwards-facing surface once something is rendered.
  const grid = buildIrregularQuadGrid({ trianglesPerSide: 4, triangleSide: 0.5, seed: 42 });
  const areas = grid.quads.map((quad) => signedArea(quad.map((index) => grid.vertices[index])));

  const positive = areas.filter((area) => area > 0).length;
  assert.ok(
    positive === areas.length || positive === 0,
    `winding is mixed: ${positive} of ${areas.length} cells wound one way`,
  );
});

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function signedArea(corners) {
  let total = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const current = corners[i];
    const next = corners[(i + 1) % corners.length];
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2;
}

/** Mean deviation from a right angle across every corner. Lower is more square. */
function squareness(mesh) {
  let total = 0;
  let count = 0;
  for (const quad of mesh.quads) {
    const corners = quad.map((index) => mesh.vertices[index]);
    for (let i = 0; i < 4; i += 1) {
      const previous = corners[(i + 3) % 4];
      const current = corners[i];
      const next = corners[(i + 1) % 4];
      const a = Math.atan2(previous.y - current.y, previous.x - current.x);
      const b = Math.atan2(next.y - current.y, next.x - current.x);
      let angle = Math.abs(a - b) % (Math.PI * 2);
      if (angle > Math.PI) angle = Math.PI * 2 - angle;
      total += Math.abs(angle - Math.PI / 2);
      count += 1;
    }
  }
  return total / count;
}
