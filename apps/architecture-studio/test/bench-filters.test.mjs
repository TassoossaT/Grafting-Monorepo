import assert from "node:assert/strict";
import test from "node:test";

import { addBenchEdge, addBenchNode, EMPTY_BENCH_GRAPH } from "../src/bench/bench-graph.ts";
import { createBenchEvaluators } from "../src/bench/evaluators.ts";

const evaluators = createBenchEvaluators({
  generateHeightmap: () => new Float32Array(),
  discretize: () => new Int32Array(),
});

const heightmap = (width, height, values) => ({
  dataType: "heightmap",
  width,
  height,
  values: Float32Array.from(values),
});

test("passes the input straight through when smoothing has no radius", () => {
  const source = heightmap(2, 2, [0, 1, 2, 3]);
  const result = evaluators.get("filter.smooth")({ heightmap: source }, { radius: 0 });

  assert.equal(result.values, source.values);
});

test("pulls an isolated spike down toward its neighbours", () => {
  const source = heightmap(3, 3, [0, 0, 0, 0, 9, 0, 0, 0, 0]);
  const result = evaluators.get("filter.smooth")({ heightmap: source }, { radius: 1 });

  assert.equal(result.values[4], 1);
  // The spike's energy spreads outward rather than vanishing.
  assert.ok(result.values[0] > 0);
});

test("clamps at the edges instead of wrapping around the map", () => {
  const source = heightmap(3, 1, [9, 0, 0]);
  const result = evaluators.get("filter.smooth")({ heightmap: source }, { radius: 1 });

  // If sampling wrapped, the last cell would have picked up the 9 on the left.
  assert.equal(result.values[2], 0);
});

test("keeps the grid shape through a filter", () => {
  const source = heightmap(4, 2, [0, 1, 2, 3, 4, 5, 6, 7]);
  const result = evaluators.get("filter.smooth")({ heightmap: source }, { radius: 2 });

  assert.equal(result.width, 4);
  assert.equal(result.height, 2);
  assert.equal(result.values.length, 8);
});

test("stretches the full input range onto the requested output range", () => {
  const source = heightmap(2, 2, [-2, 0, 1, 2]);
  const result = evaluators.get("filter.remap")(
    { heightmap: source },
    { outputMin: 0, outputMax: 10 },
  );

  assert.deepEqual([...result.values], [0, 5, 7.5, 10]);
});

test("gives a flat input the lower bound rather than dividing by an empty range", () => {
  const source = heightmap(2, 1, [4, 4]);
  const result = evaluators.get("filter.remap")(
    { heightmap: source },
    { outputMin: 3, outputMax: 9 },
  );

  assert.deepEqual([...result.values], [3, 3]);
});

test("shows a viewport exactly what reaches it", () => {
  const source = heightmap(2, 1, [1, 2]);
  assert.equal(evaluators.get("output.viewport")({ value: source }, {}), source);
});

test("lets a viewport accept any value kind, while typed ports stay strict", () => {
  const generator = addBenchNode(EMPTY_BENCH_GRAPH, "heightmap.perlin", { x: 0, y: 0 });
  const discretize = addBenchNode(generator.graph, "terrain.discretize", { x: 200, y: 0 });
  const viewport = addBenchNode(discretize.graph, "output.viewport", { x: 400, y: 0 });

  const levelsToViewport = addBenchEdge(
    viewport.graph,
    { nodeId: discretize.nodeId, portId: "levels" },
    { nodeId: viewport.nodeId, portId: "value" },
  );
  assert.equal(levelsToViewport.refusal, undefined);

  const levelsToHeightmapInput = addBenchEdge(
    viewport.graph,
    { nodeId: discretize.nodeId, portId: "levels" },
    { nodeId: discretize.nodeId, portId: "heightmap" },
  );
  assert.equal(levelsToHeightmapInput.refusal, "type-mismatch");
});
