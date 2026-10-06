import test from "node:test";
import assert from "node:assert/strict";

import { demolishTool } from "../src/composition/tabletop/tools/demolish/demolish-tool.ts";
import { DEFAULT_TOOL_PARAMS } from "../src/features/edit-construction/tools/tool-types.ts";
import { commitSurfaceRemoval } from "../src/composition/tabletop/effects/effect-commit.ts";

test("demolishTool exposes correct metadata and default params", () => {
  assert.equal(demolishTool.id, "demolish");
  assert.equal(demolishTool.usesRuler, false);
  assert.deepEqual(demolishTool.defaultParams(), DEFAULT_TOOL_PARAMS.demolish);
  assert.equal(typeof demolishTool.previewFor, "function");
  assert.equal(typeof demolishTool.onPointerUp, "function");
});

test("commitSurfaceRemoval handles surface removal atomically with reactions", () => {
  let removedSurfaceKeys = [];
  let dispatchedEffects = [];
  let transactions = [];

  const mockRuntime = {
    transact(transactionId, origin, work) {
      transactions.push(transactionId);
      return { value: work(), recorded: true };
    },
    getRegionTopology(surfaceKey) {
      return {
        surfaceKey,
        surfaceType: "wall-white",
        nodes: [{ id: "n1", position: { x: 0, y: 0, z: 0 } }],
      };
    },
    removeSurface(request, origin, causeId) {
      removedSurfaceKeys.push(request.surfaceKey);
      return {
        affectedSurfaceKeys: [],
        removedSurfaceKeys: [request.surfaceKey],
        createdSurfaceKeys: [],
        removedNodeIds: ["n1"],
      };
    },
    getAllRegionTopologies() {
      return [];
    },
    getGraphSnapshot() {
      return { nodes: [], edges: [] };
    },
    getSnapshot() {
      return { map: { nodePositions: new Map() } };
    },
  };

  const key1 = ["n1", "n2"];
  const key2 = ["n3", "n4"];

  const result = commitSurfaceRemoval(
    mockRuntime,
    [key1, key2],
    {
      transactionId: "test-tx-1",
      reactions: {},
    },
  );

  assert.equal(result.recorded, true);
  assert.deepEqual(removedSurfaceKeys, [key1, key2]);
  assert.deepEqual(transactions, ["test-tx-1"]);
});
