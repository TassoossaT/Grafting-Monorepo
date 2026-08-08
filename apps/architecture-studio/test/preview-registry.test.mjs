import assert from "node:assert/strict";
import test from "node:test";

import {
  PREVIEW_KINDS,
  previewTransferables,
  toEvaluationPreview,
} from "../src/bench/preview.ts";
import { BENCH_DATA_TYPES } from "../src/bench/registry.ts";

const raster = (dataType) =>
  dataType === "levels"
    ? { dataType, width: 2, height: 2, levelCount: 4, indices: Int32Array.from([0, 1, 2, 3]) }
    : { dataType, width: 2, height: 2, values: Float32Array.from([0, 1, 2, 3]) };

test("every value kind that can be shown declares how, in one place", () => {
  // The property the registry exists for: adding a value kind must not mean
  // editing the viewport. `number` is the deliberate exception -- a single
  // scalar has no picture.
  const declared = new Set(PREVIEW_KINDS.map((kind) => kind.dataType));
  const showable = Object.values(BENCH_DATA_TYPES).filter(
    (dataType) => dataType !== "number" && dataType !== "any",
  );
  assert.deepEqual(
    showable.filter((dataType) => !declared.has(dataType)),
    [],
    "a value kind with no preview declaration would silently render nothing",
  );
});

test("no two kinds claim the same value kind", () => {
  const seen = new Set();
  for (const kind of PREVIEW_KINDS) {
    assert.ok(!seen.has(kind.dataType), `${kind.dataType} is declared twice`);
    seen.add(kind.dataType);
  }
});

test("a value with no preview says so instead of throwing", () => {
  // A missing picture is a gap, not a broken graph.
  assert.equal(toEvaluationPreview({ dataType: "number", value: 3 }), null);
  assert.equal(toEvaluationPreview({ dataType: "not-registered" }), null);
});

test("a projection refuses a value of the wrong kind rather than misreading it", () => {
  const mesh = PREVIEW_KINDS.find((kind) => kind.dataType === "mesh");
  assert.equal(mesh.project(raster("heightmap")), null);
});

test("a raster is normalised onto zero-to-one so two results are comparable", () => {
  // Comparing the *shape* of two results is what a user is doing when they add
  // or bypass a filter, and absolute ranges would make that impossible.
  const preview = toEvaluationPreview(raster("heightmap"));
  assert.equal(preview.form, "raster");
  assert.equal(Math.min(...preview.values), 0);
  assert.equal(Math.max(...preview.values), 1);
});

test("levels use their declared count as the range, not the indices present", () => {
  // Otherwise a map that used only the lower bands would stretch to look like
  // a full one.
  const preview = toEvaluationPreview({
    dataType: "levels",
    width: 2,
    height: 1,
    levelCount: 8,
    indices: Int32Array.from([0, 1]),
  });
  assert.ok(Math.max(...preview.values) < 0.2, "two of eight bands must stay near the bottom");
});

test("every form hands its buffers over instead of copying them", () => {
  // A new form that forgot to list its buffers would silently start copying
  // whole grids per frame, which nobody notices until it is slow.
  const rasterPreview = toEvaluationPreview(raster("heightmap"));
  assert.deepEqual(previewTransferables(rasterPreview), [rasterPreview.values.buffer]);

  const geometry = {
    form: "geometry",
    dataType: "mesh",
    positions: new Float32Array(3),
    indices: new Uint32Array(3),
  };
  assert.deepEqual(previewTransferables(geometry), [
    geometry.positions.buffer,
    geometry.indices.buffer,
  ]);
});

test("a preview always names the value kind it came from", () => {
  // The viewport keys its renderer on the form, but a user reading a node
  // still needs to know which kind produced the picture.
  for (const dataType of ["heightmap", "levels"]) {
    assert.equal(toEvaluationPreview(raster(dataType)).dataType, dataType);
  }
});
