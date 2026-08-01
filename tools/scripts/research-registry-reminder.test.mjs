import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { reminderFor } from "./research-registry-reminder.mjs";

const roots = [];

const makeRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "grafting-research-registry-"));
  roots.push(root);
  return root;
};

test.after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const hook = (toolName, root, relativePath) => ({
  hook_event_name: "PostToolUse",
  tool_name: toolName,
  tool_input: { file_path: resolve(root, relativePath) },
});

test("ignores non-PostToolUse events", async () => {
  const root = await makeRoot();
  const input = { ...hook("Write", root, "docs/research/foo.md"), hook_event_name: "PreToolUse" };
  assert.equal(reminderFor(root, input), null);
});

test("ignores tools other than Write/Edit", async () => {
  const root = await makeRoot();
  assert.equal(reminderFor(root, hook("Bash", root, "docs/research/foo.md")), null);
});

test("ignores files outside docs/research", async () => {
  const root = await makeRoot();
  assert.equal(reminderFor(root, hook("Write", root, "docs/adr/ADR-0099.md")), null);
});

test("ignores the registry file itself, to avoid reminding about its own edits", async () => {
  const root = await makeRoot();
  const target = "docs/research/RESEARCH-DECISIONS-REGISTRY.md";
  assert.equal(reminderFor(root, hook("Write", root, target)), null);
  assert.equal(reminderFor(root, hook("Edit", root, target)), null);
});

test("reminds when Write touches a research document other than the registry", async () => {
  const root = await makeRoot();
  const reminder = reminderFor(root, hook("Write", root, "docs/research/new-topic.md"));
  assert.match(reminder, /docs\/research\/new-topic\.md/);
  assert.match(reminder, /RESEARCH-DECISIONS-REGISTRY\.md/);
});

test("reminds when Edit touches a research document other than the registry", async () => {
  const root = await makeRoot();
  const reminder = reminderFor(
    root,
    hook("Edit", root, "docs/research/ai-agent-context-and-multi-agent-management-options.md"),
  );
  assert.match(reminder, /ai-agent-context-and-multi-agent-management-options\.md/);
});

test("returns null when the tool target is outside the repository root", async () => {
  const root = await makeRoot();
  const outside = await makeRoot();
  assert.equal(
    reminderFor(root, hook("Write", outside, "docs/research/foo.md")),
    null,
  );
});
