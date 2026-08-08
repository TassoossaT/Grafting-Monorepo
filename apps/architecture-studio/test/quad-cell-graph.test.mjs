import assert from "node:assert/strict";
import test from "node:test";

import { buildIrregularQuadGrid } from "../src/vtt/irregular-grid.ts";
import { normaliseWinding, quadAdjacency } from "../src/vtt/grid-adjacency.ts";
import {
  FACES_PER_CELL,
  FACE_DOWN,
  FACE_UP,
  LINK_STRIDE,
  buildQuadCellGraph,
  openFaces,
} from "../src/vtt/quad-cell-graph.ts";

/** Two quads sharing one edge. */
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

const linksOf = (graph) => {
  const out = [];
  for (let i = 0; i < graph.links.length; i += LINK_STRIDE) {
    out.push({
      from: graph.links[i],
      fromFace: graph.links[i + 1],
      to: graph.links[i + 2],
      toFace: graph.links[i + 3],
    });
  }
  return out;
};

test("a cell is a quad and a layer, so the count is the sum of the stack", () => {
  const graph = buildQuadCellGraph(twoQuads, [3, 1]);
  assert.equal(graph.cellCount, 4);
  assert.equal(graph.facesPerCell, FACES_PER_CELL);
  assert.deepEqual([...graph.quadOfCell], [0, 0, 0, 1]);
  assert.deepEqual([...graph.layerOfCell], [0, 1, 2, 0]);
  assert.equal(graph.cellAt(0, 2), 2);
  assert.equal(graph.cellAt(1, 0), 3);
  assert.equal(graph.cellAt(1, 1), null, "quad 1 has only one layer");
  assert.equal(graph.cellAt(9, 0), null, "quad 9 does not exist");
});

test("a quad with no layers contributes no cells and no links", () => {
  // How a hole or a water cell is expressed, without the graph needing a
  // concept of either.
  const graph = buildQuadCellGraph(twoQuads, [2, 0]);
  assert.equal(graph.cellCount, 2);
  assert.equal(graph.cellAt(1, 0), null);
  assert.ok(
    linksOf(graph).every((link) => graph.quadOfCell[link.from] === 0),
    "nothing may link to a quad that contributes nothing",
  );
});

test("neighbouring quads are linked at every layer they share, and no more", () => {
  // Quad 0 rises three levels, quad 1 one. They meet only at layer 0; the two
  // levels above are the exposed face of a step, not a bad adjacency.
  const graph = buildQuadCellGraph(twoQuads, [3, 1]);
  const lateral = linksOf(graph).filter((link) => link.fromFace < 4 && link.toFace < 4);
  assert.equal(lateral.length, 1);
  assert.equal(graph.layerOfCell[lateral[0].from], 0);
  assert.equal(graph.layerOfCell[lateral[0].to], 0);
});

test("a lateral link always joins cells at the same layer", () => {
  const graph = buildQuadCellGraph(twoQuads, [4, 4]);
  const lateral = linksOf(graph).filter((link) => link.fromFace < 4);
  assert.equal(lateral.length, 4, "four shared layers, four links");
  lateral.forEach((link) => {
    assert.equal(graph.layerOfCell[link.from], graph.layerOfCell[link.to]);
  });
});

test("vertical links stay inside one quad and join consecutive layers", () => {
  const graph = buildQuadCellGraph(twoQuads, [3, 1]);
  const vertical = linksOf(graph).filter((link) => link.fromFace === FACE_UP);
  assert.equal(vertical.length, 2, "a stack of three has two joints");
  vertical.forEach((link) => {
    assert.equal(link.toFace, FACE_DOWN, "up must always meet down");
    assert.equal(graph.quadOfCell[link.from], graph.quadOfCell[link.to]);
    assert.equal(graph.layerOfCell[link.to], graph.layerOfCell[link.from] + 1);
  });
});

test("the lateral slot each cell uses is the slot its quad uses", () => {
  // The property that makes a rotation cycle of [0,1,2,3] meaningful: a cell's
  // faces 0-3 are its quad's edge slots, unchanged by stacking.
  const mesh = normaliseWinding(twoQuads);
  const adjacency = quadAdjacency(mesh);
  const graph = buildQuadCellGraph(mesh, [2, 2]);
  linksOf(graph)
    .filter((link) => link.fromFace < 4)
    .forEach((link) => {
      const quad = graph.quadOfCell[link.from];
      const across = adjacency[quad][link.fromFace];
      assert.notEqual(across, null);
      assert.equal(across.neighbour, graph.quadOfCell[link.to]);
      assert.equal(across.theirSlot, link.toFace);
    });
});

test("no face of any cell is linked twice on a real irregular grid", () => {
  // The load-bearing test. `CellGraph::new` on the Rust side refuses a
  // duplicated face, so this is the property that decides whether a real grid
  // reaches the solver at all -- and the irregular grid is where a naive
  // mapping breaks.
  const mesh = normaliseWinding(buildIrregularQuadGrid({ trianglesPerSide: 4, seed: 90210 }));
  const layers = mesh.quads.map((_, quad) => (quad % 5) + 1);
  const graph = buildQuadCellGraph(mesh, layers);

  const seen = new Set();
  linksOf(graph).forEach((link, index) => {
    assert.notEqual(link.from, link.to, `link ${index} joins a cell to itself`);
    [
      [link.from, link.fromFace],
      [link.to, link.toFace],
    ].forEach(([cell, face]) => {
      assert.ok(cell < graph.cellCount, `link ${index} names cell ${cell}`);
      assert.ok(face < FACES_PER_CELL, `link ${index} names face ${face}`);
      const key = cell * FACES_PER_CELL + face;
      assert.ok(!seen.has(key), `face ${face} of cell ${cell} is linked more than once`);
      seen.add(key);
    });
  });

  assert.ok(graph.cellCount > 100, `expected a substantial grid, got ${graph.cellCount} cells`);
  assert.ok(seen.size > 200, `expected substantial adjacency, got ${seen.size} faces`);
});

test("the top of every stack and the bottom of every column are open", () => {
  const graph = buildQuadCellGraph(twoQuads, [3, 1]);
  const open = openFaces(graph);
  const has = (cell, face) => open.some((entry) => entry.cell === cell && entry.face === face);

  assert.ok(has(graph.cellAt(0, 2), FACE_UP), "nothing sits above the top box");
  assert.ok(has(graph.cellAt(0, 0), FACE_DOWN), "nothing sits below the bottom box");
  assert.ok(!has(graph.cellAt(0, 0), FACE_UP), "the bottom box has a box above it");
});

test("open faces and links together account for every face exactly once", () => {
  const mesh = normaliseWinding(buildIrregularQuadGrid({ trianglesPerSide: 3, seed: 7 }));
  const graph = buildQuadCellGraph(
    mesh,
    mesh.quads.map((_, quad) => (quad % 3) + 1),
  );
  const linked = (graph.links.length / LINK_STRIDE) * 2;
  assert.equal(linked + openFaces(graph).length, graph.cellCount * FACES_PER_CELL);
});

test("a layer count that does not describe the mesh is refused", () => {
  assert.throws(() => buildQuadCellGraph(twoQuads, [1]), RangeError);
  assert.throws(() => buildQuadCellGraph(twoQuads, [1, -1]), RangeError);
  assert.throws(() => buildQuadCellGraph(twoQuads, [1, 1.5]), RangeError);
});
