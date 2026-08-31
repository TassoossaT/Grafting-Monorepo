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
