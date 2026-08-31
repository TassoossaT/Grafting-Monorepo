import assert from "node:assert/strict";
import test from "node:test";

import { fillUnfilledLoops } from "../src/features/edit-construction/topology/fill-unfilled-loops.ts";

/**
 * Mending a gap by registering the rim the engine reports, and -- for a gap
 * too large to be one face -- cutting that rim into a mesh.
 *
 * The mesh is the part worth pinning down, because it is the only place this
 * algorithm creates anything at all. What it must never create is a second
 * edge beside one already standing: a rim segment has to be reused by the
 * engine's own id and direction, and only the edges strictly inside the gap
 * may be new.
 */

/**
 * A rectangular gap whose rim carries six nodes -- the two extra sit
 * mid-side, the way a real rim does wherever a neighbour was densified.
 *
 * The edge ids deliberately look nothing like their endpoints: a real rim
 * carries edges left behind by splitting, whose id was never a function of
 * the nodes they run between. Anything deriving an id from the endpoints
 * would mint a duplicate here and the seam would look joined without being
 * joined, so the fixture makes that failure visible.
 */
function rimLoop() {
  const nodeIds = ["a", "b", "c", "d", "e", "f"];
  return {
    nodeIds,
    centroid: { x: 2, y: 0, z: 2 },
    boundary: [
      { edgeId: "split:17", reversed: false },
      { edgeId: "split:04", reversed: true },
      { edgeId: "split:29", reversed: false },
      { edgeId: "split:88", reversed: false },
      { edgeId: "split:31", reversed: true },
      { edgeId: "split:56", reversed: false },
    ],
    neighbours: [
      { surfaceType: "terrain", physical: true },
      { surfaceType: "terrain", physical: true },
      { surfaceType: "path", physical: true },
    ],
  };
}

function createFakeRuntime(loops) {
  const positions = new Map([
    ["a", { x: 0, y: 0, z: 0 }],
    ["b", { x: 2, y: 0, z: 0 }],
    ["c", { x: 4, y: 0, z: 0 }],
    ["d", { x: 4, y: 0, z: 4 }],
    ["e", { x: 2, y: 0, z: 4 }],
    ["f", { x: 0, y: 0, z: 4 }],
    // A square road standing in the middle of the gap, touching none of its
    // borders -- the shape the engine reports as an outline and never as
    // something to fill.
    ["r1", { x: 1, y: 0, z: 1 }],
    ["r2", { x: 3, y: 0, z: 1 }],
    ["r3", { x: 3, y: 0, z: 3 }],
    ["r4", { x: 1, y: 0, z: 3 }],
  ]);
  const addedPatches = [];
  return {
    addedPatches,
    runtime: {
      getUnfilledLoops: () => loops,
      getSnapshot: () => ({
        tableId: "table-1",
        map: { nodePositions: new Map([...positions].map(([id, position]) => [id, { position }])) },
      }),
      addPatch(patch) {
        addedPatches.push(patch);
        return { createdSurfaceKeys: patch.regions.map((region) => ["@region", region.regionId]), skippedRegionIds: [] };
      },
    },
  };
}

/** Every oriented use the patch's regions walk, flattened. */
function allUses(patch) {
  return patch.regions.flatMap((region) => region.boundary);
}

test("without a mesh the gap comes back as one face over the rim, verbatim", () => {
  const loop = rimLoop();
  const context = createFakeRuntime([loop]);

  const filled = fillUnfilledLoops(context.runtime, ["a"], "terrain", "cause-1");

  assert.equal(filled, 1);
  const [patch] = context.addedPatches;
  assert.equal(patch.regions.length, 1);
  assert.deepEqual(patch.regions[0].boundary, loop.boundary);
  assert.deepEqual(patch.edges, [], "one face over an existing rim declares no edge");
});

test("with a mesh the same gap comes back as several faces, still adding no node", () => {
  const context = createFakeRuntime([rimLoop()]);

  const filled = fillUnfilledLoops(context.runtime, ["a"], "terrain", "cause-1", { mesh: true });

  const [patch] = context.addedPatches;
  assert.ok(patch.regions.length > 1, "the gap is cut into a mesh, not covered by one sheet");
  assert.equal(filled, patch.regions.length);
  assert.deepEqual(patch.nodes, [], "every corner is a node already standing on the rim");
});

test("a mesh reuses each rim edge by the engine's own id and direction, exactly once", () => {
  const loop = rimLoop();
  const context = createFakeRuntime([loop]);

  fillUnfilledLoops(context.runtime, ["a"], "terrain", "cause-1", { mesh: true });
  const [patch] = context.addedPatches;
  const uses = allUses(patch);

  for (const rimUse of loop.boundary) {
    const matching = uses.filter((use) => use.edgeId === rimUse.edgeId);
    assert.equal(matching.length, 1, `${rimUse.edgeId} is walked by exactly one face of the mesh`);
    assert.equal(
      matching[0].reversed,
      rimUse.reversed,
      `${rimUse.edgeId} is walked the way the engine says, or the face has no room and is refused`,
    );
  }

  const declared = new Set(patch.edges.map((edge) => edge.edgeId));
  for (const rimUse of loop.boundary) {
    assert.ok(!declared.has(rimUse.edgeId), `${rimUse.edgeId} already exists; redeclaring it would mint a duplicate`);
  }
});

test("a mesh's own interior edges are new, and each is shared by the two faces either side", () => {
  const loop = rimLoop();
  const context = createFakeRuntime([loop]);

  fillUnfilledLoops(context.runtime, ["a"], "terrain", "cause-1", { mesh: true });
  const [patch] = context.addedPatches;

  const rimIds = new Set(loop.boundary.map((use) => use.edgeId));
  const interior = allUses(patch).filter((use) => !rimIds.has(use.edgeId));
  assert.ok(interior.length > 0, "cutting a six-node rim into triangles needs interior edges");

  const declared = new Set(patch.edges.map((edge) => edge.edgeId));
  const walkedBoth = new Map();
  for (const use of interior) {
    assert.ok(declared.has(use.edgeId), `${use.edgeId} is new, so the patch has to declare it`);
    walkedBoth.set(use.edgeId, [...(walkedBoth.get(use.edgeId) ?? []), use.reversed]);
  }
  for (const [edgeId, directions] of walkedBoth) {
    assert.equal(directions.length, 2, `${edgeId} is interior, so a face stands on each side of it`);
    assert.notEqual(directions[0], directions[1], `${edgeId} is walked opposite ways, one face per side`);
  }
});

test("a rim too small to cut is filled whole rather than dropped", () => {
  const loop = { ...rimLoop(), nodeIds: ["a", "b", "c"], boundary: rimLoop().boundary.slice(0, 3) };
  const context = createFakeRuntime([loop]);

  const filled = fillUnfilledLoops(context.runtime, ["a"], "terrain", "cause-1", { mesh: true });

  assert.equal(filled, 1);
  assert.deepEqual(context.addedPatches[0].regions[0].boundary, loop.boundary, "a triangle is already its own mesh");
});

/** The road's own boundary loop, in the road's own walk order. */
function roadIsland() {
  const ids = ["r1", "r2", "r3", "r4"];
  return ids.map((id, index) => ({
    edgeId: `road:${index}`,
    reversed: index % 2 === 0,
    startNodeId: id,
    endNodeId: ids[(index + 1) % ids.length],
  }));
}

test("a mesh opens around a face standing inside the gap instead of covering it", () => {
  const context = createFakeRuntime([rimLoop()]);
  const island = roadIsland();

  fillUnfilledLoops(context.runtime, ["a"], "terrain", "cause-1", { mesh: true, islands: [island] });
  const [patch] = context.addedPatches;

  // Every one of the road's own edges is walked by the mesh, and walked the
  // *opposite* way to the road: the road holds one side of each, the mended
  // ground takes the other. Without this the two banks are joined straight
  // over the top of the road.
  const uses = patch.regions.flatMap((region) => region.boundary);
  for (const edge of island) {
    const matching = uses.filter((use) => use.edgeId === edge.edgeId);
    assert.equal(matching.length, 1, `${edge.edgeId} bounds the opening exactly once`);
    assert.equal(matching[0].reversed, !edge.reversed, `${edge.edgeId} is taken from the side the road left free`);
  }

  const declared = new Set(patch.edges.map((edge) => edge.edgeId));
  for (const edge of island) {
    assert.ok(!declared.has(edge.edgeId), `${edge.edgeId} is the road's own edge; redeclaring it would mint a duplicate`);
  }

  // And no face spans the road: nothing walks a pair of opposite corners of
  // the opening, which is exactly what bridging across it would need.
  for (const region of patch.regions) {
    const corners = new Set(region.regionId.split("|"));
    assert.ok(!(corners.has("r1") && corners.has("r3")), "no face bridges the road corner to corner");
    assert.ok(!(corners.has("r2") && corners.has("r4")), "no face bridges the road corner to corner");
  }
});

test("an island belonging to some other gap is left out of this one", () => {
  const context = createFakeRuntime([rimLoop()]);
  // The same road, moved well outside the rim.
  const elsewhere = roadIsland().map((edge) => ({ ...edge, edgeId: `far:${edge.edgeId}` }));
  context.runtime.getSnapshot = () => ({
    tableId: "table-1",
    map: {
      nodePositions: new Map([
        ["a", { position: { x: 0, y: 0, z: 0 } }],
        ["b", { position: { x: 2, y: 0, z: 0 } }],
        ["c", { position: { x: 4, y: 0, z: 0 } }],
        ["d", { position: { x: 4, y: 0, z: 4 } }],
        ["e", { position: { x: 2, y: 0, z: 4 } }],
        ["f", { position: { x: 0, y: 0, z: 4 } }],
        ["r1", { position: { x: 51, y: 0, z: 51 } }],
        ["r2", { position: { x: 53, y: 0, z: 51 } }],
        ["r3", { position: { x: 53, y: 0, z: 53 } }],
        ["r4", { position: { x: 51, y: 0, z: 53 } }],
      ]),
    },
  });

  fillUnfilledLoops(context.runtime, ["a"], "terrain", "cause-1", { mesh: true, islands: [elsewhere] });
  const [patch] = context.addedPatches;

  const uses = patch.regions.flatMap((region) => region.boundary);
  assert.ok(!uses.some((use) => use.edgeId.startsWith("far:")), "a face outside this gap is none of its business");
});
