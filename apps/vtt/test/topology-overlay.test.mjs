import assert from "node:assert/strict";
import test from "node:test";

import { constructionPreviewSceneItem } from "../src/adapters/rendering/construction-preview-scene-item.ts";
import { VERTEX_OVERLAY_CHANNEL, vertexOverlayDescriptor, vertexOverlayOf } from "../src/composition/tabletop/topology-overlay/vertex-overlay.ts";

test("the vertex overlay puts one dot at every vertex of the graph, in order", () => {
  const positions = vertexOverlayOf({ nodes: [{ id: "a", position: { x: 1, y: 2, z: 3 } }, { id: "b", position: { x: -4, y: 0, z: 0.5 } }] });

  assert.deepEqual([...positions], [1, 2, 3, -4, 0, 0.5]);
});

test("an empty graph has no dots", () => {
  assert.equal(vertexOverlayOf({ nodes: [] }).length, 0);
});

test("the dots are a points preview on a channel of their own, apart from any tool's", () => {
  const descriptor = vertexOverlayDescriptor(vertexOverlayOf({ nodes: [{ id: "a", position: { x: 0, y: 0, z: 0 } }] }));
  const item = constructionPreviewSceneItem(descriptor, VERTEX_OVERLAY_CHANNEL);

  assert.equal(descriptor.kind, "points");
  assert.equal(item.visual.params.shape, "points");
  assert.equal(item.id, `construction-preview:${VERTEX_OVERLAY_CHANNEL}`);
});

test("a preview's shape follows its kind: lines for segments, faces for a quad or mesh", () => {
  const positions = new Float32Array(12);
  assert.equal(constructionPreviewSceneItem({ kind: "segments", positions, color: 0 }).visual.params.shape, "lines");
  assert.equal(constructionPreviewSceneItem({ kind: "quad", positions, color: 0 }).visual.params.shape, "faces");
  assert.equal(constructionPreviewSceneItem({ kind: "mesh", positions, indices: new Uint32Array(3), color: 0 }).visual.params.shape, "faces");
});
