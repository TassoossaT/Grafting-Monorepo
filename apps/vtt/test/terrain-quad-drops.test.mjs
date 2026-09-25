import assert from "node:assert/strict";
import test from "node:test";

import { gridPatch } from "../src/composition/tabletop/terrain/terrain-fill.ts";

/**
 * Which generated cells become faces, and which are dropped for standing on
 * ground that is still there.
 *
 * A cell sharing an edge with a face that stays must walk that edge the
 * opposite way -- that is what having a face on each side means. The rule is
 * sound; what it must not do is read a face's *stored winding* as if it were
 * that face's side, because the rims of standing ground and the cells this
 * fill generates come from two different places and nothing reconciles which
 * way round they run.
 */

const TABLE = "t";
/** The id `sharedEdgeId` mints for the edge the two cells share. */
const SHARED = `${TABLE}:seg:n1~n2`;

/** Two unit cells side by side: left spans x 0..1, right spans x 1..2. */
function grid() {
  return {
    vertices: [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 },
      { x: 2, z: 0 }, { x: 2, z: 1 },
    ],
    // Both counter-clockwise in XZ, the way every generated cell comes back.
    quads: [[0, 3, 2, 1], [1, 2, 5, 4]],
    onContour: [],
    refinementComplete: true,
  };
}

const NODES = ["n0", "n1", "n2", "n3", "n4", "n5"];
const idFor = (vertex) => NODES[vertex];
const nodes = NODES.map((id, index) => ({ id, position: { x: index, y: 0, z: 0 } }));

/** What `fillTerrain` records for an edge with exactly one face on it. */
function roomFacing(edgeId, startNodeId, endNodeId) {
  return new Map([[edgeId, { edgeId, reversed: false, startNodeId, endNodeId }]]);
}

function built(edgeRooms) {
  const drops = { avoided: 0, unnamed: 0, degenerate: 0, retained: 0 };
  const patch = gridPatch(TABLE, grid(), idFor, nodes, "terrain", edgeRooms, undefined, undefined, drops);
  return { regions: patch.regions.length, drops };
}

test("with nothing standing, every generated cell becomes a face", () => {
  const { regions, drops } = built(new Map());

  assert.equal(regions, 2);
  assert.equal(drops.retained, 0);
});

test("a cell whose edge is already full is dropped, because there is no room for it", () => {
  // `null` is how an edge with a face on each side is recorded. Both cells
  // walk this edge, so neither has anywhere to go.
  const { regions, drops } = built(new Map([[SHARED, null]]));

  assert.equal(regions, 0);
  assert.equal(drops.retained, 2);
});

test("only the cell on the free side of standing ground is laid", () => {
  // An edge with one face on it has exactly one free side, and the free walk
  // names it: the cell stepping that way belongs, the cell stepping the other
  // way would sit on top of the face already there.
  //
  // The left cell walks n2 -> n1 and the right cell walks n1 -> n2, so each
  // free walk admits exactly one of them. That the *other* cell is dropped is
  // the rule working, not ground going missing -- the ground it would have
  // covered is the standing face itself.
  const facingLeft = built(roomFacing(SHARED, "n2", "n1"));
  assert.equal(facingLeft.regions, 1);
  assert.equal(facingLeft.drops.retained, 1);

  const facingRight = built(roomFacing(SHARED, "n1", "n2"));
  assert.equal(facingRight.regions, 1);
  assert.equal(facingRight.drops.retained, 1);
});

test("a third cell attempting to use the same internal edge is dropped", () => {
  const g = {
    vertices: [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 },
      { x: 2, z: 0 }, { x: 2, z: 1 },
      { x: 1, z: 2 }, { x: 2, z: 2 },
    ],
    quads: [
      [0, 3, 2, 1], // left: walks n2 -> n1 on SHARED
      [1, 2, 5, 4], // right: walks n1 -> n2 on SHARED (now SHARED has 2 uses)
      [1, 2, 7, 6], // third quad: also walks n1 -> n2 on SHARED
    ],
    onContour: [],
    refinementComplete: true,
  };
  const nodes8 = ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7"].map((id, index) => ({ id, position: { x: index, y: 0, z: 0 } }));
  const drops = { avoided: 0, unnamed: 0, degenerate: 0, retained: 0 };
  const patch = gridPatch(TABLE, g, (v) => nodes8[v]?.id, nodes8, "terrain", new Map(), undefined, undefined, drops);

  assert.equal(patch.regions.length, 2, "only 2 cells can share an internal edge");
  assert.equal(drops.retained, 1, "third cell is culled before reaching the engine");
});

test("two cells walking an edge in the same direction cull the duplicate", () => {
  const g = {
    vertices: [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 },
      { x: 1, z: 2 }, { x: 0, z: 2 },
    ],
    quads: [
      [0, 3, 2, 1], // walks n2 -> n1 on SHARED
      [0, 3, 2, 1], // duplicate quad also walking n2 -> n1 on SHARED
    ],
    onContour: [],
    refinementComplete: true,
  };
  const drops = { avoided: 0, unnamed: 0, degenerate: 0, retained: 0 };
  const patch = gridPatch(TABLE, g, idFor, nodes, "terrain", new Map(), undefined, undefined, drops);

  assert.equal(patch.regions.length, 1, "duplicate walk in same direction is culled");
  assert.equal(drops.retained, 1);
});

