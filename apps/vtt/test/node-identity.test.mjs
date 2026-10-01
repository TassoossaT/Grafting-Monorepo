import assert from "node:assert/strict";
import test from "node:test";
import { NODE_PIXELS, graphNodeOf, nodeByGeometry } from "../src/composition/tabletop/tools/core/node-identity.ts";
import { slopeControlPoint } from "../src/composition/tabletop/tools/slope/slope-commit.ts";

const node = (id, x, y, z) => ({ id, position: { x, y, z } });
const nodes = [node("a", 0, 3, 0), node("b", 5, 0, 0)];
// A camera 10 up looking straight down: the ray through (x, 0, z).
const down = (x, z) => ({ origin: { x, y: 10, z }, direction: { x: 0, y: -1, z: 0 } });

test("the node under the pointer is the one nearest its ray, within so many pixels -- whether or not a dot was drawn", () => {
  const mpp = 0.02;
  const reach = NODE_PIXELS * mpp;
  // The ray passes 5 cm from the corner at height 3: it is there.
  const near = nodeByGeometry({ point: { x: 0.05, y: 0, z: 0 }, ray: down(0.05, 0) }, nodes, mpp);
  assert.equal(near?.id, "a");
  // A ray well off it is on nothing.
  assert.equal(nodeByGeometry({ point: { x: 2, y: 0, z: 0 }, ray: down(2, 0) }, nodes, mpp), undefined);
  // Just inside the reach, and just outside it -- the node is nearer the camera, so its reach on the ground is 0.7 of the screen's.
  assert.equal(nodeByGeometry({ point: { x: 0.6 * reach, y: 0, z: 0 }, ray: down(0.6 * reach, 0) }, nodes, mpp)?.id, "a");
  assert.equal(nodeByGeometry({ point: { x: 3 * reach, y: 0, z: 0 }, ray: down(3 * reach, 0) }, nodes, mpp), undefined);
});

test("a node behind what the pointer hit is not what is there", () => {
  // The surface was hit at 2 up, and the corner stands 10 below the camera's line past it.
  const behind = [node("far", 0, -5, 0)];
  assert.equal(nodeByGeometry({ point: { x: 0, y: 2, z: 0 }, ray: down(0, 0) }, behind, 0.02), undefined);
});

test("with no ray, the nearest node to the point hit within the reach is it", () => {
  assert.equal(nodeByGeometry({ point: { x: 5.1, y: 0, z: 0 } }, nodes, 1)?.id, "b");
  assert.equal(nodeByGeometry({ point: { x: 9, y: 0, z: 0 } }, nodes, 0.01), undefined);
});

test("a tool reads the node from the geometry first: a ramp takes the node's height with no dot picked", () => {
  const ctx = { runtime: { getGraphSnapshot: () => ({ nodes }) } };
  assert.equal(graphNodeOf({ node: nodes[0] }), "a");
  assert.equal(graphNodeOf({ nodeId: "b" }), "b", "a picked dot still names it");
  assert.equal(graphNodeOf({ node: nodes[0], nodeId: "b" }), "a", "geometry wins");
  assert.equal(slopeControlPoint(ctx, { point: { x: 0, y: 0, z: 0 }, node: nodes[0] }).y, 3);
  // With nothing under it: the picked surface's own height.
  assert.equal(slopeControlPoint(ctx, { point: { x: 9, y: 0.5, z: 9 } }).y, 0.5);
});
