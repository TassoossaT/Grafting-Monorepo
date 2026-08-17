import assert from "node:assert/strict";
import test from "node:test";

import {
  NODE_HANDLE_LAYER_ID,
  NODE_HANDLE_STEM_VISUAL_KIND,
  NODE_HANDLE_VISUAL_KIND,
  NODE_HEIGHT_HANDLE_VISUAL_KIND,
  nodeHandleSceneItem,
  nodeHandleSceneItemId,
  nodeHandleStemPositions,
  nodeHandleStemSceneItem,
  nodeHandleStemSceneItemId,
  nodeHandleTransform,
  nodeHeightGizmoSceneItems,
  nodeHeightHandleSceneItem,
  nodeHeightHandleSceneItemId,
  nodeHeightHandleTransform,
} from "../src/adapters/rendering/node-handle-scene-item.ts";

function float32(values) {
  return Array.from(Float32Array.from(values));
}

test("a planar node handle scene item names the node while marking axis xz-planar", () => {
  const item = nodeHandleSceneItem("table-1:n0", { x: 2, y: 1.5, z: -3 });

  assert.equal(item.id, "construction-node-handle:table-1:n0");
  assert.equal(item.id, nodeHandleSceneItemId("table-1:n0"));
  assert.equal(item.layer, NODE_HANDLE_LAYER_ID);
  assert.equal(item.visual.kind, NODE_HANDLE_VISUAL_KIND);
  assert.deepEqual(item.transform, nodeHandleTransform({ x: 2, y: 1.5, z: -3 }));
  assert.deepEqual(item.data, {
    entity: "construction-node-handle",
    nodeId: "table-1:n0",
    axis: "xz-planar",
  });
});

test("a floating height handle scene item names the node while marking axis y-height", () => {
  const item = nodeHeightHandleSceneItem("table-1:n0", { x: 2, y: 3.5, z: -3 });

  assert.equal(item.id, "construction-node-handle-height:table-1:n0");
  assert.equal(item.id, nodeHeightHandleSceneItemId("table-1:n0"));
  assert.equal(item.layer, NODE_HANDLE_LAYER_ID);
  assert.equal(item.visual.kind, NODE_HEIGHT_HANDLE_VISUAL_KIND);
  assert.deepEqual(item.transform, nodeHeightHandleTransform({ x: 2, y: 3.5, z: -3 }));
  assert.equal(item.transform.position.y, 3.9);
  assert.deepEqual(item.data, {
    entity: "construction-node-handle",
    nodeId: "table-1:n0",
    axis: "y-height",
  });
});

test("a stem scene item calculates vertical segment positions from ground to node height", () => {
  const position = { x: 2, y: 3.5, z: -3 };
  const positions = nodeHandleStemPositions(position, 0);

  assert.deepEqual(Array.from(positions), float32([2, 3.5, -3, 2, 3.9, -3]));

  const stemItem = nodeHandleStemSceneItem("table-1:n0", position, 0);
  assert.equal(stemItem.id, "construction-node-handle-stem:table-1:n0");
  assert.equal(stemItem.id, nodeHandleStemSceneItemId("table-1:n0"));
  assert.equal(stemItem.layer, NODE_HANDLE_LAYER_ID);
  assert.equal(stemItem.visual.kind, NODE_HANDLE_STEM_VISUAL_KIND);
  assert.deepEqual(Array.from(stemItem.visual.params.positions), float32([2, 3.5, -3, 2, 3.9, -3]));
  assert.deepEqual(stemItem.data, { entity: "construction-node-stem", nodeId: "table-1:n0" });
});

test("a vertical gizmo returns both floating arrow handle and stem segment scene items", () => {
  const position = { x: 4, y: 2.0, z: 1 };
  const [arrowItem, stemItem] = nodeHeightGizmoSceneItems("table-1:n1", position, 0.5);

  assert.equal(arrowItem.id, nodeHeightHandleSceneItemId("table-1:n1"));
  assert.equal(arrowItem.data.axis, "y-height");
  assert.equal(arrowItem.transform.position.y, 2.4);
  assert.equal(stemItem.id, nodeHandleStemSceneItemId("table-1:n1"));
  assert.deepEqual(Array.from(stemItem.visual.params.positions), float32([4, 2.0, 1, 4, 2.4, 1]));
});
