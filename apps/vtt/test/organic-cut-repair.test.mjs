import assert from "node:assert/strict";
import test from "node:test";

import { repairOrganicCut } from "../src/features/edit-construction/structure-types/organic/organic-cut-repair.ts";

/**
 * A hand-built two-quad terrain patch and the minimal runtime surface
 * repairOrganicCut actually calls -- not a re-implementation of the
 * engine's own topology/edge-sharing rules (Rust's own test suite already
 * covers getUnfilledLoops), only enough state for this function's own
 * orchestration to be verified: which regions it deletes, which nodes it
 * welds, and what it rebuilds.
 *
 * T1 -- the consumed face -- and T2 -- the survivor -- share the edge
 * n2~n3. The road's own patch registered two nodes, p-a and p-b, sitting
 * exactly where n2 and n3 already are, so the weld match is exact and the
 * test is not also asserting on the weld search radius's own value.
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

  function loopOf(cycle) {
    return cycle.map((id, index) => ({
      edgeId: `e:${id}~${cycle[(index + 1) % cycle.length]}`,
      reversed: false,
      startNodeId: id,
      endNodeId: cycle[(index + 1) % cycle.length],
      geometry: { kind: "line" },
    }));
  }

  const regions = new Map([
    [
      "T1",
      {
        surfaceKey: ["@region", "T1"],
        surfaceType: "terrain",
        physical: true,
        outerLoops: [loopOf(["n1", "n2", "n3", "n4"])],
        holes: [],
        nodes: ["n1", "n2", "n3", "n4"].map((id) => ({ id, position: positions.get(id) })),
      },
    ],
    [
      "T2",
      {
        surfaceKey: ["@region", "T2"],
        surfaceType: "terrain",
        physical: true,
        outerLoops: [loopOf(["n2", "n5", "n6", "n3"])],
        holes: [],
        nodes: ["n2", "n5", "n6", "n3"].map((id) => ({ id, position: positions.get(id) })),
      },
    ],
  ]);

  const deleted = [];
  const addedPatches = [];

  const runtime = {
    getRegionTopology(surfaceKey) {
      const key = surfaceKey.join("|");
      for (const region of regions.values()) {
        if (region.surfaceKey.join("|") === key) return region;
      }
      return undefined;
    },
    applyRegionEdit(ops) {
      for (const op of ops) {
        if (op.kind !== "delete-region") continue;
        const key = op.surfaceKey.join("|");
        for (const [id, region] of regions) {
          if (region.surfaceKey.join("|") === key) {
            regions.delete(id);
            deleted.push(op.surfaceKey);
          }
        }
      }
    },
    getUnfilledLoops(scope) {
      // T1's own nodes shared with the still-standing T2 -- exactly what a
      // real deletion exposes as free boundary. Hard-coded rather than
      // derived: this fake exists to verify repairOrganicCut's own use of
      // the primitive, not to re-derive what it reports.
      const exposed = ["n2", "n3"].filter((id) => scope.includes(id));
      if (exposed.length === 0) return [];
      return [{ boundary: [], nodeIds: exposed, centroid: { x: 2, y: 0, z: 1 }, neighbours: [] }];
    },
    getSnapshot() {
      return { tableId: "table-1", map: { nodePositions: new Map([...positions].map(([id, position]) => [id, { position }])) } };
    },
    getAllRegionTopologies() {
      return [...regions.values()];
    },
    addPatch(patch) {
      addedPatches.push(patch);
      return { skippedRegionIds: [] };
    },
  };

  return { runtime, deleted, addedPatches };
}

test("repairOrganicCut deletes the consumed face itself, then rebuilds the surviving neighbour welded onto the painter's own nodes", () => {
  const { runtime, deleted, addedPatches } = createFakeTerrainRuntime();
  const fallout = {
    consumedSurfaceKeys: [["@region", "T1"]],
    paintedNodes: [
      { id: "p-a", position: { x: 2, y: 0, z: 0 } },
      { id: "p-b", position: { x: 2, y: 0, z: 2 } },
    ],
  };

  const rebuilt = repairOrganicCut(runtime, fallout, "cause-1");

  assert.equal(rebuilt, 1, "exactly the one surviving neighbour needed rebuilding");
  assert.deepEqual(
    deleted.map((key) => key.join("|")),
    ["@region|T1", "@region|T2"],
    "the consumed face is deleted first, then the survivor that named a welded node",
  );
  assert.equal(addedPatches.length, 1);

  const [patch] = addedPatches;
  assert.equal(patch.regions.length, 1);
  const [region] = patch.regions;
  assert.equal(region.regionId, "p-a|n5|n6|p-b", "the rebuilt cycle names the welded ids, not the old rim ids");
  assert.equal(region.surfaceType, "terrain");
  assert.equal(region.boundary.length, 4);

  const nodeIds = patch.nodes.map((node) => node.id).sort();
  assert.deepEqual(nodeIds, ["n5", "n6", "p-a", "p-b"], "n2 and n3 do not appear -- p-a and p-b took their place");

  const pA = patch.nodes.find((node) => node.id === "p-a");
  assert.deepEqual(pA.position, { x: 2, y: 0, z: 0 }, "the welded node keeps the painter's own position, not the old terrain node's");
});

test("a rim node with no painted node close enough is left exactly as the deletion left it", () => {
  const { runtime, deleted, addedPatches } = createFakeTerrainRuntime();
  const fallout = {
    consumedSurfaceKeys: [["@region", "T1"]],
    paintedNodes: [{ id: "p-far", position: { x: 500, y: 0, z: 500 } }],
  };

  const rebuilt = repairOrganicCut(runtime, fallout, "cause-1");

  assert.equal(rebuilt, 0, "nothing was close enough to weld onto");
  assert.deepEqual(deleted.map((key) => key.join("|")), ["@region|T1"], "only the actually-consumed face is deleted");
  assert.equal(addedPatches.length, 0);
});

test("consuming nothing is a no-op", () => {
  const { runtime, deleted, addedPatches } = createFakeTerrainRuntime();
  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [], paintedNodes: [] }, "cause-1");

  assert.equal(rebuilt, 0);
  assert.equal(deleted.length, 0);
  assert.equal(addedPatches.length, 0);
});

test("a rebuilt face the engine refuses is a thrown error, not a silently accepted hole", () => {
  const { runtime } = createFakeTerrainRuntime();
  runtime.addPatch = (patch) => ({ skippedRegionIds: patch.regions.map((region) => region.regionId) });
  const fallout = {
    consumedSurfaceKeys: [["@region", "T1"]],
    paintedNodes: [
      { id: "p-a", position: { x: 2, y: 0, z: 0 } },
      { id: "p-b", position: { x: 2, y: 0, z: 2 } },
    ],
  };

  assert.throws(() => repairOrganicCut(runtime, fallout, "cause-1"), /unregistered/);
});
