import assert from "node:assert/strict";
import test from "node:test";

import { buildIrregularQuadGrid } from "../src/vtt/irregular-grid.ts";
import { buildTransitionTerrain, cornerOccupancy } from "../src/vtt/transition-shapes.ts";

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

const LEVEL_HEIGHT = 0.25;
const BASE = -0.6;

function triangles(terrain, indices) {
  const result = [];
  for (let at = 0; at + 2 < indices.length; at += 3) {
    result.push(
      [indices[at], indices[at + 1], indices[at + 2]].map((index) => ({
        x: terrain.positions[index * 3],
        y: terrain.positions[index * 3 + 1],
        z: terrain.positions[index * 3 + 2],
      })),
    );
  }
  return result;
}

function normalOf([a, b, c]) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const size = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / size, y: ny / size, z: nz / size };
}

test("a corner takes the highest level of the cells meeting at it", () => {
  const occupancy = cornerOccupancy(twoCells, [1, 3]);
  // Vertices 1 and 2 are shared; the taller cell wins there.
  assert.equal(occupancy.topLayer(0), 1);
  assert.equal(occupancy.topLayer(1), 3);
  assert.equal(occupancy.topLayer(2), 3);
  assert.equal(occupancy.topLayer(3), 1);
  assert.equal(occupancy.topLayer(4), 3);
});

test("occupancy is solid from layer zero up to the corner's top layer", () => {
  const occupancy = cornerOccupancy(twoCells, [2, 2]);
  assert.equal(occupancy.filled(0, 0), true);
  assert.equal(occupancy.filled(0, 2), true);
  assert.equal(occupancy.filled(0, 3), false);
  assert.equal(occupancy.filled(0, -1), false);
  assert.equal(occupancy.layerCount, 3);
});

test("a flat plateau lands on the same height stage two would give it", () => {
  const terrain = buildTransitionTerrain(twoCells, [2, 2], {
    levelHeight: LEVEL_HEIGHT,
    baseHeight: BASE,
  });
  const tops = triangles(terrain, terrain.topIndices);
  assert.ok(tops.length > 0);
  for (const triangle of tops) {
    for (const point of triangle) {
      assert.ok(
        Math.abs(point.y - 2 * LEVEL_HEIGHT) < 1e-6,
        `expected the plateau at y=${2 * LEVEL_HEIGHT}, got ${point.y}`,
      );
    }
  }
});

test("a flat plateau's top faces straight up", () => {
  const terrain = buildTransitionTerrain(twoCells, [2, 2], { levelHeight: LEVEL_HEIGHT });
  for (const triangle of triangles(terrain, terrain.topIndices)) {
    assert.ok(normalOf(triangle).y > 0.999);
  }
});

test("a step between neighbours comes out chamfered, not vertical", () => {
  const terrain = buildTransitionTerrain(twoCells, [0, 3], {
    levelHeight: LEVEL_HEIGHT,
    baseHeight: BASE,
  });
  // The transition is a ramp, so most of it faces upward and is classified as
  // top; the split is for shading, not for finding it.
  const surface = [
    ...triangles(terrain, terrain.topIndices),
    ...triangles(terrain, terrain.sideIndices),
  ];
  assert.ok(surface.length > 0, "a difference in level must produce a surface");

  // This is the whole point of the stage: stage 2 emits only exactly-vertical
  // and exactly-flat faces here, so a slanted one proves the corner-column
  // model is in effect.
  const slanted = surface.filter((triangle) => {
    const up = Math.abs(normalOf(triangle).y);
    return up > 1e-3 && up < 0.999;
  });
  assert.ok(slanted.length > 0, "expected at least one slanted transition triangle");
});

test("equal neighbours produce no transition surface between them", () => {
  const terrain = buildTransitionTerrain(twoCells, [2, 2], { levelHeight: LEVEL_HEIGHT });
  // Interior faces between two equally solid cells are not on the boundary of
  // the union, so nothing should be emitted and then buried.
  for (const triangle of triangles(terrain, terrain.sideIndices)) {
    assert.ok(Math.abs(normalOf(triangle).y) < 0.999);
  }
  assert.equal(terrain.sideIndices.length, 0);
});

test("the skirt closes the grid's open rim down to the base", () => {
  const terrain = buildTransitionTerrain(twoCells, [2, 2], {
    levelHeight: LEVEL_HEIGHT,
    baseHeight: BASE,
  });
  const skirt = triangles(terrain, terrain.skirtIndices);
  assert.ok(skirt.length > 0);

  const lowest = Math.min(...skirt.flat().map((point) => point.y));
  assert.ok(Math.abs(lowest - BASE) < 1e-6, `skirt should reach ${BASE}, reached ${lowest}`);
  for (const triangle of skirt) {
    assert.ok(Math.abs(normalOf(triangle).y) < 1e-6, "the skirt must be vertical");
  }
});

test("every surface edge is shared, except along the base the skirt hangs from", () => {
  const grid = buildIrregularQuadGrid({ trianglesPerSide: 3, triangleSide: 0.5, seed: 7 });
  const levels = grid.quads.map((_, cell) => cell % 4);
  const terrain = buildTransitionTerrain(grid, levels, {
    levelHeight: LEVEL_HEIGHT,
    baseHeight: BASE,
  });

  const key = (point) =>
    `${Math.round(point.x * 1e5)}:${Math.round(point.y * 1e5)}:${Math.round(point.z * 1e5)}`;
  const uses = new Map();
  const all = [
    ...triangles(terrain, terrain.topIndices),
    ...triangles(terrain, terrain.sideIndices),
    ...triangles(terrain, terrain.skirtIndices),
  ];
  for (const triangle of all) {
    for (let edge = 0; edge < 3; edge += 1) {
      const from = key(triangle[edge]);
      const to = key(triangle[(edge + 1) % 3]);
      const id = from < to ? `${from}|${to}` : `${to}|${from}`;
      uses.set(id, (uses.get(id) ?? 0) + 1);
    }
  }

  // An unshared edge is a hole. Two are legitimate: the open underside, which
  // stage 2 leaves open too, and a purely vertical rim edge, which is a slit of
  // zero width that the skirt deliberately does not try to fill.
  const holes = [...uses.entries()].filter(([, count]) => count !== 2);
  for (const [id] of holes) {
    const corners = id.split("|").map((corner) => corner.split(":").map(Number));
    const onBase = corners.every(([, height]) => Math.abs(height / 1e5 - BASE) < 1e-6);
    const vertical = corners[0][0] === corners[1][0] && corners[0][2] === corners[1][2];
    assert.ok(onBase || vertical, `unshared edge that is neither on the base nor vertical: ${id}`);
  }
});

test("no triangle is degenerate", () => {
  const grid = buildIrregularQuadGrid({ trianglesPerSide: 3, triangleSide: 0.5, seed: 11 });
  const levels = grid.quads.map((_, cell) => cell % 3);
  const terrain = buildTransitionTerrain(grid, levels, { levelHeight: LEVEL_HEIGHT });

  for (const indices of [terrain.topIndices, terrain.sideIndices, terrain.skirtIndices]) {
    for (const triangle of triangles(terrain, indices)) {
      const normal = normalOf(triangle);
      assert.ok(Number.isFinite(normal.x) && Math.hypot(normal.x, normal.y, normal.z) > 0.5);
    }
  }
});

test("flat terrain has no transition surface at all", () => {
  const grid = buildIrregularQuadGrid({ trianglesPerSide: 3, triangleSide: 0.5, seed: 3 });
  const terrain = buildTransitionTerrain(
    grid,
    grid.quads.map(() => 1),
    { levelHeight: LEVEL_HEIGHT },
  );
  assert.equal(terrain.sideIndices.length, 0);
  assert.ok(terrain.topIndices.length > 0);
  assert.ok(terrain.skirtIndices.length > 0);
});

test("the same grid and levels always produce the same mesh", () => {
  const grid = buildIrregularQuadGrid({ trianglesPerSide: 3, triangleSide: 0.5, seed: 5 });
  const levels = grid.quads.map((_, cell) => cell % 5);
  const first = buildTransitionTerrain(grid, levels, { levelHeight: LEVEL_HEIGHT });
  const second = buildTransitionTerrain(grid, levels, { levelHeight: LEVEL_HEIGHT });
  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.topIndices, second.topIndices);
  assert.deepEqual(first.skirtIndices, second.skirtIndices);
});
