import assert from "node:assert/strict";
import test from "node:test";
import { issueDoctor, issueList, issueNew, issueTree, issueUpdate, issueView } from "./issue-commands.ts";

test("issue list runs cleanly without throwing", async () => {
  const result = await issueList(process.cwd(), { limit: 5 });
  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert.equal(typeof result.count, "number");
    assert(Array.isArray(result.issues));
  }
});

test("issue view validates required id", async () => {
  const result = await issueView(process.cwd(), { id: "" });
  assert.equal(result.ok, false);
});

test("issue new validates required title", async () => {
  const result = await issueNew(process.cwd(), { title: "", type: "task" });
  assert.equal(result.ok, false);
});

test("issue update validates required id", async () => {
  const result = await issueUpdate(process.cwd(), { id: "" });
  assert.equal(result.ok, false);
});

test("issue tree runs cleanly and returns tree array", async () => {
  const result = await issueTree(process.cwd(), { limit: 10 });
  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert(Array.isArray(result.tree));
    assert(Array.isArray(result.orphans));
  }
});

test("issue doctor audits open issues without throwing", async () => {
  const result = await issueDoctor(process.cwd(), { limit: 10 });
  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert(typeof result.passed === "boolean");
    assert(Array.isArray(result.diagnostics));
  }
});

