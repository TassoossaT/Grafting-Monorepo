import assert from "node:assert/strict";
import test from "node:test";

import { createBrushTool } from "../src/composition/tabletop/tools/core/brush-tool.ts";
import { fitPath } from "../src/composition/tabletop/tools/core/stroke-fitting.ts";
import { pathHalfWidth } from "../src/features/edit-construction/structure-types/path/path-recipe.ts";

const ROAD = Object.freeze({
  shape: "circle",
  radius: 2.5,
  rotationDegrees: 0,
  pathKind: "road",
  bedWidth: 3,
  shoulderWidth: 0.6,
  shoulderHeight: 0.15,
  miterLimit: 4,
});

/** Runs one brush gesture and hands back the region its `applyRegion` saw. */
function regionFor(params, halfWidth) {
  let captured;
  const tool = createBrushTool({
    id: "path-brush",
    defaultParams: () => params,
    previewColor: () => 0,
    halfWidth: () => halfWidth,
    applyRegion(region) {
      captured = region;
    },
  });
  const samples = [{ point: { x: 0, y: 0, z: 0 } }, { point: { x: 4, y: 0, z: 0 } }];
  tool.onPointerUp({}, { samples, current: samples[1] }, params);
  return captured;
}

test("the road's half width is the outermost lateral offset its own profile reaches", () => {
  assert.equal(pathHalfWidth(ROAD), 2.1);
  assert.equal(pathHalfWidth({ ...ROAD, pathKind: "street" }), 1.5);
});

test("a product wider than the brush still pushes the brush shape open", () => {
  const region = regionFor({ ...ROAD, radius: 0.75 }, pathHalfWidth(ROAD));
  assert.equal(region.shape.radius, 2.1, "the shape grows to hold the road it will paint");
});

test("the correction budget is the reach the hand asked for, not what the product left over", () => {
  // The brush does one job now, not two. Tying the budget to the slack
  // between brush and road meant a road drawn with a brush its own width
  // could not be straightened at all, so asking for a smoother road meant
  // widening the brush for reasons nothing on screen explained.
  const wide = regionFor(ROAD, pathHalfWidth(ROAD));
  assert.equal(wide.shape.radius, 2.5);
  assert.equal(wide.tolerance, 2.5);

  const narrow = regionFor({ ...ROAD, radius: 0.75 }, pathHalfWidth(ROAD));
  assert.equal(narrow.tolerance, 0.75, "growing the shape must not grant a budget nobody asked for");

  const literal = regionFor({ ...ROAD, radius: 0 }, pathHalfWidth(ROAD));
  assert.equal(literal.tolerance, 0, "at zero reach the stroke is committed as drawn");
});

test("a product with no width of its own spends the whole reach on correction", () => {
  const region = regionFor({ ...ROAD, radius: 1.25 }, 0);
  assert.equal(region.shape.radius, 1.25);
  assert.equal(region.tolerance, 1.25);
});

test("a square brush is widened by its own half-size, not its radius", () => {
  const region = regionFor({ ...ROAD, shape: "square", radius: 0.5 }, 2.1);
  assert.equal(region.shape.kind, "square");
  assert.equal(region.shape.size, 4.2);
  assert.equal(region.tolerance, 0.5, "half the drawn square's own size, before it was widened");
});

test("a span held together by its arc is never committed as a chord outside the budget", () => {
  // A half turn of radius 0.3: the chord misses the drawn stroke by the full
  // sagitta, 0.3, well past a 0.2 budget -- only the arc explains it. One
  // sample sits 0.12 off the circle, enough that the arc-versus-straight
  // ratios used to reject the arc and hand back that chord anyway.
  const radius = 0.3;
  const samples = [];
  for (let step = 0; step <= 8; step += 1) {
    const angle = (step / 8) * Math.PI;
    const drift = step === 1 ? 0.12 : 0;
    samples.push({
      x: (radius + drift) * Math.cos(angle),
      y: 0,
      z: (radius + drift) * Math.sin(angle),
    });
  }

  const fitted = fitPath(samples, 0.2);
  assert.equal(fitted.length, 1, "the span fits as a single edge");
  assert.equal(fitted[0].geometry.kind, "arc", "the only shape that fits within the budget");

  for (const edge of fitted) {
    if (edge.geometry.kind !== "arc") continue;
    const [centerX, centerZ] = edge.geometry.center;
    for (const sample of samples) {
      const off = Math.abs(Math.hypot(sample.x - centerX, sample.z - centerZ) - radius);
      assert.ok(off <= 0.2 + 1e-9, `sample sits ${off} off the committed edge, past the budget`);
    }
  }
});
