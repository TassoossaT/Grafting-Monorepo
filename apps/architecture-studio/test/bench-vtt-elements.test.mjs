import assert from "node:assert/strict";
import test from "node:test";

import { createBenchEvaluators } from "../src/bench/evaluators.ts";
import { toEvaluationPreview } from "../src/bench/preview.ts";
import { defaultParamValues } from "../src/bench/node-kind.ts";
import { findNodeKind } from "../src/bench/registry.ts";
import { quadAdjacency, normaliseWinding } from "../src/vtt/grid-adjacency.ts";

/** Bins into `levels` bands, enough for the pipeline to be exercised. */
const stubWasm = {
  generateHeightmap: (width, height, seed, scale) => {
    const values = new Float32Array(width * height);
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.sin((index + seed) * scale);
    }
    return values;
  },
  discretize: (values, levels) => {
    const indices = new Int32Array(values.length);
    for (let index = 0; index < values.length; index += 1) {
      const normalised = (values[index] + 1) / 2;
      indices[index] = Math.min(levels - 1, Math.max(0, Math.floor(normalised * levels)));
    }
    return indices;
  },
};

const evaluators = createBenchEvaluators(stubWasm);
const paramsOf = (id, overrides = {}) => ({ ...defaultParamValues(findNodeKind(id)), ...overrides });

const buildGrid = (overrides = {}) =>
  evaluators.get("grid.irregular")({}, paramsOf("grid.irregular", overrides));

const heightmap = (size = 16) => ({
  dataType: "heightmap",
  width: size,
  height: size,
  values: stubWasm.generateHeightmap(size, size, 1, 0.3),
});

test("the grid element produces a real irregular quad mesh", () => {
  const grid = buildGrid();
  assert.equal(grid.dataType, "quadmesh");
  assert.ok(grid.mesh.quads.length > 10, `only ${grid.mesh.quads.length} quads`);
  assert.ok(
    grid.mesh.quads.every((quad) => quad.length === 4),
    "every cell must be a quad",
  );
  assert.ok(
    grid.mesh.quads.every((quad) => quad.every((vertex) => vertex < grid.mesh.vertices.length)),
    "every index must address a vertex",
  );
});

test("the same seed gives the same grid, a different seed a different one", () => {
  // The bench caches on parameters, so an element that is not a function of
  // its parameters would serve a stale result and look like a bug elsewhere.
  assert.deepEqual(buildGrid({ seed: 5 }).mesh, buildGrid({ seed: 5 }).mesh);
  assert.notDeepEqual(buildGrid({ seed: 5 }).mesh, buildGrid({ seed: 6 }).mesh);
});

test("the grid it produces is off the lattice, which is the whole point", () => {
  // A relaxed grid has interior vertices of valence other than four. If this
  // ever came back regular, every later stage's reason to exist would be gone.
  const mesh = normaliseWinding(buildGrid().mesh);
  const adjacency = quadAdjacency(mesh);
  assert.equal(adjacency.length, mesh.quads.length);
  const interior = adjacency.filter((slots) => slots.every((link) => link !== null));
  assert.ok(interior.length > 0, "expected cells fully surrounded by neighbours");
});

test("stacking a grid against a heightmap produces drawable geometry", () => {
  const grid = buildGrid();
  const result = evaluators.get("terrain.stack")(
    { grid, heightmap: heightmap() },
    paramsOf("terrain.stack"),
  );
  assert.equal(result.dataType, "mesh");
  assert.equal(result.positions.length % 3, 0, "positions are xyz triples");
  assert.equal(result.indices.length % 3, 0, "indices are triangles");
  assert.ok(result.indices.length > 0);
  assert.ok(
    result.indices.every((index) => index * 3 < result.positions.length),
    "every index must address a vertex",
  );
});

test("more levels can only add steps, never remove them", () => {
  // Not a cosmetic property: the level count is what makes the later tile
  // solve tractable, so it has to actually control the stepping.
  const grid = buildGrid();
  const field = heightmap();
  const heightsFor = (levels) => {
    const mesh = evaluators.get("terrain.stack")(
      { grid, heightmap: field },
      paramsOf("terrain.stack", { levels }),
    );
    const distinct = new Set();
    for (let index = 1; index < mesh.positions.length; index += 3) {
      distinct.add(Math.round(mesh.positions[index] * 1e4));
    }
    return distinct.size;
  };
  assert.ok(heightsFor(8) >= heightsFor(2), "eight levels must not step less than two");
});

test("the base height lowers the outer wall without moving the terrain on top", () => {
  // Deliberately *not* a uniform offset. `buildStackedTerrain` documents why:
  // folding the base into every top would make a level-0 cell flush with the
  // base and silently drop its wall. So the tops stay put and only the skirt
  // reaches further down.
  const grid = buildGrid();
  const field = heightmap();
  const at = (baseHeight) =>
    evaluators.get("terrain.stack")(
      { grid, heightmap: field },
      paramsOf("terrain.stack", { baseHeight }),
    );

  const heights = (mesh) => {
    let low = Infinity;
    let high = -Infinity;
    for (let index = 1; index < mesh.positions.length; index += 3) {
      low = Math.min(low, mesh.positions[index]);
      high = Math.max(high, mesh.positions[index]);
    }
    return { low, high };
  };

  const shallow = heights(at(-0.2));
  const deep = heights(at(-3));
  assert.ok(Math.abs(deep.high - shallow.high) < 1e-6, "the terrain on top must not move");
  assert.ok(deep.low < shallow.low, "a lower base must reach further down");
  assert.ok(Math.abs(deep.low + 3) < 1e-4, `the skirt should reach the base, got ${deep.low}`);
});

test("a missing or wrongly typed input is named, not guessed at", () => {
  const stack = evaluators.get("terrain.stack");
  assert.throws(() => stack({ heightmap: heightmap() }, paramsOf("terrain.stack")), /grid/);
  assert.throws(() => stack({ grid: buildGrid() }, paramsOf("terrain.stack")), /heightmap/);
  assert.throws(
    () => stack({ grid: heightmap(), heightmap: heightmap() }, paramsOf("terrain.stack")),
    /grid/,
  );
});

test("geometry has no raster preview, and says so rather than inventing one", () => {
  // The viewport draws a heightfield. A grid off the lattice and a triangle
  // soup have nothing to normalise, and projecting them anyway would show a
  // picture that misrepresents them.
  assert.equal(toEvaluationPreview(buildGrid()), null);
  const mesh = evaluators.get("terrain.stack")(
    { grid: buildGrid(), heightmap: heightmap() },
    paramsOf("terrain.stack"),
  );
  assert.equal(toEvaluationPreview(mesh), null);
});
