import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { runDocCheck } from "./doc-check.ts";

test("runDocCheck validates AGENTS.md, GEMINI.md, and CLAUDE.md size limits", async () => {
  const repoRoot = resolve(process.cwd(), "../..");
  const result = await runDocCheck(repoRoot);
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 3);
  assert.equal(result.passed, true, JSON.stringify(result.checks, null, 2));
});
