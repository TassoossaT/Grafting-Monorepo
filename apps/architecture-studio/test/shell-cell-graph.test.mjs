import assert from "node:assert/strict";
import test from "node:test";

import { buildIrregularQuadGrid } from "../src/vtt/irregular-grid.ts";
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

test("a solid box surrounded by solid is left out of the shell", () => {
  const graph = buildShellCellGraph(threeByThree, Array(9).fill(3));

  // The centre column is the only one not on the rim, so it is the only one
  // that can have interior at all: layers 0 and 1 are buried, layer 2 is its top.
  assert.equal(graph.cellAt(CENTRE, 0), null);
  assert.equal(graph.cellAt(CENTRE, 1), null);
  assert.notEqual(graph.cellAt(CENTRE, 2), null);

  assert.equal(graph.volumeCellCount, 27);
  const solidCells = [...graph.kindOfCell].filter((kind) => kind === CELL_SOLID).length;
  assert.equal(solidCells, 25, "only the centre column's two buried boxes are dropped");
});

test("a rim column keeps every box, because the map ending is a cliff too", () => {
  const graph = buildShellCellGraph(threeByThree, Array(9).fill(3));
  for (let layer = 0; layer < 3; layer += 1) {
    assert.notEqual(graph.cellAt(0, layer), null, `corner quad, layer ${layer}`);
  }
});

test("air is materialised beside a cliff, and links to it", () => {
  const graph = buildShellCellGraph(twoQuads, [3, 1]);

  // Quad 1 is one box tall against a neighbour three boxes tall, so layers 1
  // and 2 above it are air that the cliff can be constrained against.
  const airBelow = graph.cellAt(1, 1);
  const airTop = graph.cellAt(1, 2);
  assert.notEqual(airBelow, null);
  assert.notEqual(airTop, null);
  assert.equal(graph.kindOfCell[airBelow], CELL_AIR);
  assert.equal(graph.kindOfCell[airTop], CELL_AIR);
  assert.equal(graph.cellAt(1, 3), null, "air stops once it touches only air");

  const cliff = graph.cellAt(0, 2);
  const touching = linksOf(graph).some(
    (link) =>
      (link.from === cliff && link.to === airTop) || (link.from === airTop && link.to === cliff),
  );
  assert.ok(touching, "the top of the tall column must meet the air beside it");
});

test("a hole is air its neighbours can see", () => {
  const graph = buildShellCellGraph(twoQuads, [2, 0]);
  const hole = graph.cellAt(1, 0);
  assert.notEqual(hole, null);
  assert.equal(graph.kindOfCell[hole], CELL_AIR);
  assert.equal(graph.topCells.length, 1, "an empty column has no top");
});

test("every top cell is solid and sits at the top of its column", () => {
  const solid = [3, 1, 2, 0, 4, 1, 2, 2, 3];
  const graph = buildShellCellGraph(threeByThree, solid);
  assert.equal(graph.topCells.length, solid.filter((height) => height > 0).length);
  for (const cell of graph.topCells) {
    assert.equal(graph.kindOfCell[cell], CELL_SOLID);
    assert.equal(graph.layerOfCell[cell], solid[graph.quadOfCell[cell]] - 1);
  }
});

test("air cells and solid cells partition the graph", () => {
  const graph = buildShellCellGraph(threeByThree, [3, 1, 2, 0, 4, 1, 2, 2, 3]);
  const air = new Set(graph.airCells);
  assert.equal(air.size, graph.airCells.length);
  for (let cell = 0; cell < graph.cellCount; cell += 1) {
    assert.equal(air.has(cell), graph.kindOfCell[cell] === CELL_AIR);
  }
});

test("every link names a cell the shell actually has", () => {
  const mesh = buildIrregularQuadGrid({ trianglesPerSide: 3, triangleSide: 0.5, seed: 7 });
  const solid = mesh.quads.map((_, quad) => (quad * 7) % 5);
  const graph = buildShellCellGraph(mesh, solid);

  assert.ok(graph.cellCount > 0);
  for (const link of linksOf(graph)) {
    assert.ok(link.from < graph.cellCount && link.to < graph.cellCount);
    assert.ok(link.fromFace < FACES_PER_CELL && link.toFace < FACES_PER_CELL);
    assert.notEqual(link.from, link.to);
  }
});

test("the shell is smaller than the volume it describes", () => {
  const mesh = buildIrregularQuadGrid({ trianglesPerSide: 4, triangleSide: 0.5, seed: 3 });
  const solid = mesh.quads.map(() => 5);
  const graph = buildShellCellGraph(mesh, solid);
  const solidCells = [...graph.kindOfCell].filter((kind) => kind === CELL_SOLID).length;
  assert.ok(
    solidCells < graph.volumeCellCount,
    `${solidCells} solid shell cells should be fewer than ${graph.volumeCellCount} boxes`,
  );
});

test("a solid height that is not a count is refused", () => {
  assert.throws(() => buildShellCellGraph(twoQuads, [1]), RangeError);
  assert.throws(() => buildShellCellGraph(twoQuads, [1, -1]), RangeError);
  assert.throws(() => buildShellCellGraph(twoQuads, [1, 1.5]), RangeError);
});

test("pinCells packs (cell, module) pairs", () => {
  assert.deepEqual(pinCells(Uint32Array.from([2, 5]), 4), Uint32Array.from([2, 4, 5, 4]));
  assert.deepEqual(pinCells([], 4), new Uint32Array());
});
