import assert from "node:assert/strict";
import test from "node:test";
import { RULER_LABEL_VISUAL_KIND, rulerLabelAspect, rulerLabelSceneItem, rulerLabelSceneItemId } from "../src/adapters/rendering/ruler-label-scene-item.ts";

const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message ?? ""} ${a} != ${b}`);

test("a label is a sprite on the preview layer, standing where it is written, as tall as asked and as wide as its text", () => {
  const item = rulerLabelSceneItem({ position: { x: 3, y: 0.1, z: -2 }, text: "12.50 m", height: 0.4 }, 2, "ruler-labels");
  assert.equal(item.id, "ruler-label:ruler-labels:2");
  assert.equal(item.layer, "construction-preview");
  assert.equal(item.visual.kind, RULER_LABEL_VISUAL_KIND);
  assert.deepEqual(item.visual.params, { text: "12.50 m" });
  assert.deepEqual(item.transform.position, { x: 3, y: 0.1, z: -2 });
  near(item.transform.scale.y, 0.4);
  near(item.transform.scale.x, 0.4 * rulerLabelAspect("12.50 m"), "as wide as the text asks, so the texture is never stretched");
  assert.equal(item.transform.scale.z, 1);
  assert.deepEqual(item.data, { entity: "construction-preview" });
});

test("a longer text is wider, and a short number is never narrower than a pill", () => {
  assert.ok(rulerLabelAspect("12.50 m") > rulerLabelAspect("5"));
  assert.ok(rulerLabelAspect("5") >= 1.2);
  assert.ok(rulerLabelAspect("100") > rulerLabelAspect("10"));
});

test("each label of a channel has its own id, and channels never share one", () => {
  const ids = new Set([0, 1, 2].map((index) => rulerLabelSceneItemId("ruler-labels", index)));
  assert.equal(ids.size, 3);
  assert.notEqual(rulerLabelSceneItemId("ruler-labels", 0), rulerLabelSceneItemId("other", 0));
});
