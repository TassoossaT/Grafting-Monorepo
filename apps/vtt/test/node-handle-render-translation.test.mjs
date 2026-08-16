import assert from "node:assert/strict";
import test from "node:test";

import {
  HEIGHT_GIZMO_STEM_VISUAL_KIND,
  HEIGHT_GIZMO_VISUAL_KIND,
  NODE_HANDLE_LAYER_ID,
  NODE_HANDLE_VISUAL_KIND,
  heightGizmoSceneItem,
  heightGizmoSceneItemId,
  heightGizmoStemSceneItem,
  heightGizmoStemSceneItemId,
  heightGizmoTransform,
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
  assert.deepEqual(item.data, { entity: "construction-node-handle", nodeId: "table-1:n0", axis: "xz-planar" });
});

test("height gizmo scene item and stem generate vertical elevation manipulation descriptors", () => {
  const gizmo = heightGizmoSceneItem("table-1:n0", { x: 2, y: 1.5, z: -3 });
  const stem = heightGizmoStemSceneItem("table-1:n0", { x: 2, y: 1.5, z: -3 });

  assert.equal(gizmo.id, "construction-height-gizmo:table-1:n0");
  assert.equal(gizmo.id, heightGizmoSceneItemId("table-1:n0"));
  assert.equal(gizmo.layer, NODE_HANDLE_LAYER_ID);
  assert.equal(gizmo.visual.kind, HEIGHT_GIZMO_VISUAL_KIND);
  assert.deepEqual(gizmo.transform, heightGizmoTransform({ x: 2, y: 1.5, z: -3 }));
  assert.deepEqual(gizmo.data, { entity: "construction-node-handle", nodeId: "table-1:n0", axis: "y-height" });

  assert.equal(stem.id, "construction-height-stem:table-1:n0");
  assert.equal(stem.id, heightGizmoStemSceneItemId("table-1:n0"));
  assert.equal(stem.visual.kind, HEIGHT_GIZMO_STEM_VISUAL_KIND);
  assert.deepEqual(stem.visual.params.positions, new Float32Array([2, 1.5, -3, 2, 2.75, -3]));
});
