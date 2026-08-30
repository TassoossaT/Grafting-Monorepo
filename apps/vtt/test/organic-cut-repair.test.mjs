import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCutRepairLattice,
  planOrganicCutRepair,
  repairOrganicCut,
} from "../src/features/edit-construction/structure-types/organic/organic-cut-repair.ts";

/**
 * Every test here targets the redesigned repair: a cut's hole is *filled*
 * with a fresh lattice from terrain's own generator
 * (`buildIrregularQuadGrid`), welded by real node id onto whatever real
 * geometry it meets, never a corner remapped on an untouched neighbour.
 */

// ---------------------------------------------------------------------------
// planOrganicCutRepair -- pure, given an already-built lattice
// ---------------------------------------------------------------------------

/** A 4x4 square hole, centred at (2, 2) -- enough for `buildCutRepairLattice`'s own lattice to fully cover it. */
const SQUARE_HOLE = [
  [
    { id: "p0", position: { x: 0, y: 0, z: 0 } },
    { id: "p1", position: { x: 4, y: 0, z: 0 } },
    { id: "p2", position: { x: 4, y: 0, z: 4 } },
    { id: "p3", position: { x: 0, y: 0, z: 4 } },
  ],
];

test("planOrganicCutRepair fills the hole with a lattice welded onto the hole's own rim ids", () => {
  const lattice = buildCutRepairLattice(SQUARE_HOLE, "cause-square");
  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeLoops: SQUARE_HOLE,
    paintedNodes: [],
    occupiedQuads: new Set(),
  });

  assert.notEqual(patch, undefined);
  assert.ok(patch.regions.length > 0, "at least one quad of the lattice landed inside the hole");
  for (const region of patch.regions) assert.equal(region.surfaceType, "terrain");

  const usedIds = new Set(patch.nodes.map((node) => node.id));
  // Every node this patch declares is either the hole's own rim (a real weld)
  // or a freshly minted lattice vertex -- never an id from nowhere.
  for (const id of usedIds) {
    assert.ok(id.startsWith("terrain-cut:cause-square:") || ["p0", "p1", "p2", "p3"].includes(id), `unexpected id ${id}`);
  }
  // The whole point: the fill actually reaches every side of the hole it was
  // built from, not just a corner of it.
  assert.deepEqual(["p0", "p1", "p2", "p3"].filter((id) => usedIds.has(id)).sort(), ["p0", "p1", "p2", "p3"]);
});

test("planOrganicCutRepair welds a lattice vertex onto a real painted node, not merely near it", () => {
  const lattice = buildCutRepairLattice(SQUARE_HOLE, "cause-square");
  // A vertex the lattice itself already generated -- placing a painted node
  // exactly there is what a real weld looks like: the same id must appear in
  // the patch, not a second node coincident with it.
  const interior = lattice.mesh.vertices[10];
  const world = { x: lattice.originX + interior.x, y: 1.5, z: lattice.originZ + interior.y };

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeLoops: SQUARE_HOLE,
    paintedNodes: [{ id: "painted-A", position: world }],
    occupiedQuads: new Set(),
  });

  const weldedNode = patch.nodes.find((node) => node.id === "painted-A");
  assert.notEqual(weldedNode, undefined, "the painted node's own id was reused, not shadowed by a minted one");
  assert.deepEqual(weldedNode.position, world);
});

test("planOrganicCutRepair drops every quad already claimed by something else", () => {
  const lattice = buildCutRepairLattice(SQUARE_HOLE, "cause-square");
  const everyQuad = new Set(lattice.mesh.quads.map((_, index) => index));

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeLoops: SQUARE_HOLE,
    paintedNodes: [],
    occupiedQuads: everyQuad,
  });

  assert.equal(patch, undefined, "nothing survives once every quad is already claimed");
});

test("planOrganicCutRepair regenerates nothing when the hole is nowhere near the lattice", () => {
  const lattice = buildCutRepairLattice(SQUARE_HOLE, "cause-square");
  const farHole = [
    [
      { id: "f0", position: { x: 1000, y: 0, z: 1000 } },
      { id: "f1", position: { x: 1004, y: 0, z: 1000 } },
      { id: "f2", position: { x: 1004, y: 0, z: 1004 } },
      { id: "f3", position: { x: 1000, y: 0, z: 1004 } },
    ],
  ];

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeLoops: farHole,
    paintedNodes: [],
    occupiedQuads: new Set(),
  });

  assert.equal(patch, undefined);
});

// ---------------------------------------------------------------------------
// repairOrganicCut -- fetch, delete, generate, weld, commit
// ---------------------------------------------------------------------------

/**
 * T1 (consumed) and T2 (an untouched survivor) share the edge n2~n3. Unlike
 * the old corner-patching design, T2 is never a candidate for anything this
 * repair does -- it never appears in `getRegionTopology` results the plan
 * reads, and `classifyPoints` reports every point over T2's own footprint as
 * occupied, exactly the way a real neighbouring face would. The repair's
 * whole job is to fill T1's own hole and stop exactly at T2's edge.
 */
function createFakeTerrainRuntime() {
  const positions = new Map([
    ["n1", { x: 0, y: 0, z: 0 }],
    ["n2", { x: 2, y: 0, z: 0 }],
    ["n3", { x: 2, y: 0, z: 2 }],
    ["n4", { x: 0, y: 0, z: 2 }],
    ["n5", { x: 4, y: 0, z: 0 }],
    ["n6", { x: 4, y: 0, z: 2 }],
  ]);

  const regions = new Map([
    ["T1", { surfaceKey: ["@region", "T1"], surfaceType: "terrain", physical: true, nodes: ["n1", "n2", "n3", "n4"].map((id) => ({ id, position: positions.get(id) })) }],
    ["T2", { surfaceKey: ["@region", "T2"], surfaceType: "terrain", physical: true, nodes: ["n2", "n5", "n6", "n3"].map((id) => ({ id, position: positions.get(id) })) }],
  ]);

  const deleted = [];
  const addedPatches = [];
  let refuseReplacement = false;

  function deleteBySurfaceKey(surfaceKey) {
    const key = surfaceKey.join("|");
    for (const [id, region] of regions) {
      if (region.surfaceKey.join("|") === key) {
        regions.delete(id);
        deleted.push(surfaceKey);
      }
    }
  }

  const runtime = {
    getRegionTopology(surfaceKey) {
      const key = surfaceKey.join("|");
      for (const region of regions.values()) if (region.surfaceKey.join("|") === key) return region;
      return undefined;
    },
    applyRegionEdit(ops) {
      for (const op of ops) if (op.kind === "delete-region") deleteBySurfaceKey(op.surfaceKey);
    },
    getUnfilledLoops(scope) {
      // T1's own full rim -- the real closed loop its deletion exposes on
      // its own side, even where T2 still stands on the other side of the
      // shared n2~n3 edge.
      const rim = ["n1", "n2", "n3", "n4"];
      if (!rim.every((id) => scope.includes(id))) return [];
      return [{ nodeIds: rim }];
    },
    getSnapshot() {
      return { tableId: "table-1", map: { nodePositions: new Map([...positions].map(([id, position]) => [id, { position }])) } };
    },
    // T2's own footprint (x in [2, 4], z in [0, 2]) is occupied ground --
    // the same primitive `terrain-sculpt-tool.ts`'s `blockOccupiedQuads`
    // reads, standing in here for "a real neighbour already claims this."
    classifyPoints(points) {
      const hits = [];
      points.forEach(([x, z], index) => {
        if (x >= 2 && x <= 4 && z >= 0 && z <= 2) hits.push({ index, surfaceKey: ["@region", "T2"], surfaceType: "terrain" });
      });
      return hits;
    },
    applyPatchReplacement(request) {
      if (refuseReplacement) {
        throw new Error(`patch replacement target patch was refused: ${request.patch.regions.map((r) => r.regionId).join(", ")}`);
      }
      for (const surfaceKey of request.sourceSurfaceKeys) deleteBySurfaceKey(surfaceKey);
      addedPatches.push(request.patch);
      for (const region of request.patch.regions) {
        regions.set(region.regionId, { surfaceKey: ["@region", region.regionId], surfaceType: region.surfaceType, physical: region.physical, nodes: [] });
      }
    },
  };

  return { runtime, deleted, addedPatches, refuseNextReplacement: () => { refuseReplacement = true; } };
}

test("repairOrganicCut deletes exactly the consumed face, leaves the survivor untouched, and fills the hole with a real lattice", () => {
  const { runtime, deleted, addedPatches } = createFakeTerrainRuntime();

  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [] }, "cause-1");

  assert.ok(rebuilt > 0, "at least one lattice quad filled T1's own hole");
  assert.deepEqual(deleted.map((key) => key.join("|")), ["@region|T1"], "T2 is never deleted -- this repair never touches a survivor");
  assert.equal(addedPatches.length, 1);

  const [patch] = addedPatches;
  assert.equal(patch.regions.length, rebuilt);
  for (const region of patch.regions) {
    for (const use of region.boundary) {
      assert.notEqual(use.edgeId.includes("n5"), true, "n5 belongs only to T2's own untouched corner");
      assert.notEqual(use.edgeId.includes("n6"), true, "n6 belongs only to T2's own untouched corner");
    }
  }

  // T2 itself is exactly as it was -- never renamed, never rebuilt.
  const survivor = runtime.getRegionTopology(["@region", "T2"]);
  assert.notEqual(survivor, undefined);
  assert.deepEqual(survivor.nodes.map((node) => node.id), ["n2", "n5", "n6", "n3"]);
});

test("consuming nothing is a no-op", () => {
  const { runtime, deleted, addedPatches } = createFakeTerrainRuntime();
  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [], paintedNodes: [] }, "cause-1");

  assert.equal(rebuilt, 0);
  assert.equal(deleted.length, 0);
  assert.equal(addedPatches.length, 0);
});

test("a fill the engine refuses is a thrown error, and nothing new is left half-committed", () => {
  const { runtime, deleted, addedPatches, refuseNextReplacement } = createFakeTerrainRuntime();
  refuseNextReplacement();

  assert.throws(() => repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [] }, "cause-1"), /refused/);
  // Only T1 (deleted via applyRegionEdit before the fill was even attempted)
  // is gone. The refused applyPatchReplacement call commits nothing.
  assert.deepEqual(deleted.map((key) => key.join("|")), ["@region|T1"]);
  assert.equal(addedPatches.length, 0);
});
