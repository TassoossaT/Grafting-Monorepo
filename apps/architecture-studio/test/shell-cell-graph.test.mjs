import assert from "node:assert/strict";
import test from "node:test";

import { buildIrregularQuadGrid } from "../src/vtt/irregular-grid.ts";
import { occupancyFromHeights, occupancyOf, withCell } from "../src/vtt/cell-occupancy.ts";
import { STARTING_COMPATIBILITY, STARTING_TILESET } from "../src/vtt/terrain-modules.ts";
import {
  CELL_AIR,
  CELL_SOLID,
  FACES_PER_CELL,
  LINK_STRIDE,
  buildShellCellGraph,
  pinCells,
} from "../src/vtt/shell-cell-graph.ts";

/** Two quads sharing one edge. Both are entirely rim. */
const twoQuads = {
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

/** Three by three quads, so quad 4 is the one quad with four neighbours. */
const threeByThree = (() => {
  const vertices = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) vertices.push({ x: column, y: row });
  }
  const quads = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      quads.push([
        row * 4 + column,
        row * 4 + column + 1,
        (row + 1) * 4 + column + 1,
        (row + 1) * 4 + column,
      ]);
    }
  }
  return { vertices, quads };
})();

const CENTRE = 4;

/** Every link, as readable tuples. */
function linksOf(graph) {
  const links = [];
  for (let index = 0; index < graph.links.length; index += LINK_STRIDE) {
    links.push({
      from: graph.links[index],
      fromFace: graph.links[index + 1],
      to: graph.links[index + 2],
      toFace: graph.links[index + 3],
    });
  }
  return links;
}

const solidCellsOf = (graph) => [...graph.kindOfCell].filter((kind) => kind === CELL_SOLID).length;

test("a cell surrounded by occupied cells is left out of the shell", () => {
  const graph = buildShellCellGraph(threeByThree, occupancyFromHeights(Array(9).fill(3)));

  // The centre column is the only one not on the rim, so it is the only one
  // that can have interior at all: layers 0 and 1 are buried, layer 2 is its roof.
  assert.equal(graph.cellAt(CENTRE, 0), null);
  assert.equal(graph.cellAt(CENTRE, 1), null);
  assert.notEqual(graph.cellAt(CENTRE, 2), null);

  assert.equal(graph.occupiedCellCount, 27);
  assert.equal(solidCellsOf(graph), 25, "only the centre column's two buried cells are dropped");
});

test("bedrock is not exposure: a ground cell is not shell just for being lowest", () => {
  // Layer 0 of the centre column has nothing under it, and that must not count
  // as a face open to air -- otherwise every ground cell joins the shell and
  // the solver decides undersides no camera reaches.
  const graph = buildShellCellGraph(threeByThree, occupancyFromHeights(Array(9).fill(2)));
  assert.equal(graph.cellAt(CENTRE, 0), null);
  assert.notEqual(graph.cellAt(CENTRE, 1), null);
});

test("a rim column keeps every cell, because the map ending is a cliff too", () => {
  const graph = buildShellCellGraph(threeByThree, occupancyFromHeights(Array(9).fill(3)));
  for (let layer = 0; layer < 3; layer += 1) {
    assert.notEqual(graph.cellAt(0, layer), null, `corner quad, layer ${layer}`);
  }
});

test("an overhang has an underside, which the heightfield could not express", () => {
  // The centre quad is occupied at 0 and 2 with a gap at 1: a floor, air, and a
  // slab over it. No height per quad can say this.
  const layers = Array.from({ length: 9 }, (_, quad) => (quad === CENTRE ? [0, 2] : [0, 1, 2]));
  const graph = buildShellCellGraph(threeByThree, occupancyOf(layers));

  const gap = graph.cellAt(CENTRE, 1);
  assert.notEqual(gap, null, "the gap must be materialised as air");
  assert.equal(graph.kindOfCell[gap], CELL_AIR);

  const floor = graph.cellAt(CENTRE, 0);
  const slab = graph.cellAt(CENTRE, 2);
  assert.notEqual(floor, null, "the floor is exposed upward into the gap");
  assert.notEqual(slab, null, "the slab is exposed downward into the gap");

  const vertical = linksOf(graph).filter(
    (link) =>
      (link.from === floor && link.to === gap) ||
      (link.from === gap && link.to === slab),
  );
  assert.equal(vertical.length, 2, "the air must link to what is above and below it");
});

test("every cell with nothing above it is a roof, not only a column top", () => {
  const layers = Array.from({ length: 9 }, (_, quad) => (quad === CENTRE ? [0, 2] : [0, 1, 2]));
  const graph = buildShellCellGraph(threeByThree, occupancyOf(layers));

  const centreRoofs = [...graph.roofCells].filter((cell) => graph.quadOfCell[cell] === CENTRE);
  assert.equal(centreRoofs.length, 2, "the floor and the slab both show a top surface");
  assert.deepEqual(
    centreRoofs.map((cell) => graph.layerOfCell[cell]).sort(),
    [0, 2],
  );
  for (const cell of graph.roofCells) assert.equal(graph.kindOfCell[cell], CELL_SOLID);
});

test("air is materialised beside a cliff, and links to it", () => {
  const graph = buildShellCellGraph(twoQuads, occupancyFromHeights([3, 1]));

  // Quad 1 is one cell tall against a neighbour three tall, so layers 1 and 2
  // above it are air the cliff can be constrained against.
  const airBelow = graph.cellAt(1, 1);
  const airTop = graph.cellAt(1, 2);
  assert.equal(graph.kindOfCell[airBelow], CELL_AIR);
  assert.equal(graph.kindOfCell[airTop], CELL_AIR);
  assert.equal(graph.cellAt(1, 4), null, "air stops once it touches only air");

  const cliff = graph.cellAt(0, 2);
  const touching = linksOf(graph).some(
    (link) =>
      (link.from === cliff && link.to === airTop) || (link.from === airTop && link.to === cliff),
  );
  assert.ok(touching, "the top of the tall column must meet the air beside it");
});

test("a hole is air its neighbours can see", () => {
  const graph = buildShellCellGraph(twoQuads, occupancyFromHeights([2, 0]));
  const hole = graph.cellAt(1, 0);
  assert.equal(graph.kindOfCell[hole], CELL_AIR);
  assert.equal(graph.roofCells.length, 1, "an empty column has no roof");
});

test("air cells and occupied cells partition the graph", () => {
  const graph = buildShellCellGraph(
    threeByThree,
    occupancyFromHeights([3, 1, 2, 0, 4, 1, 2, 2, 3]),
  );
  const air = new Set(graph.airCells);
  assert.equal(air.size, graph.airCells.length);
  for (let cell = 0; cell < graph.cellCount; cell += 1) {
    assert.equal(air.has(cell), graph.kindOfCell[cell] === CELL_AIR);
  }
});

test("every link names a cell the shell actually has", () => {
  const mesh = buildIrregularQuadGrid({ trianglesPerSide: 3, triangleSide: 0.5, seed: 7 });
  const graph = buildShellCellGraph(
    mesh,
    occupancyFromHeights(mesh.quads.map((_, quad) => (quad * 7) % 5)),
  );

  assert.ok(graph.cellCount > 0);
  for (const link of linksOf(graph)) {
    assert.ok(link.from < graph.cellCount && link.to < graph.cellCount);
    assert.ok(link.fromFace < FACES_PER_CELL && link.toFace < FACES_PER_CELL);
    assert.notEqual(link.from, link.to);
  }
});

test("the shell is smaller than the volume it describes", () => {
  const mesh = buildIrregularQuadGrid({ trianglesPerSide: 4, triangleSide: 0.5, seed: 3 });
  const graph = buildShellCellGraph(mesh, occupancyFromHeights(mesh.quads.map(() => 5)));
  assert.ok(
    solidCellsOf(graph) < graph.occupiedCellCount,
    `${solidCellsOf(graph)} shell cells should be fewer than ${graph.occupiedCellCount} occupied`,
  );
});

test("adding a cell only grows the shell around it", () => {
  const before = occupancyFromHeights(Array(9).fill(2));
  const after = withCell(before, CENTRE, 5);
  const graph = buildShellCellGraph(threeByThree, after);

  // A cell floating two layers clear of the ground: occupied, exposed on every
  // side including underneath, and surrounded by newly materialised air.
  const floating = graph.cellAt(CENTRE, 5);
  assert.notEqual(floating, null);
  assert.equal(graph.kindOfCell[floating], CELL_SOLID);
  assert.notEqual(graph.cellAt(CENTRE, 4), null, "air under it");
  assert.notEqual(graph.cellAt(CENTRE, 6), null, "air over it");
  assert.equal(graph.occupiedCellCount, before.size + 1);
});

test("an occupancy that does not describe the mesh is refused", () => {
  assert.throws(
    () => buildShellCellGraph(twoQuads, occupancyFromHeights([1])),
    RangeError,
  );
});

test("pinCells packs (cell, module) pairs", () => {
  assert.deepEqual(pinCells(Uint32Array.from([2, 5]), 4), Uint32Array.from([2, 4, 5, 4]));
  assert.deepEqual(pinCells([], 4), new Uint32Array());
});

test("the starting tileset can actually solve a map with an overhang", () => {
  // Not a solver run -- a proof that a solution exists, which is what the
  // solver would have to find. The vertical socket scheme changed to force a
  // ceiling over air, and an unsatisfiable tileset would take the whole trial
  // down rather than degrade, so it is worth checking without the wasm.
  const layers = Array.from({ length: 9 }, (_, quad) => (quad === CENTRE ? [0, 2] : [0, 1, 2]));
  const occupancy = occupancyOf(layers);
  const graph = buildShellCellGraph(threeByThree, occupancy);

  const byName = (name) => STARTING_TILESET.find((module) => module.name === name);
  const meets = (a, b) =>
    STARTING_COMPATIBILITY.some(
      ([left, right]) => (left === a && right === b) || (left === b && right === a),
    );

  // The intended assignment: air is pinned, a cell hanging over nothing takes
  // the only module with an underside, everything else is flat ground. Every
  // one of the three is laterally symmetric, so rotation cannot rescue a
  // mismatch and this is the strict case.
  const assign = (cell) => {
    if (graph.kindOfCell[cell] === CELL_AIR) return byName("empty");
    const quad = graph.quadOfCell[cell];
    const layer = graph.layerOfCell[cell];
    return layer > 0 && !occupancy.has(quad, layer - 1) ? byName("slab") : byName("flat");
  };

  const failures = [];
  for (let index = 0; index < graph.links.length; index += LINK_STRIDE) {
    const from = graph.links[index];
    const to = graph.links[index + 2];
    const ours = assign(from).sockets[graph.links[index + 1]];
    const theirs = assign(to).sockets[graph.links[index + 3]];
    if (!meets(ours, theirs)) {
      failures.push(
        `cell ${from} (${assign(from).name}) face ${graph.links[index + 1]} against cell ${to} (${assign(to).name}) face ${graph.links[index + 3]}`,
      );
    }
  }
  assert.deepEqual(failures, [], "every link must admit the intended assignment");

  const slabs = [...Array(graph.cellCount).keys()].filter(
    (cell) => graph.kindOfCell[cell] === CELL_SOLID && assign(cell).name === "slab",
  );
  assert.equal(slabs.length, 1, "the carved overhang is the one cell needing a ceiling");
});
