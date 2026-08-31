import assert from "node:assert/strict";
import test from "node:test";

import { repairOrganicCut } from "../src/features/edit-construction/structure-types/organic/organic-cut-repair.ts";
import { sharedEdgeId } from "../src/features/edit-construction/topology/boundary-edges.ts";

/**
 * The repair computes the ground it owes back rather than generating it:
 * the fill is *what the cut removed, minus what the painter now occupies*,
 * a polygon difference, registered as faces whose vertices weld onto the
 * real nodes they already sit on.
 *
 * Every test here asserts against that contract -- what lands, where it
 * lands, and (the whole point of this repair) that the seam it leaves is
 * made of the painter's and the rim's own real node ids, not fresh ones
 * sitting coincidentally on top of them.
 */

/** A region's own outer loop, as the plain `{startNodeId}` cycle `repairOrganicCut` actually reads. */
function outerLoopOf(nodeIds) {
  return [nodeIds.map((id) => ({ startNodeId: id }))];
}

/**
 * One 4x4 terrain quad (T1) over (0,0)-(4,4), with a second, untouched one
 * (T2) beside it sharing the n2~n3 edge. T1 is what a cut consumes; T2 must
 * never be touched, and its rim is what the fill welds onto.
 */
function createFakeTerrainRuntime() {
  const positions = new Map([
    ["n1", { x: 0, y: 0, z: 0 }],
    ["n2", { x: 4, y: 0, z: 0 }],
    ["n3", { x: 4, y: 0, z: 4 }],
    ["n4", { x: 0, y: 0, z: 4 }],
    ["n5", { x: 8, y: 0, z: 0 }],
    ["n6", { x: 8, y: 0, z: 4 }],
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
  const inserts = [];
  let refuseFirstRegion = false;

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
      for (const op of ops) {
        if (op.kind === "delete-region") deleteBySurfaceKey(op.surfaceKey);
        if (op.kind === "insert-vertex") inserts.push(op);
      }
    },
    getUnfilledLoops(scope) {
      // T1's own rim, exposed by its deletion. `boundary` carries each edge's
      // own true direction, the shape the real engine returns.
      const rim = ["n1", "n2", "n3", "n4"];
      if (!rim.every((id) => scope.includes(id))) return [];
      const boundary = rim.map((id, index) => {
        const next = rim[(index + 1) % rim.length];
        const [start] = id < next ? [id, next] : [next, id];
        return { edgeId: sharedEdgeId("table-1", id, next), reversed: id !== start };
      });
      return [{ nodeIds: rim, boundary }];
    },
    getSnapshot() {
      return { tableId: "table-1", map: { nodePositions: new Map([...positions].map(([id, position]) => [id, { position }])) } };
    },
    addPatch(patch) {
      addedPatches.push(patch);
      const createdSurfaceKeys = [];
      const skippedRegionIds = [];
      patch.regions.forEach((region, index) => {
        if (refuseFirstRegion && index === 0) {
          skippedRegionIds.push(region.regionId);
          return;
        }
        createdSurfaceKeys.push(["@region", region.regionId]);
      });
      return { createdSurfaceKeys, skippedRegionIds };
    },
  };

  return {
    runtime,
    positions,
    deleted,
    addedPatches,
    inserts,
    refuseFirstSubmittedRegion: () => { refuseFirstRegion = true; },
  };
}

/** Every node id the patch's own regions actually walk, in no particular order. */
function boundaryNodeIds(patch) {
  const byEdgeId = new Map(patch.edges.map((edge) => [edge.edgeId, edge]));
  const ids = new Set();
  for (const region of patch.regions) {
    for (const use of region.boundary) {
      const edge = byEdgeId.get(use.edgeId);
      if (edge === undefined) continue;
      ids.add(edge.startNodeId);
      ids.add(edge.endNodeId);
    }
  }
  return ids;
}

test("a cut with no painter geometry gives the whole consumed area back, welded onto its own rim", () => {
  const { runtime, deleted, addedPatches } = createFakeTerrainRuntime();

  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [], paintedEdges: [] }, "cause-1");

  assert.ok(rebuilt > 0, "the consumed area came back as at least one face");
  assert.deepEqual(deleted.map((key) => key.join("|")), ["@region|T1"], "T2 is never deleted -- this repair never touches a survivor");
  assert.equal(addedPatches.length, 1);

  const [patch] = addedPatches;
  // The fill comes back as a mesh of cells at terrain's own scale, not as
  // one big face over the whole consumed area.
  assert.ok(patch.regions.length > 1, `the fill is a mesh of cells, got ${patch.regions.length} face(s)`);

  // And every one of T1's own corners is still welded by id -- a real,
  // still-live rim node, not a fresh one sitting on top of it.
  const used = boundaryNodeIds(patch);
  for (const id of ["n1", "n2", "n3", "n4"]) {
    assert.ok(used.has(id), `the fill's boundary walks the rim's own node ${id}`);
  }
});

test("the painter's own area is subtracted, and the seam runs along the painter's own real nodes", () => {
  const { runtime, addedPatches, inserts } = createFakeTerrainRuntime();

  // A band straight down the middle of T1, from x = 1 to x = 3, described by
  // the painter's own four real contour nodes and the edges between them.
  const paintedNodes = [
    { id: "band-a", position: { x: 1, y: 0, z: 0 } },
    { id: "band-b", position: { x: 3, y: 0, z: 0 } },
    { id: "band-c", position: { x: 3, y: 0, z: 4 } },
    { id: "band-d", position: { x: 1, y: 0, z: 4 } },
  ];
  const paintedEdges = [
    { edgeId: "table-1:seg:band-a~band-b", startNodeId: "band-a", endNodeId: "band-b" },
    { edgeId: "table-1:seg:band-b~band-c", startNodeId: "band-b", endNodeId: "band-c" },
    { edgeId: "table-1:seg:band-c~band-d", startNodeId: "band-c", endNodeId: "band-d" },
    { edgeId: "table-1:seg:band-a~band-d", startNodeId: "band-d", endNodeId: "band-a" },
  ];

  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes, paintedEdges }, "cause-1");

  assert.ok(rebuilt > 0);
  const [patch] = addedPatches;
  // The band splits the square in two, and each side comes back as cells --
  // but no single face may ever bridge across the road.
  assert.ok(patch.regions.length >= 2, "the painter's own area split the fill");
  const positionOf = new Map(patch.nodes.map((node) => [node.id, node.position]));
  const byEdgeId = new Map(patch.edges.map((edge) => [edge.edgeId, edge]));
  for (const region of patch.regions) {
    const xs = region.boundary.flatMap((use) => {
      const edge = byEdgeId.get(use.edgeId);
      if (edge === undefined) return [];
      return [positionOf.get(edge.startNodeId)?.x, positionOf.get(edge.endNodeId)?.x].filter((x) => x !== undefined);
    });
    const touchesLeft = xs.some((x) => x < 1 - 1e-9);
    const touchesRight = xs.some((x) => x > 3 + 1e-9);
    assert.ok(!(touchesLeft && touchesRight), "no face bridges across the painter's own area");
  }

  const used = boundaryNodeIds(patch);
  // The seam: every one of the painter's own four contour nodes is walked by
  // the fill's own boundary, by id. This is the whole point of the repair --
  // a shared edge with the road, not a second node coincident with one.
  for (const id of ["band-a", "band-b", "band-c", "band-d"]) {
    assert.ok(used.has(id), `the fill's boundary walks the painter's own node ${id}`);
  }
  // And the rim is still welded on the far side of each piece.
  for (const id of ["n1", "n2", "n3", "n4"]) {
    assert.ok(used.has(id), `the fill's boundary still walks the rim's own node ${id}`);
  }
  // Nothing is left sitting coincident-but-unconnected: every vertex that
  // was not already a real node is one this repair *inserted into* a real
  // edge (rim or road), so both sides share it.
  const insertedIds = new Set(inserts.map((op) => op.nodeId));
  for (const node of patch.nodes) {
    if (node.id.startsWith("terrain-cut:")) {
      assert.ok(insertedIds.has(node.id), `${node.id} was minted free-floating instead of split into a real edge`);
    }
  }
  assert.ok(inserts.length > 0, "the seam needed real splits, and got them");
});

test("a shared edge is declared once and walked from both sides, never minted twice", () => {
  const { runtime, addedPatches } = createFakeTerrainRuntime();

  const paintedNodes = [
    { id: "band-a", position: { x: 1, y: 0, z: 0 } },
    { id: "band-b", position: { x: 3, y: 0, z: 0 } },
    { id: "band-c", position: { x: 3, y: 0, z: 4 } },
    { id: "band-d", position: { x: 1, y: 0, z: 4 } },
  ];
  const paintedEdges = [
    { edgeId: "table-1:seg:band-a~band-b", startNodeId: "band-a", endNodeId: "band-b" },
    { edgeId: "table-1:seg:band-b~band-c", startNodeId: "band-b", endNodeId: "band-c" },
    { edgeId: "table-1:seg:band-c~band-d", startNodeId: "band-c", endNodeId: "band-d" },
    { edgeId: "table-1:seg:band-a~band-d", startNodeId: "band-d", endNodeId: "band-a" },
  ];

  repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes, paintedEdges }, "cause-1");
  const [patch] = addedPatches;

  // Every edge the patch declares is named after its own node pair, so two
  // faces meeting on one line reference one edge rather than two coincident
  // ones -- the free-versus-shared distinction the engine reads.
  const declared = new Set(patch.edges.map((edge) => edge.edgeId));
  assert.equal(declared.size, patch.edges.length, "no edge id is declared twice");
  for (const edge of patch.edges) {
    assert.equal(
      edge.edgeId,
      sharedEdgeId("table-1", edge.startNodeId, edge.endNodeId),
      "every edge is named after the pair it runs between, so both sides derive the same name",
    );
  }
});

test("a fill vertex the difference itself minted borrows its height from the nearest real node", () => {
  const { runtime, addedPatches } = createFakeTerrainRuntime();

  // A band crossing only part of T1, so the difference has to cut the
  // painter's own edge somewhere no node stands -- those crossing points are
  // the only vertices this fill ever mints.
  const paintedNodes = [
    { id: "band-a", position: { x: 1, y: 2.5, z: -1 } },
    { id: "band-b", position: { x: 3, y: 2.5, z: -1 } },
    { id: "band-c", position: { x: 3, y: 2.5, z: 2 } },
    { id: "band-d", position: { x: 1, y: 2.5, z: 2 } },
  ];
  const paintedEdges = [
    { edgeId: "table-1:seg:band-a~band-b", startNodeId: "band-a", endNodeId: "band-b" },
    { edgeId: "table-1:seg:band-b~band-c", startNodeId: "band-b", endNodeId: "band-c" },
    { edgeId: "table-1:seg:band-c~band-d", startNodeId: "band-c", endNodeId: "band-d" },
    { edgeId: "table-1:seg:band-a~band-d", startNodeId: "band-d", endNodeId: "band-a" },
  ];

  repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes, paintedEdges }, "cause-1");
  const [patch] = addedPatches;

  const minted = patch.nodes.filter((node) => node.id.startsWith("terrain-cut:"));
  assert.ok(minted.length > 0, "the band's own ends cross T1's boundary where no node stands");
  for (const node of minted) {
    assert.ok(
      node.position.y === 0 || node.position.y === 2.5,
      `a minted vertex borrows a real neighbour's own height, got ${node.position.y}`,
    );
  }
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

  const paintedNodes = [
    { id: "band-a", position: { x: 1, y: 0, z: 0 } },
    { id: "band-b", position: { x: 3, y: 0, z: 0 } },
    { id: "band-c", position: { x: 3, y: 0, z: 4 } },
    { id: "band-d", position: { x: 1, y: 0, z: 4 } },
  ];
  const paintedEdges = [
    { edgeId: "table-1:seg:band-a~band-b", startNodeId: "band-a", endNodeId: "band-b" },
    { edgeId: "table-1:seg:band-b~band-c", startNodeId: "band-b", endNodeId: "band-c" },
    { edgeId: "table-1:seg:band-c~band-d", startNodeId: "band-c", endNodeId: "band-d" },
    { edgeId: "table-1:seg:band-a~band-d", startNodeId: "band-d", endNodeId: "band-a" },
  ];

  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes, paintedEdges }, "cause-1");

  const [patch] = addedPatches;
  assert.ok(patch.regions.length > 1, "the fixture needs more than one face for this to test anything");
  assert.equal(rebuilt, patch.regions.length - 1, "the refused face costs only itself; every other one still landed");
});

test("the fill never reaches past the consumed area onto a surviving neighbour", () => {
  const { runtime, addedPatches } = createFakeTerrainRuntime();

  repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [], paintedEdges: [] }, "cause-1");
  const [patch] = addedPatches;

  // T2 stands over x in [4, 8]; nothing this fill declares may sit past
  // T1's own edge at x = 4, and neither of T2's own far corners may appear.
  const used = boundaryNodeIds(patch);
  assert.ok(!used.has("n5"), "n5 belongs only to T2's own untouched corner");
  assert.ok(!used.has("n6"), "n6 belongs only to T2's own untouched corner");
  for (const node of patch.nodes) {
    assert.ok(node.position.x <= 4 + 1e-9, `a fill vertex reached past the consumed area at x=${node.position.x}`);
  }
});
