// I-004 tests. `extractGraphIr` is exercised against the real, committed
// docs/generated/project-graph.json and real project manifests -- this
// extractor has no synthetic/scratch mode, unlike G-006/G-007's scaffold
// generators, because its whole job is to reflect the actual repo
// structure. `jsonPointerEscape` is tested directly against RFC 6901
// examples: a Plan-review pass caught that no real project name lands
// inside a JSON Pointer segment today (only as a stableId, where escaping
// doesn't apply), so this is a direct unit test of the helper, not an
// end-to-end assertion on @grafting/isekai-wasm's real output.

import assert from "node:assert/strict";
import test from "node:test";
import { validateGraphIrDocument } from "./validate-graph-ir.mjs";
import {
  extractGraphIr,
  jsonPointerEscape,
  pathsFromGitPorcelain,
} from "./graph-ir-extract.mjs";

test("jsonPointerEscape follows RFC 6901 (~ before /)", () => {
  assert.equal(jsonPointerEscape("plain"), "plain");
  assert.equal(jsonPointerEscape("@grafting/isekai-wasm"), "@grafting~1isekai-wasm");
  assert.equal(jsonPointerEscape("a~b"), "a~0b");
  assert.equal(jsonPointerEscape("a~/b"), "a~0~1b");
});

test("Git porcelain parsing preserves the first path when its index status is blank", () => {
  assert.deepEqual(
    pathsFromGitPorcelain(
      " M apps/architecture-studio/project.json\n D packages/graph-x6/project.json",
    ),
    ["apps/architecture-studio/project.json", "packages/graph-x6/project.json"],
  );
});

test("extractGraphIr produces a document that passes both Graph IR v1 validation layers", async () => {
  const document = await extractGraphIr({ check: false });
  await assert.doesNotReject(() => validateGraphIrDocument(document));
  assert.equal(document.schemaVersion, "1.0.0");
  assert.ok(document.nodes.length > 0);
  assert.ok(document.edges.length > 0);
});

test("architecture-studio depends directly on x6-canvas after the atomic graph-x6 cutover", async () => {
  const document = await extractGraphIr({ check: false });
  const matches = document.edges.filter(
    (edge) => edge.kind === "depends_on" && edge.source === "project:architecture-studio" && edge.target === "project:x6-canvas",
  );
  assert.equal(matches.length, 1, "must collapse to exactly one edge, not one per Nx dependency type");
  assert.equal(matches[0].relationClass, "declared");
  assert.equal(matches[0].provenance.confidence, 1);
  assert.equal(
    document.nodes.some((node) => node.id === "project:graph-x6"),
    false,
  );
});

test("isekai-web-client->@grafting/isekai-wasm (static-only, no implicitDependencies entry) is derived, not declared", async () => {
  const document = await extractGraphIr({ check: false });
  const edge = document.edges.find(
    (candidate) =>
      candidate.kind === "depends_on" &&
      candidate.source === "project:isekai-web-client" &&
      candidate.target === "project:@grafting/isekai-wasm",
  );
  assert.ok(edge, "expected a real depends_on edge for this pair");
  assert.equal(edge.relationClass, "derived");
  assert.ok(edge.provenance.confidence < 1);
});

test("architecture-studio's explicitly declared `dev` target is canonical authored source", async () => {
  const document = await extractGraphIr({ check: false });
  const devTarget = document.nodes.find((node) => node.id === "target:architecture-studio/dev");
  assert.ok(devTarget, "expected the declared dev target to appear as a node");
  assert.equal(devTarget.authorityClass, "canonical_authored_source");
  assert.equal(devTarget.provenance.evidence[0].kind, "manifest");
  assert.equal(devTarget.provenance.evidence[0].path, "apps/architecture-studio/project.json");

  const checkTarget = document.nodes.find((node) => node.id === "target:architecture-studio/check");
  assert.equal(checkTarget.authorityClass, "canonical_authored_source");
  assert.equal(checkTarget.provenance.evidence[0].kind, "manifest");
});

test("--check passes immediately after a fresh generate", async () => {
  await extractGraphIr({ check: false });
  await assert.doesNotReject(() => extractGraphIr({ check: true }));
});
