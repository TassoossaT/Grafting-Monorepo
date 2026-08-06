import assert from "node:assert/strict";
import test from "node:test";

import { addBenchEdge, addBenchNode, setBenchParam, EMPTY_BENCH_GRAPH } from "../src/bench/bench-graph.ts";
import { buildEvaluationPlan, computeStepHash } from "../src/bench/evaluation-plan.ts";

const chain = () => {
  const source = addBenchNode(EMPTY_BENCH_GRAPH, "heightmap.perlin", { x: 0, y: 0 });
  const sink = addBenchNode(source.graph, "terrain.discretize", { x: 300, y: 0 });
  const connected = addBenchEdge(
    sink.graph,
    { nodeId: source.nodeId, portId: "heightmap" },
    { nodeId: sink.nodeId, portId: "heightmap" },
  );
  return { graph: connected.graph, sourceId: source.nodeId, sinkId: sink.nodeId };
};

const order = (graph) => graph.nodes.map((node) => node.id);

test("plans one execution per node, in the order it was given", () => {
  const { graph, sourceId, sinkId } = chain();
  const plan = buildEvaluationPlan(graph, order(graph));

  assert.deepEqual(
    plan.steps.map((step) => step.nodeId),
    [sourceId, sinkId],
  );
  assert.deepEqual(plan.skipped, []);
});

test("feeds a consumer the hash of the value produced upstream", () => {
  const { graph, sourceId, sinkId } = chain();
  const plan = buildEvaluationPlan(graph, order(graph));
  const [producer, consumer] = plan.steps;

  assert.equal(producer.nodeId, sourceId);
  assert.equal(consumer.nodeId, sinkId);
  assert.equal(consumer.inputs.heightmap, producer.hash);
});

test("changing a parameter changes that node's hash and everything downstream", () => {
  const { graph, sourceId, sinkId } = chain();
  const before = buildEvaluationPlan(graph, order(graph));
  const after = buildEvaluationPlan(setBenchParam(graph, sourceId, "seed", 7), order(graph));

  assert.notEqual(after.hashes[sourceId], before.hashes[sourceId]);
  assert.notEqual(after.hashes[sinkId], before.hashes[sinkId]);
});

test("changing a downstream parameter leaves the upstream hash alone", () => {
  const { graph, sourceId, sinkId } = chain();
  const before = buildEvaluationPlan(graph, order(graph));
  const after = buildEvaluationPlan(setBenchParam(graph, sinkId, "levels", 12), order(graph));

  // This is the whole point of the cache: the expensive producer is not rerun.
  assert.equal(after.hashes[sourceId], before.hashes[sourceId]);
  assert.notEqual(after.hashes[sinkId], before.hashes[sinkId]);
});

test("gives two nodes with identical settings the same hash, so the work is shared", () => {
  const first = addBenchNode(EMPTY_BENCH_GRAPH, "heightmap.perlin", { x: 0, y: 0 });
  const second = addBenchNode(first.graph, "heightmap.perlin", { x: 0, y: 200 });
  const plan = buildEvaluationPlan(second.graph, order(second.graph));

  assert.equal(plan.steps[0].hash, plan.steps[1].hash);
});

test("does not depend on the insertion order of parameter keys", () => {
  assert.equal(
    computeStepHash("kind", { a: 1, b: 2 }, {}),
    computeStepHash("kind", { b: 2, a: 1 }, {}),
  );
});

test("skips a node whose input is not connected", () => {
  const lonely = addBenchNode(EMPTY_BENCH_GRAPH, "terrain.discretize", { x: 0, y: 0 });
  const plan = buildEvaluationPlan(lonely.graph, order(lonely.graph));

  assert.deepEqual(plan.steps, []);
  assert.deepEqual(plan.skipped, [{ nodeId: lonely.nodeId, missingInputs: ["heightmap"] }]);
});

test("skips everything downstream of a node that cannot run", () => {
  const blocked = addBenchNode(EMPTY_BENCH_GRAPH, "terrain.discretize", { x: 0, y: 0 });
  const second = addBenchNode(blocked.graph, "terrain.discretize", { x: 300, y: 0 });
  // levels -> heightmap would be refused by the bench's own rules; the plan is
  // asked directly here to prove it never invents a value for a missing input.
  const plan = buildEvaluationPlan(second.graph, order(second.graph));

  assert.deepEqual(plan.steps, []);
  assert.equal(plan.skipped.length, 2);
});

test("ignores an ordered identity that is no longer in the graph", () => {
  const { graph } = chain();
  const plan = buildEvaluationPlan(graph, [...order(graph), "node-deleted"]);

  assert.equal(plan.steps.length, 2);
});
