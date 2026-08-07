import assert from "node:assert/strict";
import test from "node:test";

import { buildIrregularQuadGrid } from "../src/vtt/irregular-grid.ts";
import {
  buildStackedTerrain,
  cellCentres,
  edgeNeighbours,
  sampleCellValues,
  sampleHeightfield,
} from "../src/vtt/stacked-terrain.ts";

/** Two unit cells side by side, sharing the edge from (1,0) to (1,1). */
const twoCells = {
  vertices: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
  ],
  quads: [
    [0, 1, 2, 3],
    [1, 4, 5, 2],
  ],
};

const field = {
  width: 2,
  height: 2,
  values: new Float32Array([0, 1, 1, 0]),
};

test("sampling returns the stored value at each corner", () => {
  assert.equal(sampleHeightfield(field, 0, 0), 0);
  assert.equal(sampleHeightfield(field, 1, 0), 1);
  assert.equal(sampleHeightfield(field, 0, 1), 1);
  assert.equal(sampleHeightfield(field, 1, 1), 0);
});

test("sampling interpolates between corners rather than snapping", () => {
  // Nearest-neighbour would land two adjacent cells on one sample and flatten
  // a step that should exist.
  assert.equal(sampleHeightfield(field, 0.5, 0.5), 0.5);
  assert.equal(sampleHeightfield(field, 0.5, 0), 0.5);
});

test("sampling outside the field clamps instead of reading past the end", () => {
  assert.equal(sampleHeightfield(field, -5, -5), 0);
  assert.equal(sampleHeightfield(field, 5, 5), 0);
  assert.ok(Number.isFinite(sampleHeightfield({ width: 0, height: 0, values: new Float32Array() }, 0.5, 0.5)));
});

test("cell centres and extent describe the whole grid", () => {
  const { centres, min, max } = cellCentres(twoCells);

  assert.deepEqual(centres, [
    { x: 0.5, y: 0.5 },
    { x: 1.5, y: 0.5 },
  ]);
  assert.deepEqual(min, { x: 0.5, y: 0.5 });
  assert.deepEqual(max, { x: 1.5, y: 0.5 });
});

test("one sampled value is produced per cell, in cell order", () => {
  const values = sampleCellValues(twoCells, field);

  assert.equal(values.length, twoCells.quads.length);
  for (const value of values) assert.ok(Number.isFinite(value));
});

test("edge neighbours find the shared edge and leave boundary edges alone", () => {
  const map = edgeNeighbours(twoCells);
  const shared = map.get("1:2");

  assert.deepEqual(shared?.slice().sort(), [0, 1], "the shared edge belongs to both cells");
  const boundaryCounts = [...map.values()].filter((owners) => owners.length === 1).length;
  assert.equal(boundaryCounts, 6, "six of the seven edges are on the boundary");
});

test("cell tops face upward", () => {
  // A top wound the other way is invisible from above and only shows up once
  // something is rendered.
  const terrain = buildStackedTerrain(twoCells, [1, 1]);

  for (const normal of triangleNormals(terrain.positions, terrain.topIndices)) {
    assert.ok(normal.y > 0.99, `top normal pointed ${JSON.stringify(normal)}`);
  }
});

test("walls face away from the cell that owns them", () => {
  const terrain = buildStackedTerrain(twoCells, [2, 0]);
  const normals = triangleNormals(terrain.positions, terrain.wallIndices);

  assert.ok(normals.length > 0, "a two-level difference must produce walls");
  for (const normal of normals) {
    assert.ok(Math.abs(normal.y) < 1e-6, "a wall must be vertical");
  }

  // The wall on the shared edge belongs to the taller cell, whose centre is at
  // x = 0.5, so it must face +x.
  const shared = trianglesAt(terrain, 1).map((triangle) => triangle.normal);
  assert.ok(shared.length > 0, "the step between the cells must be closed");
  for (const normal of shared) {
    assert.ok(normal.x > 0.99, `shared-edge wall faced ${JSON.stringify(normal)}`);
  }
});

test("no wall is emitted between cells at the same level", () => {
  const flat = buildStackedTerrain(twoCells, [1, 1]);
  const stepped = buildStackedTerrain(twoCells, [2, 1]);

  // Only the six boundary edges produce walls when the interior is flat.
  assert.equal(flat.wallIndices.length / 6, 6);
  assert.equal(
    stepped.wallIndices.length / 6,
    7,
    "the interior step adds exactly one wall, not two",
  );
});

test("a cell at level zero still walls down to the base at the boundary", () => {
  const terrain = buildStackedTerrain(twoCells, [0, 0], { baseHeight: -1 });

  assert.ok(terrain.wallIndices.length > 0);
  const lowest = Math.min(...verticalPositions(terrain.positions));
  assert.equal(lowest, -1);
});

test("level height scales the terrain and nothing else", () => {
  const thin = buildStackedTerrain(twoCells, [3, 0], { levelHeight: 0.1 });
  const thick = buildStackedTerrain(twoCells, [3, 0], { levelHeight: 0.2 });

  assert.equal(thin.topIndices.length, thick.topIndices.length);
  assert.equal(Math.max(...verticalPositions(thin.positions)) * 2, Math.max(...verticalPositions(thick.positions)));
});

test("a real grid produces closed, finite terrain", () => {
  const grid = buildIrregularQuadGrid({ trianglesPerSide: 3, triangleSide: 0.5, seed: 21 });
  const levels = Array.from({ length: grid.quads.length }, (_, index) => index % 4);
  const terrain = buildStackedTerrain(grid, levels);

  assert.equal(terrain.topIndices.length / 6, grid.quads.length, "every cell gets a top");
  for (const value of terrain.positions) assert.ok(Number.isFinite(value));
  for (const index of [...terrain.topIndices, ...terrain.wallIndices]) {
    assert.ok(index * 3 < terrain.positions.length, `index ${index} is out of range`);
  }
});

function triangleNormals(positions, indices) {
  const normals = [];
  for (let i = 0; i < indices.length; i += 3) {
    normals.push(normalOf(positions, indices[i], indices[i + 1], indices[i + 2]));
  }
  return normals;
}

/** Wall triangles whose midpoint sits on the shared edge at the given x. */
function trianglesAt(terrain, x) {
  const found = [];
  for (let i = 0; i < terrain.wallIndices.length; i += 3) {
    const a = terrain.wallIndices[i];
    const b = terrain.wallIndices[i + 1];
    const c = terrain.wallIndices[i + 2];
    const xs = [a, b, c].map((index) => terrain.positions[index * 3]);
    if (xs.every((value) => Math.abs(value - x) < 1e-6)) {
      found.push({ normal: normalOf(terrain.positions, a, b, c) });
    }
  }
  return found;
}

function normalOf(positions, a, b, c) {
  const point = (index) => ({
    x: positions[index * 3],
    y: positions[index * 3 + 1],
    z: positions[index * 3 + 2],
  });
  const p0 = point(a);
  const p1 = point(b);
  const p2 = point(c);
  const ux = p1.x - p0.x;
  const uy = p1.y - p0.y;
  const uz = p1.z - p0.z;
  const vx = p2.x - p0.x;
  const vy = p2.y - p0.y;
  const vz = p2.z - p0.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / length, y: ny / length, z: nz / length };
}

function verticalPositions(positions) {
  const heights = [];
  for (let i = 1; i < positions.length; i += 3) heights.push(positions[i]);
  return heights;
}
