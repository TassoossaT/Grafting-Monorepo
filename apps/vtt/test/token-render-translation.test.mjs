import assert from "node:assert/strict";
import test from "node:test";

import {
  TOKEN_LAYER_ID,
  TOKEN_VISUAL_KIND,
  tokenSceneItem,
} from "../src/adapters/rendering/token-scene-item.ts";

test("the VTT adapter names the product while the renderer receives generic scene data", () => {
  const item = tokenSceneItem({
    id: "token-1",
    position: { x: 2, y: 1.5, z: -3 },
    appearance: { label: "Scout", color: 0x72d69e, size: 1.75 },
  });

  assert.equal(item.id, "token:token-1");
  assert.equal(item.layer, TOKEN_LAYER_ID);
  assert.equal(item.visual.kind, TOKEN_VISUAL_KIND);
  assert.deepEqual(item.visual.params, { color: 0x72d69e });
  assert.deepEqual(item.transform, {
    position: { x: 2, y: 1.5, z: -3 },
    scale: 1.75,
  });
  assert.deepEqual(item.data, { entity: "token", tokenId: "token-1" });
});
