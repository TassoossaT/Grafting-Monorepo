import assert from "node:assert/strict";
import test from "node:test";
import { toCanvasModel } from "../dist/model.js";

test("maps every IR node and edge without changing identifiers", () => {
  const ir = {
    schemaVersion: "0.1-spike",
    inputHash: "a".repeat(64),
    nodes: [
      { id: "project:a", kind: "project", label: "a", tags: ["lang:rust"], source: "a/project.json" },
      { id: "project:b", kind: "project", label: "b", tags: [], source: "b/project.json" },
    ],
    edges: [
      { id: "a-b", kind: "depends_on", source: "project:a", target: "project:b", evidence: "graph.json" },
    ],
  };

  const model = toCanvasModel(ir);

  assert.deepEqual(model.nodes.map(({ id }) => id), ["project:a", "project:b"]);
  assert.deepEqual(model.edges, [{ id: "a-b", source: "project:a", target: "project:b", label: "depends_on" }]);
});
