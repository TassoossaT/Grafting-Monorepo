import assert from "node:assert/strict";
import test from "node:test";

import {
  HEIGHT_GIZMO_STEM_VISUAL_KIND,
  HEIGHT_GIZMO_VISUAL_KIND,
  NODE_HANDLE_LAYER_ID,
  NODE_HANDLE_VISUAL_KIND,
  edgeHeightGizmoSceneItem,
  edgeHeightGizmoSceneItemId,
  edgeHeightStemSceneItem,
  edgeHeightStemSceneItemId,
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
  assert.deepEqual(stem.visual.params.positions, new Float32Array([2, 1.5, -3, 2, 2.6, -3]));
});

test("edge height gizmo scene item and stem generate edge midpoint descriptors", () => {
  const p1 = { x: 0, y: 2, z: 0 };
  const p2 = { x: 4, y: 2, z: 0 };
  const gizmo = edgeHeightGizmoSceneItem("table-1:n1", "table-1:n2", p1, p2);
  const stem = edgeHeightStemSceneItem("table-1:n1", "table-1:n2", p1, p2);

  assert.equal(gizmo.id, "construction-edge-height-gizmo:table-1:n1:table-1:n2");
  assert.equal(gizmo.id, edgeHeightGizmoSceneItemId("table-1:n1", "table-1:n2"));
  assert.equal(gizmo.layer, NODE_HANDLE_LAYER_ID);
  assert.equal(gizmo.visual.kind, HEIGHT_GIZMO_VISUAL_KIND);
  assert.deepEqual(gizmo.transform, heightGizmoTransform({ x: 2, y: 2, z: 0 }));
  assert.deepEqual(gizmo.data, {
    entity: "construction-node-handle",
    nodeId: "table-1:n1",
    secondaryNodeId: "table-1:n2",
    axis: "y-height",
  });

  assert.equal(stem.id, "construction-edge-height-stem:table-1:n1:table-1:n2");
  assert.equal(stem.id, edgeHeightStemSceneItemId("table-1:n1", "table-1:n2"));
  assert.equal(stem.visual.kind, HEIGHT_GIZMO_STEM_VISUAL_KIND);
  assert.deepEqual(stem.visual.params.positions, new Float32Array([2, 2, 0, 2, 3.1, 0]));
});
