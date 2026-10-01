import assert from "node:assert/strict";
import test from "node:test";
import { eavesOf, facesOfNodes } from "../src/features/edit-construction/orchestration/handle-neighbors.ts";

const node = (id, x, y, z) => ({ id, position: { x, y, z } });
const face = (key, nodes) => ({ surfaceKey: key, nodes, outerLoops: [], holes: [] });
const roof = face(["r", "a"], [node("e1", 0, 3, 0), node("e2", 6, 3, 0), node("p", 3, 5, 2)]);
const other = face(["w", "b"], [node("w1", 10, 0, 0)]);

test("a handle's own structure is the faces its nodes are in, so a lift never links to itself", () => {
  const own = facesOfNodes([roof, other], ["p"]);
  assert.equal(own.size, 1);
  assert.equal(facesOfNodes([roof, other], ["nothing"]).size, 0);
});

test("the eave a pitch is read from is the lowest node nearest the handle in plan", () => {
  const handle = { pivot: { x: 5, y: 5, z: 0 }, faces: undefined };
  const [eave] = eavesOf([roof], handle);
  assert.equal(eave.id, "e2");
  // Standing right over its eave there is no run to read.
  assert.deepEqual(eavesOf([roof], { pivot: { x: 6, y: 5, z: 0 } }), []);
});
