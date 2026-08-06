import assert from "node:assert/strict";
import test from "node:test";

import { createBenchEvaluators, evaluatorCoverage } from "../src/bench/evaluators.ts";
import { toEvaluationPreview } from "../src/bench/preview.ts";

const stubWasm = {
  generateHeightmap: (width, height, seed, scale) => {
    const values = new Float32Array(width * height);
    for (let index = 0; index < values.length; index += 1) values[index] = (index + seed) * scale;
    return values;
  },
  discretize: (values, levels) => {
    const indices = new Int32Array(values.length);
    for (let index = 0; index < values.length; index += 1) {
      indices[index] = Math.min(levels - 1, Math.floor(values[index] * levels));
    }
    return indices;
  },
};

const evaluators = createBenchEvaluators(stubWasm);

test("registers an evaluator for every element the menu offers, and no others", () => {
  assert.deepEqual(evaluatorCoverage(evaluators), { withoutEvaluator: [], withoutKind: [] });
});

test("carries the grid shape from the generator into its result", () => {
  const result = evaluators.get("heightmap.perlin")(
    {},
    { width: 4, height: 3, seed: 1, scale: 0.5 },
  );

  assert.equal(result.dataType, "heightmap");
  assert.equal(result.width, 4);
  assert.equal(result.height, 3);
  assert.equal(result.values.length, 12);
});

test("passes the upstream grid shape through discretization unchanged", () => {
  const source = evaluators.get("heightmap.perlin")({}, { width: 4, height: 3, seed: 0, scale: 0.01 });
  const result = evaluators.get("terrain.discretize")({ heightmap: source }, { levels: 4 });

  assert.equal(result.dataType, "levels");
  assert.equal(result.width, 4);
  assert.equal(result.height, 3);
  assert.equal(result.levelCount, 4);
  assert.equal(result.indices.length, 12);
});

test("refuses an input of the wrong value kind instead of producing nonsense", () => {
  const levels = { dataType: "levels", width: 2, height: 2, levelCount: 2, indices: new Int32Array(4) };
  assert.throws(
    () => evaluators.get("terrain.discretize")({ heightmap: levels }, { levels: 4 }),
    /expected a heightmap/,
  );
});

test("normalizes a heightmap preview onto zero-to-one", () => {
  const preview = toEvaluationPreview({
    dataType: "heightmap",
    width: 2,
    height: 2,
    values: new Float32Array([-4, 0, 2, 4]),
  });

  assert.deepEqual([...preview.values], [0, 0.5, 0.75, 1]);
});

test("renders a flat heightmap without dividing by an empty range", () => {
  const preview = toEvaluationPreview({
    dataType: "heightmap",
    width: 2,
    height: 1,
    values: new Float32Array([3, 3]),
  });

  assert.deepEqual([...preview.values], [0, 0]);
});

test("scales a levels preview by its declared count, not by the bands in use", () => {
  // Only the two lowest of five bands are present; the preview must stay low
  // rather than stretching to look like a full-range map.
  const preview = toEvaluationPreview({
    dataType: "levels",
    width: 2,
    height: 1,
    levelCount: 5,
    indices: new Int32Array([0, 1]),
  });

  assert.deepEqual([...preview.values], [0, 0.25]);
});
