import assert from "node:assert/strict";
import test from "node:test";

import { buildIrregularQuadGrid } from "../src/vtt/irregular-grid.ts";
import {
  compassAssignment,
  LATERAL_DIRECTION_COUNT,
  opposabilityViolations,
  oppositeSlotPair,
  quadAdjacency,
  normaliseWinding,
  slotPairDirection,
  slotPairNeighbours,
} from "../src/vtt/grid-adjacency.ts";

const SEEDS = [12345, 7, 999];
const irregular = (seed) => buildIrregularQuadGrid({ trianglesPerSide: 4, seed });

/** A plain n x n grid: the control. Everything below must succeed here. */
function regularGrid(n) {
  const vertices = [];
  for (let y = 0; y <= n; y += 1) for (let x = 0; x <= n; x += 1) vertices.push({ x, y });
  const at = (x, y) => y * (n + 1) + x;
  const quads = [];
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    quads.push([at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)]);
  }
  return { vertices, quads };
}

test("adjacency is mutual: each link is mirrored by the quad across it", () => {
  for (const seed of SEEDS) {
    const adjacency = quadAdjacency(normaliseWinding(irregular(seed)));
    adjacency.forEach((slots, quad) => {
      slots.forEach((link, slot) => {
        if (link === null) return;
        const back = adjacency[link.neighbour][link.theirSlot];
        assert.notEqual(back, null, `seed ${seed}: quad ${quad} slot ${slot} has no return link`);
        assert.equal(back.neighbour, quad);
        assert.equal(back.theirSlot, slot);
      });
    });
  }
});

test("oppositeSlotPair swaps the two slots and is an involution", () => {
  for (let mine = 0; mine < 4; mine += 1) {
    for (let theirs = 0; theirs < 4; theirs += 1) {
      const direction = slotPairDirection(mine, theirs);
      assert.equal(oppositeSlotPair(direction), slotPairDirection(theirs, mine));
      assert.equal(oppositeSlotPair(oppositeSlotPair(direction)), direction);
    }
  }
});

test("the slot-pair encoding satisfies the solver's opposite-direction invariant", () => {
  for (const seed of SEEDS) {
    const table = slotPairNeighbours(quadAdjacency(normaliseWinding(irregular(seed))));
    assert.equal(table[0].length, LATERAL_DIRECTION_COUNT);
    assert.equal(
      opposabilityViolations(table),
      0,
      `seed ${seed}: slot-pair directions must be opposable everywhere`,
    );
  }
});

test("the slot-pair encoding also holds on a regular grid", () => {
  const table = slotPairNeighbours(quadAdjacency(normaliseWinding(regularGrid(8))));
  assert.equal(opposabilityViolations(table), 0);
});

test("the four-compass-direction encoding works on a regular grid", () => {
  // The control. Without this, the failure below would be evidence of a bug
  // in `compassAssignment` rather than a property of the irregular grid.
  assert.equal(compassAssignment(regularGrid(8)).contradictions, 0);
});

test("the four-compass-direction encoding is impossible on the irregular grid", () => {
  for (const seed of SEEDS) {
    const { contradictions } = compassAssignment(irregular(seed));
    assert.ok(
      contradictions > 0,
      `seed ${seed}: expected the compass labelling to be obstructed`,
    );
  }
});

test("the obstruction scales with vertices of valence other than four", () => {
  // The stated cause, checked rather than asserted: a grid with more irregular
  // interior vertices must not have fewer contradictions.
  const measured = SEEDS.map((seed) => {
    const mesh = irregular(seed);
    const valence = new Map();
    mesh.quads.forEach((quad) => quad.forEach((v) => valence.set(v, (valence.get(v) ?? 0) + 1)));
    const onBoundary = new Set();
    const seen = new Map();
    mesh.quads.forEach((quad) => {
      for (let slot = 0; slot < 4; slot += 1) {
        const a = quad[slot];
        const b = quad[(slot + 1) % 4];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    });
    for (const [key, count] of seen) {
      if (count !== 1) continue;
      key.split(":").forEach((v) => onBoundary.add(Number(v)));
    }
    let irregularInterior = 0;
    for (const [vertex, count] of valence) {
      if (!onBoundary.has(vertex) && count !== 4) irregularInterior += 1;
    }
    return { irregularInterior, contradictions: compassAssignment(mesh).contradictions };
  });

  measured.forEach(({ irregularInterior }) => assert.ok(irregularInterior > 0));
  const byIrregularity = [...measured].sort((a, b) => a.irregularInterior - b.irregularInterior);
  for (let i = 1; i < byIrregularity.length; i += 1) {
    assert.ok(
      byIrregularity[i].contradictions >= byIrregularity[i - 1].contradictions,
      `more irregular vertices must not mean fewer contradictions: ${JSON.stringify(byIrregularity)}`,
    );
  }
});
