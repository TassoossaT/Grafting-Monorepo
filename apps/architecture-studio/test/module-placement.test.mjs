import assert from "node:assert/strict";
import test from "node:test";

import { buildIrregularQuadGrid } from "../src/vtt/irregular-grid.ts";
import { quadAdjacency, normaliseWinding } from "../src/vtt/grid-adjacency.ts";
import { placeModule } from "../src/vtt/module-placement.ts";

/** Two cells sharing the edge from (1,0) to (1,1), the right one skewed. */
const twoCells = {
  vertices: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 2.3, y: -0.4 },
    { x: 1.8, y: 1.7 },
  ],
  quads: [
    [0, 1, 2, 3],
    [1, 4, 5, 2],
  ],
};

/** A module whose vertices sit on every boundary and in the interior. */
function samplerModule(steps = 5) {
  const vertices = [];
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      vertices.push({ u: i / steps, v: j / steps, height: 0 });
    }
  }
  return { vertices, indices: new Uint32Array() };
}

const positionOf = (placed, index) => [
  placed.positions[index * 3],
  placed.positions[index * 3 + 1],
  placed.positions[index * 3 + 2],
];

test("the unit cell's corners land exactly on the quad's corners", () => {
  const module = {
    vertices: [
      { u: 0, v: 0, height: 0 },
      { u: 1, v: 0, height: 0 },
      { u: 1, v: 1, height: 0 },
      { u: 0, v: 1, height: 0 },
    ],
    indices: new Uint32Array(),
  };
  const placed = placeModule(module, twoCells, 1);
  const expected = twoCells.quads[1].map((v) => twoCells.vertices[v]);
  expected.forEach((corner, index) => {
    const [x, , z] = positionOf(placed, index);
    // Positions live in a Float32Array, so the exactness being claimed is
    // "the corner value itself, with no arithmetic done to it" -- which is
    // `Math.fround` of it, not the original double.
    assert.equal(x, Math.fround(corner.x), `corner ${index} x`);
    assert.equal(z, Math.fround(corner.y), `corner ${index} z`);
  });
});

test("a square quad reproduces the module unchanged", () => {
  const module = samplerModule(4);
  const unitCell = {
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    quads: [[0, 1, 2, 3]],
  };
  const placed = placeModule(module, unitCell, 0);
  module.vertices.forEach((vertex, index) => {
    const [x, , z] = positionOf(placed, index);
    assert.ok(Math.abs(x - vertex.u) < 1e-12, `u ${vertex.u} -> x ${x}`);
    assert.ok(Math.abs(z - vertex.v) < 1e-12, `v ${vertex.v} -> z ${z}`);
  });
});

test("height passes through untouched, offset by the base", () => {
  const module = {
    vertices: [{ u: 0.5, v: 0.5, height: 2.25 }],
    indices: new Uint32Array(),
  };
  const placed = placeModule(module, twoCells, 0, { baseHeight: 10 });
  assert.equal(positionOf(placed, 0)[1], 12.25);
});

test("neighbouring cells agree bit for bit along a shared edge", () => {
  // The load-bearing property. Both cells place a module vertex at the same
  // point of the shared edge; the two positions must be *identical*, not
  // merely close, or a hairline crack appears along every seam.
  const steps = 7;
  const left = [];
  const right = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    // Cell 0 meets the shared edge on its right (u = 1), running from its
    // corner 1 to its corner 2. Cell 1 meets it on its left (u = 0), running
    // from its corner 0 to its corner 3 -- which are the same two grid
    // vertices in the same order, so `v` runs the same way on both sides.
    left.push({ u: 1, v: t, height: 0 });
    right.push({ u: 0, v: t, height: 0 });
  }

  const placedLeft = placeModule({ vertices: left, indices: new Uint32Array() }, twoCells, 0);
  const placedRight = placeModule({ vertices: right, indices: new Uint32Array() }, twoCells, 1);

  for (let i = 0; i <= steps; i += 1) {
    const a = positionOf(placedLeft, i);
    const b = positionOf(placedRight, i);
    assert.deepEqual(a, b, `sample ${i} of the shared edge disagrees: ${a} vs ${b}`);
  }
});

test("every shared edge of a real irregular grid agrees bit for bit", () => {
  const mesh = normaliseWinding(buildIrregularQuadGrid({ trianglesPerSide: 3, seed: 4242 }));
  const adjacency = quadAdjacency(mesh);
  const steps = 5;

  // For a quad, unit-cell edge k runs between corners k and k+1. Sample each
  // edge from both sides and compare.
  const edgeSamples = (slot, t) => {
    switch (slot) {
      case 0: return { u: t, v: 0, height: 0 };
      case 1: return { u: 1, v: t, height: 0 };
      case 2: return { u: 1 - t, v: 1, height: 0 };
      default: return { u: 0, v: 1 - t, height: 0 };
    }
  };

  let compared = 0;
  adjacency.forEach((slots, quad) => {
    slots.forEach((link, slot) => {
      if (link === null || link.neighbour < quad) return;
      const mine = [];
      const theirs = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        mine.push(edgeSamples(slot, t));
        // The neighbour traverses the same edge the other way round.
        theirs.push(edgeSamples(link.theirSlot, 1 - t));
      }
      const a = placeModule({ vertices: mine, indices: new Uint32Array() }, mesh, quad);
      const b = placeModule({ vertices: theirs, indices: new Uint32Array() }, mesh, link.neighbour);
      for (let i = 0; i <= steps; i += 1) {
        assert.deepEqual(
          positionOf(a, i),
          positionOf(b, i),
          `quad ${quad} slot ${slot} sample ${i} disagrees with quad ${link.neighbour}`,
        );
        compared += 1;
      }
    });
  });

  assert.ok(compared > 500, `expected a substantial number of comparisons, made ${compared}`);
});

test("interior points stay inside the cell", () => {
  const mesh = normaliseWinding(buildIrregularQuadGrid({ trianglesPerSide: 3, seed: 11 }));
  const module = samplerModule(4);

  // A bilinear patch over a convex quad is contained in that quad, so every
  // sample must be inside or on the boundary.
  const sign = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

  for (let quadIndex = 0; quadIndex < Math.min(mesh.quads.length, 40); quadIndex += 1) {
    const quad = mesh.quads[quadIndex];
    const corners = quad.map((v) => mesh.vertices[v]);
    const convex = corners.every((_, i) => {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const c = corners[(i + 2) % 4];
      return sign(a.x, a.y, b.x, b.y, c.x, c.y) > 0;
    });
    if (!convex) continue;

    const placed = placeModule(module, mesh, quadIndex);
    module.vertices.forEach((_, index) => {
      const [x, , z] = positionOf(placed, index);
      corners.forEach((corner, i) => {
        const next = corners[(i + 1) % 4];
        // Samples on a boundary land exactly on it in double precision and
        // are then stored as float32, so the tolerance has to be the storage
        // precision rather than the arithmetic's.
        assert.ok(
          sign(corner.x, corner.y, next.x, next.y, x, z) >= -1e-5,
          `quad ${quadIndex} sample ${index} fell outside edge ${i}`,
        );
      });
    });
  }
});

test("the agreement across a seam is float32-exact, not double-exact", () => {
  // Documents the actual guarantee and its limit. The two sides of an edge
  // reach it with parameters `t` and `1 - t`, and `1 - (1 - t)` is not `t`
  // in IEEE arithmetic, so the doubles differ by about 1e-16. No ordering
  // trick removes that -- it enters through the parameter. Storing as
  // float32 is what makes the stored positions identical.
  const t = 0.3;
  const forward = 0.1 + (0.7 - 0.1) * t;
  const backward = 0.7 + (0.1 - 0.7) * (1 - t);
  assert.notEqual(forward, backward, "expected the doubles to differ");
  assert.equal(Math.fround(forward), Math.fround(backward), "expected float32 to agree");
});

test("an out-of-range quad is refused rather than silently wrong", () => {
  const module = samplerModule(1);
  assert.throws(() => placeModule(module, twoCells, 9), RangeError);
});
