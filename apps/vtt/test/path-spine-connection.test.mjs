import assert from "node:assert/strict";
import test from "node:test";

import { resolvePathSpineEndpoint } from "../src/features/edit-construction/structure-types/path/path-spine-connection.ts";

const point = { x: 0, y: 0, z: 0 };
const nodes = [
  { nodeId: "free-end", position: point, degree: 1, surfaceRefs: ["path:a"] },
  { nodeId: "junction", position: { x: 10, y: 0, z: 0 }, degree: 3, surfaceRefs: ["path:b"] },
];
const edges = [
  {
    edgeId: "main-edge",
    from: { x: 2, y: 0, z: 0 },
    to: { x: 8, y: 0, z: 0 },
    surfaceRefs: ["path:b"],
  },
];

test("path-cloud gives continuation precedence over node and union candidates", () => {
  const resolved = resolvePathSpineEndpoint(
    {
      continuation: { nodeId: "free-end" },
      nodeId: "junction",
      unionSurfaceRef: "path:b",
    },
    point,
    nodes,
    edges,
    0.5,
  );
  assert.deepEqual(resolved, { kind: "continue", nodeId: "free-end" });
});

test("a continuation aimed at a junction falls through to the explicit node", () => {
  const resolved = resolvePathSpineEndpoint(
    { continuation: { nodeId: "junction" }, nodeId: "junction", unionSurfaceRef: "path:b" },
    { x: 10, y: 0, z: 0 },
    nodes,
    edges,
    0.5,
  );
  assert.deepEqual(resolved, { kind: "node", nodeId: "junction" });
});

test("a candidate surface resolves to an edge union only after continuation and node miss", () => {
  const resolved = resolvePathSpineEndpoint(
    { unionSurfaceRef: "path:b" },
    { x: 5, y: 0, z: 0.1 },
    nodes,
    edges,
    0.2,
  );
  assert.deepEqual(resolved, { kind: "union", edgeId: "main-edge" });
});

test("an unrelated endpoint stays free", () => {
  assert.deepEqual(resolvePathSpineEndpoint({}, { x: 30, y: 0, z: 30 }, nodes, edges, 0.5), { kind: "free" });
});
