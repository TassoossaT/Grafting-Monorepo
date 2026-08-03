import assert from "node:assert/strict";
import test from "node:test";
import { classifyDocSize, countLines, isAuthoredDoc } from "./doc-size.mjs";

test("countLines counts an empty string as zero lines", () => {
  assert.equal(countLines(""), 0);
});

test("countLines counts newline-separated lines, including a trailing blank line", () => {
  assert.equal(countLines("a\nb\nc"), 3);
  assert.equal(countLines("a\nb\nc\n"), 4);
});

test("classifyDocSize keeps ordinary documents ok", () => {
  assert.equal(classifyDocSize(0), "ok");
  assert.equal(classifyDocSize(499), "ok");
});

test("classifyDocSize flags a document at or past the large threshold", () => {
  assert.equal(classifyDocSize(500), "large");
  assert.equal(classifyDocSize(1499), "large");
});

test("classifyDocSize flags a document at or past the colossal threshold", () => {
  assert.equal(classifyDocSize(1500), "colossal");
  assert.equal(classifyDocSize(3628), "colossal");
});

test("isAuthoredDoc excludes generated API references and baseline snapshots", () => {
  assert.equal(isAuthoredDoc("docs/generated/api/rust/grafting-domain-core.md"), false);
  assert.equal(isAuthoredDoc("packages/ui/tests/snapshots/public-api.md"), false);
});

test("isAuthoredDoc includes ordinary authored documents", () => {
  assert.equal(isAuthoredDoc("GRAFTING_MASTER_SOURCE.md"), true);
  assert.equal(isAuthoredDoc("docs/research/vtt-map-and-terrain-construction-options.md"), true);
});
