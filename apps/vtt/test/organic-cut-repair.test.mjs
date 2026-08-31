import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCutRepairLattice,
  densifyPaintedEdges,
  planOrganicCutRepair,
  repairOrganicCut,
} from "../src/features/edit-construction/structure-types/organic/organic-cut-repair.ts";

/**
 * Every test here targets the redesigned repair: a cut's hole is *filled*
 * with a fresh lattice from terrain's own generator
 * (`buildIrregularQuadGrid`), welded by real node id onto whatever real
 * geometry it meets, never a corner remapped on an untouched neighbour.
 *
 * The hole's own shape (`holeShapeRings`) is positions only -- a fact of
 * what got consumed, not itself a weld source, since those ids may no
 * longer be live after deletion. Weld candidates are a separate,
 * deliberately real, list (`candidates`).
 */

// ---------------------------------------------------------------------------
// planOrganicCutRepair -- pure, given an already-built lattice
// ---------------------------------------------------------------------------

/** A 4x4 square hole, centred at (2, 2) -- enough for `buildCutRepairLattice`'s own lattice to fully cover it. */
const SQUARE_HOLE_SHAPE = [
  [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 4, y: 0, z: 4 },
    { x: 0, y: 0, z: 4 },
  ],
];

/** The same square's own four corners, as real weldable candidates. */
const SQUARE_HOLE_CANDIDATES = [
  { id: "p0", position: { x: 0, y: 0, z: 0 } },
  { id: "p1", position: { x: 4, y: 0, z: 0 } },
  { id: "p2", position: { x: 4, y: 0, z: 4 } },
  { id: "p3", position: { x: 0, y: 0, z: 4 } },
];

test("planOrganicCutRepair fills the hole with a lattice welded onto the hole's own rim ids", () => {
  const lattice = buildCutRepairLattice(SQUARE_HOLE_SHAPE, SQUARE_HOLE_CANDIDATES, "cause-square");
  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeShapeRings: SQUARE_HOLE_SHAPE,
    candidates: SQUARE_HOLE_CANDIDATES,
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

test("buildCutRepairLattice pins a lattice vertex exactly onto a real painted node's own position", () => {
  // A position nowhere near any lattice vertex the *unpinned* generator
  // would have produced on its own -- if it shows up exactly, pinning (not
  // luck) put it there.
  const painted = { id: "painted-A", position: { x: 2.137, y: 1.5, z: 1.863 } };
  const lattice = buildCutRepairLattice(SQUARE_HOLE_SHAPE, [painted], "cause-square");

  const landedExactly = lattice.mesh.vertices.some(
    (local) => lattice.originX + local.x === painted.position.x && lattice.originZ + local.y === painted.position.z,
  );
  assert.ok(landedExactly, "some lattice vertex was pinned exactly onto the painted node's own position");
});

test("planOrganicCutRepair welds a pinned lattice vertex onto a real painted node, not merely near it", () => {
  // The hole's own centre -- comfortably inside every candidate quad's own
  // reach, so whichever quad ends up owning this vertex is a plain, simple
  // one, not one straddling the rim.
  const painted = { id: "painted-A", position: { x: 2, y: 1.5, z: 2 } };
  const lattice = buildCutRepairLattice(SQUARE_HOLE_SHAPE, [painted], "cause-square");

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeShapeRings: SQUARE_HOLE_SHAPE,
    candidates: [painted],
    occupiedQuads: new Set(),
  });

  const weldedNode = patch.nodes.find((node) => node.id === "painted-A");
  assert.notEqual(weldedNode, undefined, "the painted node's own id was reused, not shadowed by a minted one");
  assert.deepEqual(weldedNode.position, painted.position);
});

test("planOrganicCutRepair drops every quad already claimed by something else", () => {
  const lattice = buildCutRepairLattice(SQUARE_HOLE_SHAPE, SQUARE_HOLE_CANDIDATES, "cause-square");
  const everyQuad = new Set(lattice.mesh.quads.map((_, index) => index));

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeShapeRings: SQUARE_HOLE_SHAPE,
    candidates: SQUARE_HOLE_CANDIDATES,
    occupiedQuads: everyQuad,
  });

  assert.equal(patch, undefined, "nothing survives once every quad is already claimed");
});

test("planOrganicCutRepair regenerates nothing when the hole is nowhere near the lattice", () => {
  const lattice = buildCutRepairLattice(SQUARE_HOLE_SHAPE, SQUARE_HOLE_CANDIDATES, "cause-square");
  const farHoleShape = [
    [
      { x: 1000, y: 0, z: 1000 },
      { x: 1004, y: 0, z: 1000 },
      { x: 1004, y: 0, z: 1004 },
      { x: 1000, y: 0, z: 1004 },
    ],
  ];

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeShapeRings: farHoleShape,
    candidates: [],
    occupiedQuads: new Set(),
  });

  assert.equal(patch, undefined);
});

// ---------------------------------------------------------------------------
// densifyPaintedEdges -- subdividing a sparse painted edge into real anchors
// ---------------------------------------------------------------------------

function createInsertTrackingRuntime() {
  const inserts = [];
  return {
    inserts,
    runtime: {
      applyRegionEdit(ops) {
        for (const op of ops) if (op.kind === "insert-vertex") inserts.push(op);
      },
    },
  };
}

test("densifyPaintedEdges subdivides a long painted edge near the hole into real interior anchors", () => {
  const { runtime, inserts } = createInsertTrackingRuntime();
  const holeShape = [
    [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: 2 },
      { x: 0, y: 0, z: 2 },
    ],
  ];
  const paintedNodes = [
    { id: "p-start", position: { x: 0, y: 0.2, z: 0 } },
    { id: "p-end", position: { x: 10, y: 0.2, z: 0 } },
  ];
  const paintedEdges = [{ edgeId: "table-1:seg:p-end~p-start", startNodeId: "p-start", endNodeId: "p-end" }];

  const created = densifyPaintedEdges(runtime, "table-1", "cause-1", holeShape, paintedNodes, paintedEdges);

  // A 10-unit run at this generator's 1-unit anchor spacing (half a 2-unit
  // lattice cell, deliberately tighter -- see ANCHOR_SPACING's own doc)
  // splits into 10 segments -- 9 real interior anchors, each an actual
  // insert-vertex op, not merely computed and discarded.
  assert.equal(created.length, 9);
  assert.equal(inserts.length, 9);
  const xs = created.map((node) => node.position.x).sort((a, b) => a - b);
  assert.deepEqual(xs, [1, 2, 3, 4, 5, 6, 7, 8, 9], "anchors land evenly along the run, one anchor-spacing apart");
  for (const node of created) {
    assert.equal(node.position.y, 0.2, "interpolated from the edge's own endpoints, not an arbitrary height");
    assert.equal(node.position.z, 0);
  }
});

test("densifyPaintedEdges leaves a short painted edge alone", () => {
  const { runtime, inserts } = createInsertTrackingRuntime();
  const holeShape = [
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 2 },
      { x: 0, y: 0, z: 2 },
    ],
  ];
  const paintedNodes = [
    { id: "p-start", position: { x: 0, y: 0, z: 0 } },
    { id: "p-end", position: { x: 0.8, y: 0, z: 0 } },
  ];
  const paintedEdges = [{ edgeId: "table-1:seg:p-end~p-start", startNodeId: "p-start", endNodeId: "p-end" }];

  const created = densifyPaintedEdges(runtime, "table-1", "cause-1", holeShape, paintedNodes, paintedEdges);

  assert.equal(created.length, 0, "already short enough to weld onto its own two endpoints");
  assert.equal(inserts.length, 0);
});

test("densifyPaintedEdges ignores a painted edge nowhere near the hole", () => {
  const { runtime, inserts } = createInsertTrackingRuntime();
  const holeShape = [
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 2 },
      { x: 0, y: 0, z: 2 },
    ],
  ];
  const paintedNodes = [
    { id: "p-start", position: { x: 1000, y: 0, z: 1000 } },
    { id: "p-end", position: { x: 1010, y: 0, z: 1000 } },
  ];
  const paintedEdges = [{ edgeId: "table-1:seg:p-end~p-start", startNodeId: "p-start", endNodeId: "p-end" }];

  const created = densifyPaintedEdges(runtime, "table-1", "cause-1", holeShape, paintedNodes, paintedEdges);

  assert.equal(created.length, 0);
  assert.equal(inserts.length, 0);
});

// ---------------------------------------------------------------------------
// repairOrganicCut -- fetch, delete, generate, weld, commit
// ---------------------------------------------------------------------------

/** A region's own outer loop, as the plain `{startNodeId}` cycle `repairOrganicCut` actually reads. */
function outerLoopOf(nodeIds) {
  return [nodeIds.map((id) => ({ startNodeId: id }))];
}

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
    [
      "T1",
      {
        surfaceKey: ["@region", "T1"],
        surfaceType: "terrain",
        physical: true,
        outerLoops: outerLoopOf(["n1", "n2", "n3", "n4"]),
        nodes: ["n1", "n2", "n3", "n4"].map((id) => ({ id, position: positions.get(id) })),
      },
    ],
    [
      "T2",
      {
        surfaceKey: ["@region", "T2"],
        surfaceType: "terrain",
        physical: true,
        outerLoops: outerLoopOf(["n2", "n5", "n6", "n3"]),
        nodes: ["n2", "n5", "n6", "n3"].map((id) => ({ id, position: positions.get(id) })),
      },
    ],
  ]);

  const deleted = [];
  const addedPatches = [];
  let refuseFirstRegion = false;
  let throwOnAdd = false;

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
    // Real addPatch semantics (region_editing.rs's apply_add_patch, and its
    // own outcome shape): a region with no room is skipped, reported, and
    // costs nothing else in the same batch. `throwOnAdd` stands in for the
    // genuinely fatal case -- something other than "this one face had no
    // room" -- which is the only case repairOrganicCut still treats as an
    // error.
    addPatch(patch) {
      if (throwOnAdd) throw new Error("add patch failed: something other than a refused face");
      addedPatches.push(patch);
      const createdSurfaceKeys = [];
      const skippedRegionIds = [];
      patch.regions.forEach((region, index) => {
        if (refuseFirstRegion && index === 0) {
          skippedRegionIds.push(region.regionId);
          return;
        }
        regions.set(region.regionId, {
          surfaceKey: ["@region", region.regionId],
          surfaceType: region.surfaceType,
          physical: region.physical,
          outerLoops: [],
          nodes: [],
        });
        createdSurfaceKeys.push(["@region", region.regionId]);
      });
      return { createdSurfaceKeys, skippedRegionIds };
    },
  };

  return {
    runtime,
    deleted,
    addedPatches,
    refuseFirstSubmittedRegion: () => { refuseFirstRegion = true; },
    throwOnNextAdd: () => { throwOnAdd = true; },
  };
}

test("repairOrganicCut deletes exactly the consumed face, leaves the survivor untouched, and fills the hole with a real lattice", () => {
  const { runtime, deleted, addedPatches } = createFakeTerrainRuntime();

  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [], paintedEdges: [] }, "cause-1");

  assert.ok(rebuilt > 0, "at least one lattice quad filled T1's own hole");
  assert.deepEqual(deleted.map((key) => key.join("|")), ["@region|T1"], "T2 is never deleted -- this repair never touches a survivor");
  assert.equal(addedPatches.length, 1);

  const [patch] = addedPatches;
  assert.equal(patch.regions.length, rebuilt, "nothing was refused in this fixture, so every submitted region landed");
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

test("repairOrganicCut fills the hole even when nothing survives to expose a rim (getUnfilledLoops empty)", () => {
  // The whole point of sourcing the hole's shape from the consumed
  // topology's own geometry, not getUnfilledLoops: this fixture consumes
  // BOTH T1 and T2 in the same cut, leaving no surviving terrain neighbour
  // at all (getUnfilledLoops has nothing terrain-side to report), yet the
  // hole still has a real shape and a real painted contour to weld onto.
  const { runtime } = createFakeTerrainRuntime();
  runtime.getUnfilledLoops = () => [];

  const painted = { id: "painted-A", position: { x: 1, y: 0.5, z: 1 } };
  const rebuilt = repairOrganicCut(
    runtime,
    {
      consumedSurfaceKeys: [["@region", "T1"], ["@region", "T2"]],
      paintedNodes: [painted],
      paintedEdges: [],
    },
    "cause-1",
  );

  assert.ok(rebuilt > 0, "the hole's own shape came from the consumed topology, not from an exposed rim that never existed");
});

test("consuming nothing is a no-op", () => {
  const { runtime, deleted, addedPatches } = createFakeTerrainRuntime();
  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [], paintedNodes: [], paintedEdges: [] }, "cause-1");

  assert.equal(rebuilt, 0);
  assert.equal(deleted.length, 0);
  assert.equal(addedPatches.length, 0);
});

test("a region the engine finds no room for is skipped, not fatal to the rest of the fill", () => {
  const { runtime, addedPatches, refuseFirstSubmittedRegion } = createFakeTerrainRuntime();
  refuseFirstSubmittedRegion();

  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [], paintedEdges: [] }, "cause-1");

  const [patch] = addedPatches;
  assert.ok(patch.regions.length > 1, "the fixture needs more than one region for this to test anything");
  assert.equal(rebuilt, patch.regions.length - 1, "every region except the refused one still landed");
});

test("an add the engine flatly rejects (not merely a refused face) is a thrown error, and nothing new is left half-committed", () => {
  const { runtime, deleted, addedPatches, throwOnNextAdd } = createFakeTerrainRuntime();
  throwOnNextAdd();

  assert.throws(() => repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [], paintedEdges: [] }, "cause-1"), /fill failed/);
  // Only T1 (deleted via applyRegionEdit before the fill was even attempted)
  // is gone. addPatch itself threw before registering anything.
  assert.deepEqual(deleted.map((key) => key.join("|")), ["@region|T1"]);
  assert.equal(addedPatches.length, 0);
});
