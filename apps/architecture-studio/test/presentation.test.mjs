import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGraphIrV1,
  findEntity,
  isGraphIrEdge,
  toCanvasPresentation,
  toEntityReference,
  toLayoutRequest,
} from "../src/presentation.ts";

const provenance = {
  extractor: { id: "extractor:test", version: "1.0.0" },
  sourceRevision: `git:${"a".repeat(40)}`,
  confidence: 1,
  evidence: [{ kind: "manifest", path: "project.json", sha256: "b".repeat(64) }],
};

const graph = {
  schemaVersion: "1.0.0",
  graphId: "test.workspace",
  sourceRevision: `git:${"a".repeat(40)}`,
  generator: { id: "extractor:test", version: "1.0.0", inputHash: "c".repeat(64) },
  nodes: [
    {
      id: "project:a",
      kind: "project",
      authorityClass: "canonical_authored_source",
      label: "a",
      tags: ["lang:rust"],
      provenance,
    },
    {
      id: "module:future",
      kind: "module",
      authorityClass: "derived_evidence",
      label: "future",
      tags: [],
      provenance,
    },
  ],
  edges: [
    {
      id: "edge:a-future",
      kind: "contains",
      source: "project:a",
      target: "module:future",
      relationClass: "declared",
      provenance,
    },
  ],
};

test("accepts Graph IR v1 and rejects unsupported or malformed top-level documents", () => {
  assert.doesNotThrow(() => assertGraphIrV1(graph));
  assert.throws(() => assertGraphIrV1({ ...graph, schemaVersion: "2.0.0" }), /Unsupported/);
  assert.throws(() => assertGraphIrV1({ ...graph, edges: null }), /Invalid Graph IR/);
});

test("maps every stable ID through an immutable generic canvas presentation", () => {
  const layout = {
    positions: [
      { id: "project:a", x: 100, y: 50 },
      { id: "module:future", x: 100, y: 140 },
    ],
    width: 430,
    height: 246,
  };
  const presentation = toCanvasPresentation(graph, layout);

  assert.deepEqual(
    presentation.nodes.map(({ id }) => id),
    ["project:a", "module:future"],
  );
  assert.deepEqual(presentation.edges, [
    {
      id: "edge:a-future",
      view: "architecture.relation",
      source: { nodeId: "project:a", portId: "bottom" },
      target: { nodeId: "module:future", portId: "top" },
      data: { treatment: "hierarchy" },
    },
  ]);
  assert.equal(Object.isFrozen(presentation), true);
  assert.equal(Object.isFrozen(presentation.nodes[0]), true);
  assert.deepEqual(presentation.nodes.map(({ view }) => view), [
    "architecture.entity-summary",
    "architecture.entity-summary",
  ]);
  assert.deepEqual(
    presentation.nodes.map(({ data }) => data),
    [
      { title: "a", description: "project", treatment: "project" },
      { title: "future", description: "module", treatment: "other" },
    ],
  );
  assert.deepEqual(
    presentation.nodes.map(({ id, x, y }) => ({ id, x, y })),
    [
      { id: "project:a", x: 100, y: 50 },
      { id: "module:future", x: 100, y: 140 },
    ],
  );
});

test("creates one centralized Rust layout request from the Graph IR", () => {
  const request = toLayoutRequest(graph);

  assert.deepEqual(request.nodes, ["project:a", "module:future"]);
  assert.deepEqual(request.groupingEdgeIds, ["edge:a-future"]);
  assert.deepEqual(request.edges, [
    { id: "edge:a-future", source: "project:a", target: "module:future" },
  ]);
  assert.equal(request.options.groupColumns, 3);
  assert.equal(request.options.nodeWidth, 288);
  assert.equal(request.options.nodeHeight, 84);
  assert.equal(Object.isFrozen(request), true);
});

test("rejects incomplete or inconsistent layout snapshots", () => {
  assert.throws(
    () =>
      toCanvasPresentation(graph, {
        positions: [{ id: "project:a", x: 0, y: 0 }],
        width: 0,
        height: 0,
      }),
    /did not return node: module:future/,
  );
  assert.throws(
    () =>
      toCanvasPresentation(graph, {
        positions: [
          { id: "project:a", x: 0, y: 0 },
          { id: "module:future", x: 0, y: 0 },
          { id: "unknown", x: 0, y: 0 },
        ],
        width: 0,
        height: 0,
      }),
    /unknown node: unknown/,
  );
});

test("finds nodes and edges by vendor-neutral references", () => {
  const node = findEntity(graph, { kind: "node", id: "project:a" });
  const edge = findEntity(graph, { kind: "edge", id: "edge:a-future" });

  assert.equal(node?.id, "project:a");
  assert.equal(edge?.id, "edge:a-future");
  assert.equal(isGraphIrEdge(edge), true);
  assert.deepEqual(toEntityReference(node), { kind: "node", id: "project:a" });
  assert.deepEqual(toEntityReference(edge), { kind: "edge", id: "edge:a-future" });
});
