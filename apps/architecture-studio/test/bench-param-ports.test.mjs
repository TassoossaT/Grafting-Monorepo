import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_BENCH_GRAPH,
  addBenchEdge,
  addBenchNode,
  checkBenchConnection,
  duplicateBenchNode,
  setParamExposed,
} from "../src/bench/bench-graph.ts";
import {
  allInputPorts,
  paramIdFromPort,
  paramPortId,
  visibleInputPorts,
} from "../src/bench/node-kind.ts";
import { findNodeKind } from "../src/bench/registry.ts";

const DISCRETIZE = "terrain.discretize";
const PERLIN = "heightmap.perlin";

/**
 * A perlin (heightmap out), a number control (number out), and a discretize
 * to wire them into. The number control matters: a parameter port carries a
 * number, so only a number source can drive one.
 */
function placed() {
  const first = addBenchNode(EMPTY_BENCH_GRAPH, PERLIN, { x: 0, y: 0 });
  const second = addBenchNode(first.graph, DISCRETIZE, { x: 300, y: 0 });
  const third = addBenchNode(second.graph, "control.number", { x: 0, y: 200 });
  return {
    graph: third.graph,
    perlin: first.nodeId,
    discretize: second.nodeId,
    number: third.nodeId,
  };
}

const heightmapOut = { portId: "heightmap" };
const numberOut = { portId: "value" };

test("a freshly placed node exposes no parameter as a port", () => {
  const { graph, discretize } = placed();
  const node = graph.nodes.find((candidate) => candidate.id === discretize);
  assert.deepEqual([...node.exposedParams], []);
});

test("only declared inputs are visible until a parameter is promoted", () => {
  // The clutter this fixes: an element with a dozen settings showed a dozen
  // extra ports, and the ports carrying its real work were lost among them.
  const kind = findNodeKind(DISCRETIZE);
  const visible = visibleInputPorts(kind, []);
  assert.equal(visible.length, kind.inputs.length);
  assert.ok(visible.every((port) => paramIdFromPort(port.id) === null));
  assert.ok(
    allInputPorts(kind).length > visible.length,
    "the element must declare parameters, or this test proves nothing",
  );
});

test("promoting a parameter adds exactly that port, in the element's order", () => {
  const kind = findNodeKind(DISCRETIZE);
  const paramId = kind.params[0].id;
  const visible = visibleInputPorts(kind, [paramId]);
  assert.equal(visible.length, kind.inputs.length + 1);
  assert.equal(visible.at(-1).id, paramPortId(paramId));
});

test("a parameter cannot be connected before it is promoted", () => {
  // Refused in the graph layer, not merely hidden, so a stale canvas still
  // drawing the port cannot smuggle a connection in.
  const { graph, number, discretize } = placed();
  const paramId = findNodeKind(DISCRETIZE).params[0].id;
  const refusal = checkBenchConnection(
    graph,
    { nodeId: number, ...numberOut },
    { nodeId: discretize, portId: paramPortId(paramId) },
  );
  assert.equal(refusal, "unknown-port");
});

test("promoting then connecting works, and the connection survives", () => {
  const { graph, number, discretize } = placed();
  const paramId = findNodeKind(DISCRETIZE).params[0].id;
  const { graph: exposed } = setParamExposed(graph, discretize, paramId, true);

  const result = addBenchEdge(
    exposed,
    { nodeId: number, ...numberOut },
    { nodeId: discretize, portId: paramPortId(paramId) },
  );
  assert.equal(result.refusal, undefined, `refused: ${result.refusal}`);
  assert.equal(result.graph.edges.length, 1);
});

test("withdrawing a port removes the connection feeding it, and reports it", () => {
  // Leaving the edge would be worse than either alternative: it would keep
  // driving a parameter through a port nobody can see, while the panel showed
  // a value the graph ignores.
  const { graph, number, discretize } = placed();
  const paramId = findNodeKind(DISCRETIZE).params[0].id;
  const exposed = setParamExposed(graph, discretize, paramId, true).graph;
  const connected = addBenchEdge(
    exposed,
    { nodeId: number, ...numberOut },
    { nodeId: discretize, portId: paramPortId(paramId) },
  ).graph;
  assert.equal(connected.edges.length, 1);

  const { graph: withdrawn, removedEdges } = setParamExposed(connected, discretize, paramId, false);
  assert.equal(removedEdges.length, 1);
  assert.equal(withdrawn.edges.length, 0);
});

test("withdrawing a port leaves an ordinary value connection alone", () => {
  const { graph, perlin, discretize } = placed();
  const paramId = findNodeKind(DISCRETIZE).params[0].id;
  const exposed = setParamExposed(graph, discretize, paramId, true).graph;
  const connected = addBenchEdge(
    exposed,
    { nodeId: perlin, ...heightmapOut },
    { nodeId: discretize, portId: findNodeKind(DISCRETIZE).inputs[0].id },
  ).graph;

  const { graph: withdrawn, removedEdges } = setParamExposed(connected, discretize, paramId, false);
  assert.equal(removedEdges.length, 0);
  assert.equal(withdrawn.edges.length, 1, "the value connection must be untouched");
});

test("setting a parameter to the state it already has changes nothing", () => {
  const { graph, discretize } = placed();
  const paramId = findNodeKind(DISCRETIZE).params[0].id;
  const same = setParamExposed(graph, discretize, paramId, false);
  assert.equal(same.graph, graph, "an identical state must not produce a new graph");
});

test("a parameter the element does not declare is refused, not ignored", () => {
  // A silent no-op would leave the panel and the graph disagreeing about what
  // exists, which is the hardest kind of bug to see.
  const { graph, discretize } = placed();
  assert.throws(() => setParamExposed(graph, discretize, "not-a-parameter", true), /not-a-parameter/);
});

test("a copy presents the same surface as its original", () => {
  // Two settings compared side by side are only comparable if they show the
  // same ports.
  const { graph, discretize } = placed();
  const paramId = findNodeKind(DISCRETIZE).params[0].id;
  const exposed = setParamExposed(graph, discretize, paramId, true).graph;
  const { graph: copied, nodeId } = duplicateBenchNode(exposed, discretize);
  const copy = copied.nodes.find((candidate) => candidate.id === nodeId);
  assert.deepEqual([...copy.exposedParams], [paramId]);
});
