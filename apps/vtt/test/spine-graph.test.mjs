import assert from "node:assert/strict";
import test from "node:test";

import { addPosition } from "../src/features/edit-construction/orchestration/atomic-edit.ts";
import {
  moveSpineControlNode,
  neighborsOf,
  parseSpineControlNodeId,
  spineControlNodeId,
  spineGraphIn,
  spineGraphOf,
} from "../src/features/edit-construction/structure-types/path/spine-graph/index.ts";
import { cloudOf } from "./cloud-fixture.mjs";

/**
 * One road band as the region topology the engine would report: a quad ring
 * of `[spineFrom, spineTo, rimTo, rimFrom]`. Only `spineFrom`/`spineTo` use
 * `spineControlNodeId` -- the rim corners use ordinary ids, so a test can
 * check that `spineGraphIn` reads the two spine nodes and their edge back
 * out and leaves the rim alone.
 */
function band(id, spineFrom, spineTo, z) {
  const nodes = [
    { id: spineFrom, position: { x: 0, y: 0, z } },
    { id: spineTo, position: { x: 10, y: 0, z } },
    { id: `${id}:rim-to`, position: { x: 10, y: 0, z: z + 1 } },
    { id: `${id}:rim-from`, position: { x: 0, y: 0, z: z + 1 } },
  ];
  const outerLoop = nodes.map((node, index) => ({
    edgeId: `${id}-${index}`,
    reversed: false,
    startNodeId: node.id,
    endNodeId: nodes[(index + 1) % nodes.length].id,
    geometry: { kind: "line" },
  }));
  return {
    surfaceKey: ["@region", id],
    surfaceType: "path",
    physical: true,
    outerLoops: [outerLoop],
    holes: [],
    nodes,
  };
}

test("a spine control node id carries provenance, not ownership", () => {
  const id = spineControlNodeId("table:path-brush:7", 3);
  assert.equal(id, "spine:table:path-brush:7:3");
  assert.deepEqual(parseSpineControlNodeId(id), { operationId: "table:path-brush:7", index: 3 });
  assert.equal(parseSpineControlNodeId("some-wall-node"), undefined);
  // Unlike a station id, there is no station/across to carry -- a spine node
  // is addressed by the graph, not by a linear position along one run.
  assert.equal(parseSpineControlNodeId("table:path-brush:7:s3:a0"), undefined);
});

test("reads a single straight run as two control nodes and one curve edge, and leaves the rim alone", () => {
  const a = spineControlNodeId("run-1", 0);
  const b = spineControlNodeId("run-1", 1);
  const topology = band("run-1", a, b, 0);

  const graph = spineGraphIn([topology]);
  assert.equal(graph.nodes.length, 2);
  assert.deepEqual(
    graph.nodes.map((node) => node.nodeId).sort(),
    [a, b].sort(),
  );
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].fromNodeId, a);
  assert.equal(graph.edges[0].toNodeId, b);

  // spineGraphOf reads the same thing off a resolved cloud.
  const cloud = cloudOf(topology);
  assert.deepEqual(spineGraphOf(cloud), graph);
});

test("three runs meeting at one point read as one shared control node of degree three", () => {
  const hub = spineControlNodeId("hub", 0);
  const armA = spineControlNodeId("run-a", 1);
  const armB = spineControlNodeId("run-b", 1);
  const armC = spineControlNodeId("run-c", 1);

  const topologies = [
    band("run-a", hub, armA, 0),
    band("run-b", hub, armB, 10),
    band("run-c", hub, armC, 20),
  ];

  const graph = spineGraphIn(topologies);
  // The hub is reported once even though all three bands reference it.
  assert.equal(graph.nodes.filter((node) => node.nodeId === hub).length, 1);
  assert.equal(graph.nodes.length, 4); // hub + three arms
  assert.equal(graph.edges.length, 3);

  const hubNeighbors = neighborsOf(graph, hub);
  assert.equal(hubNeighbors.length, 3);
  assert.deepEqual(hubNeighbors.sort(), [armA, armB, armC].sort());

  // A real graph junction: one shared id, not three runs each believing a
  // welded node of their own until something reconciles them.
  for (const arm of [armA, armB, armC]) {
    assert.deepEqual(neighborsOf(graph, arm), [hub]);
  }
});

test("a control node with no neighbour on one side does not break reading the graph", () => {
  // A lone control point: present in the topology's own node list, but no
  // edge in any loop references it (an endpoint mid-edit, before its next
  // curve segment has been drawn).
  const lone = spineControlNodeId("run-x", 0);
  const topology = {
    surfaceKey: ["@region", "run-x"],
    surfaceType: "path",
    physical: true,
    outerLoops: [],
    holes: [],
    nodes: [{ id: lone, position: { x: 5, y: 0, z: 5 } }],
  };

  const graph = spineGraphIn([topology]);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.edges.length, 0);
  assert.deepEqual(neighborsOf(graph, lone), []);
});

test("moving a spine control node produces the same move-vertex op the generic edit pipeline already knows", () => {
  const node = { nodeId: spineControlNodeId("run-1", 0), position: { x: 1, y: 0, z: 2 } };
  const delta = { x: 3, y: 0, z: -1 };

  const op = moveSpineControlNode(node, delta);
  assert.deepEqual(op, {
    kind: "move-vertex",
    nodeId: node.nodeId,
    position: addPosition(node.position, delta),
  });
  assert.deepEqual(op.position, { x: 4, y: 0, z: 1 });
});
