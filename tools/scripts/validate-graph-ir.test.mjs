import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { validateGraphIrDocument, validateGraphIrFile } from "./validate-graph-ir.mjs";

const root = resolve(import.meta.dirname, "../..");
const validPath = "docs/graph-ir/fixtures/valid-minimal.graph.json";

async function validDocument() {
  return JSON.parse(await readFile(resolve(root, validPath), "utf8"));
}

test("accepts the minimal Graph IR v1 fixture", async () => {
  const document = await validateGraphIrFile(validPath);
  assert.equal(document.schemaVersion, "1.0.0");
});

test("rejects records without evidence at the schema boundary", async () => {
  await assert.rejects(
    validateGraphIrFile("docs/graph-ir/fixtures/invalid-missing-evidence.graph.json"),
    /JSON Schema validation failed/,
  );
});

test("rejects dangling edge endpoints", async () => {
  await assert.rejects(
    validateGraphIrFile("docs/graph-ir/fixtures/invalid-dangling-edge.graph.json"),
    /references missing target project:missing/,
  );
});

test("rejects non-canonical edge IDs", async () => {
  const document = await validDocument();
  document.edges[0].id = "edge:wrong";
  await assert.rejects(validateGraphIrDocument(document), /id is not canonical/);
});

test("rejects unsorted and duplicate node IDs", async () => {
  const unsorted = await validDocument();
  unsorted.nodes.reverse();
  await assert.rejects(validateGraphIrDocument(unsorted), /nodes must be sorted by ID/);

  const duplicate = await validDocument();
  duplicate.nodes.push(structuredClone(duplicate.nodes[0]));
  await assert.rejects(validateGraphIrDocument(duplicate), /nodes IDs must be unique/);
});

test("rejects evidence path traversal", async () => {
  const document = await validDocument();
  document.nodes[0].provenance.evidence[0].path = "../outside.json";
  await assert.rejects(validateGraphIrDocument(document), /normalized repository-relative path/);
});
