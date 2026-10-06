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

test("a continuous handle mesh retains the same edit identity without a sprite transform",()=>{
 const mesh={positions:new Float32Array([0,0,0,1,0,0,1,0,1]),indices:new Uint32Array([0,1,2])};
 const item=nodeHandleSceneItem("curve-midpoint:span",{x:10,y:2,z:3},"midpoint",mesh,true);
 assert.deepEqual(item.data,{entity:"construction-node-handle",nodeId:"curve-midpoint:span"});assert.equal(item.visual.params.mesh,mesh);assert.equal(item.visual.params.emphasized,true);assert.deepEqual(item.transform,{position:{x:0,y:0,z:0},scale:1});
});
