import assert from "node:assert/strict";
import test from "node:test";

import {
  NODE_HANDLE_LAYER_ID,
  NODE_HANDLE_VISUAL_KIND,
  nodeHandleSceneItem,
  nodeHandleSceneItemId,
  nodeHandleTransform,
} from "../src/adapters/rendering/node-handle-scene-item.ts";

test("a node handle scene item names the node while the renderer receives generic scene data", () => {
  const item = nodeHandleSceneItem("table-1:n0", { x: 2, y: 1.5, z: -3 });

  assert.equal(item.id, "construction-node-handle:table-1:n0");
  assert.equal(item.id, nodeHandleSceneItemId("table-1:n0"));
  assert.equal(item.layer, NODE_HANDLE_LAYER_ID);
  assert.equal(item.visual.kind, NODE_HANDLE_VISUAL_KIND);
  assert.deepEqual(item.transform, nodeHandleTransform({ x: 2, y: 1.5, z: -3 }));
  assert.deepEqual(item.data, { entity: "construction-node-handle", nodeId: "table-1:n0" });
});
