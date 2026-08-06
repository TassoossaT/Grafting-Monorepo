import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_BENCH_GRAPH,
  addBenchEdge,
  addBenchNode,
  checkBenchConnection,
  duplicateBenchNode,
  moveBenchNode,
  removeBenchEdge,
  removeBenchNode,
  setBenchParam,
} from "../src/bench/bench-graph.ts";
import { coerceParamValue, defaultParamValues, portCapacity } from "../src/bench/node-kind.ts";
import { BENCH_NODE_KINDS, findNodeKind, nodeKindsByCategory } from "../src/bench/registry.ts";

const withHeightmapAndDiscretize = () => {
  const first = addBenchNode(EMPTY_BENCH_GRAPH, "heightmap.perlin", { x: 0, y: 0 });
  const second = addBenchNode(first.graph, "terrain.discretize", { x: 300, y: 0 });
  return { graph: second.graph, sourceId: first.nodeId, targetId: second.nodeId };
};

test("starts a node instance from its element's declared defaults", () => {
  const { graph, sourceId } = withHeightmapAndDiscretize();
  const node = graph.nodes.find((candidate) => candidate.id === sourceId);

  assert.deepEqual(node.params, defaultParamValues(findNodeKind("heightmap.perlin")));
  assert.equal(node.params.scale, 0.12);
});

test("keeps parameter values on the instance, so copies diverge independently", () => {
  const { graph, sourceId } = withHeightmapAndDiscretize();
  const copied = duplicateBenchNode(graph, sourceId);
  const changed = setBenchParam(copied.graph, copied.nodeId, "seed", 42);

  const original = changed.nodes.find((node) => node.id === sourceId);
  const copy = changed.nodes.find((node) => node.id === copied.nodeId);
  assert.equal(original.params.seed, 1);
  assert.equal(copy.params.seed, 42);
  assert.equal(copy.kindId, original.kindId);
});

test("copies a node without inheriting its connections", () => {
  const { graph, sourceId, targetId } = withHeightmapAndDiscretize();
  const connected = addBenchEdge(
    graph,
    { nodeId: sourceId, portId: "heightmap" },
    { nodeId: targetId, portId: "heightmap" },
  );
  const copied = duplicateBenchNode(connected.graph, targetId);

  assert.equal(copied.graph.edges.length, 1);
  assert.equal(
    copied.graph.edges.some((edge) => edge.target.nodeId === copied.nodeId),
    false,
  );
});

test("coerces edited parameters into the range their spec declares", () => {
  const { graph, targetId } = withHeightmapAndDiscretize();

  assert.equal(setBenchParam(graph, targetId, "levels", 900).nodes.at(-1).params.levels, 64);
  assert.equal(setBenchParam(graph, targetId, "levels", -5).nodes.at(-1).params.levels, 2);
  assert.equal(setBenchParam(graph, targetId, "levels", 6.7).nodes.at(-1).params.levels, 7);
  // An emptied numeric field yields "", which must not become NaN on the node.
  assert.equal(setBenchParam(graph, targetId, "levels", "").nodes.at(-1).params.levels, 6);
});

test("rejects a parameter the element does not declare", () => {
  const { graph, targetId } = withHeightmapAndDiscretize();
  assert.throws(() => setBenchParam(graph, targetId, "absent", 1), /declares no parameter absent/);
});

test("allows a connection only between ports carrying the same value kind", () => {
  const { graph, sourceId, targetId } = withHeightmapAndDiscretize();

  assert.equal(
    checkBenchConnection(graph, { nodeId: sourceId, portId: "heightmap" }, { nodeId: targetId, portId: "heightmap" }),
    null,
  );
  // "levels" is an output of discretize, not an input of it.
  assert.equal(
    checkBenchConnection(graph, { nodeId: sourceId, portId: "heightmap" }, { nodeId: targetId, portId: "levels" }),
    "unknown-port",
  );
});

test("refuses a second value into an input that is already fed", () => {
  const { graph, sourceId, targetId } = withHeightmapAndDiscretize();
  const connected = addBenchEdge(
    graph,
    { nodeId: sourceId, portId: "heightmap" },
    { nodeId: targetId, portId: "heightmap" },
  );
  const second = addBenchNode(connected.graph, "heightmap.perlin", { x: 0, y: 200 });
  const refused = addBenchEdge(
    second.graph,
    { nodeId: second.nodeId, portId: "heightmap" },
    { nodeId: targetId, portId: "heightmap" },
  );

  assert.equal(refused.refusal, "input-occupied");
  assert.equal(refused.graph, undefined);
});

test("removes a node together with every connection touching it", () => {
  const { graph, sourceId, targetId } = withHeightmapAndDiscretize();
  const connected = addBenchEdge(
    graph,
    { nodeId: sourceId, portId: "heightmap" },
    { nodeId: targetId, portId: "heightmap" },
  );
  const removed = removeBenchNode(connected.graph, sourceId);

  assert.equal(removed.graph.nodes.length, 1);
  assert.equal(removed.graph.edges.length, 0);
  assert.deepEqual(removed.removedEdgeIds, [connected.edge.id]);
});

test("treats removing an absent connection as a no-op rather than an error", () => {
  const { graph } = withHeightmapAndDiscretize();
  assert.equal(removeBenchEdge(graph, "edge-absent"), graph);
});

test("records a moved node's placement without disturbing anything else", () => {
  const { graph, sourceId, targetId } = withHeightmapAndDiscretize();
  const moved = moveBenchNode(graph, sourceId, { x: 500, y: 250 });
  const node = moved.nodes.find((candidate) => candidate.id === sourceId);

  assert.deepEqual({ x: node.x, y: node.y }, { x: 500, y: 250 });
  assert.equal(moved.nodes.find((candidate) => candidate.id === targetId).x, 300);
});

test("never mutates the graph it was handed", () => {
  const { graph, sourceId } = withHeightmapAndDiscretize();
  const before = JSON.stringify(graph);
  setBenchParam(graph, sourceId, "seed", 99);
  removeBenchNode(graph, sourceId);
  moveBenchNode(graph, sourceId, { x: 1, y: 1 });

  assert.equal(JSON.stringify(graph), before);
});

test("defaults input ports to one connection and output ports to unlimited", () => {
  const discretize = findNodeKind("terrain.discretize");
  assert.equal(portCapacity(discretize.inputs[0], "input"), 1);
  assert.equal(portCapacity(discretize.outputs[0], "output"), undefined);
});

test("keeps every registered element declared well enough to render itself", () => {
  for (const kind of BENCH_NODE_KINDS) {
    assert.ok(kind.title.length > 0, `${kind.id} needs a title`);
    assert.ok(kind.description.length > 0, `${kind.id} needs a description`);
    for (const spec of kind.params) {
      assert.ok(spec.label.length > 0, `${kind.id}.${spec.id} needs a label`);
      // The default must already satisfy its own spec, or a fresh node starts invalid.
      assert.deepEqual(coerceParamValue(spec, spec.defaultValue), spec.defaultValue);
    }
    for (const port of [...kind.inputs, ...kind.outputs]) {
      assert.ok(port.dataType.length > 0, `${kind.id}.${port.id} needs a dataType`);
    }
  }
});

test("groups elements for the menu in registration order", () => {
  assert.deepEqual(
    nodeKindsByCategory().map((group) => group.category),
    ["Generation", "Terrain"],
  );
});

test("refuses to instantiate an unregistered element", () => {
  assert.throws(() => addBenchNode(EMPTY_BENCH_GRAPH, "absent.kind", { x: 0, y: 0 }), /not registered/);
});
