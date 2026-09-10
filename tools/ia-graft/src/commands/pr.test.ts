import assert from "node:assert/strict";
import test from "node:test";
import { prChecks, prDiff, prList, prView } from "./pr.ts";

test("pr list runs cleanly without throwing", async () => {
  const result = await prList(process.cwd(), { limit: 5 });
  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert(Array.isArray(result.prs));
  }
});

test("pr view runs for a given PR", async () => {
  const result = await prView(process.cwd(), { id: 254 });
  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert.equal(typeof result.number, "number");
    assert.equal(typeof result.title, "string");
    assert.equal(typeof result.state, "string");
  }
});

test("pr checks runs for a given PR", async () => {
  const result = await prChecks(process.cwd(), { id: 254 });
  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert.equal(typeof result.totalChecks, "number");
    assert(Array.isArray(result.checks));
    assert(Array.isArray(result.failedChecks));
  }
});

test("pr diff runs for a given PR", async () => {
  const result = await prDiff(process.cwd(), { id: 254 });
  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert.equal(typeof result.totalFiles, "number");
    assert(Array.isArray(result.files));
  }
});
