import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { reminderFor } from "./doc-size-reminder.mjs";

const roots = [];

const makeRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "grafting-doc-size-"));
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
  const input = { ...hook("Write", root, "NOTES.md"), hook_event_name: "PreToolUse" };
  assert.equal(reminderFor(root, input), null);
});

test("ignores tools other than Write/Edit", async () => {
  const root = await makeRoot();
  assert.equal(reminderFor(root, hook("Bash", root, "NOTES.md")), null);
});

test("ignores non-Markdown files", async () => {
  const root = await makeRoot();
  await writeFile(resolve(root, "notes.txt"), "a\n".repeat(2000), "utf8");
  assert.equal(reminderFor(root, hook("Write", root, "notes.txt")), null);
});

test("stays silent for a Markdown file under the large threshold", async () => {
  const root = await makeRoot();
  await writeFile(resolve(root, "NOTES.md"), "a\n".repeat(10), "utf8");
  assert.equal(reminderFor(root, hook("Write", root, "NOTES.md")), null);
});

test("reminds when a Markdown file crosses the large threshold", async () => {
  const root = await makeRoot();
  await writeFile(resolve(root, "NOTES.md"), "a\n".repeat(600), "utf8");
  const reminder = reminderFor(root, hook("Write", root, "NOTES.md"));
  assert.match(reminder, /NOTES\.md is now \d+ lines \(large\)/);
});

test("names the colossal level once a Markdown file crosses that threshold", async () => {
  const root = await makeRoot();
  await writeFile(resolve(root, "NOTES.md"), "a\n".repeat(1600), "utf8");
  const reminder = reminderFor(root, hook("Edit", root, "NOTES.md"));
  assert.match(reminder, /\(colossal\)/);
});

test("stays silent for a large generated API reference", async () => {
  const root = await makeRoot();
  await mkdir(resolve(root, "docs/generated/api/rust"), { recursive: true });
  await writeFile(resolve(root, "docs/generated/api/rust/REFERENCE.md"), "a\n".repeat(2000), "utf8");
  assert.equal(reminderFor(root, hook("Write", root, "docs/generated/api/rust/REFERENCE.md")), null);
});

test("returns null when the target file no longer exists", async () => {
  const root = await makeRoot();
  assert.equal(reminderFor(root, hook("Write", root, "MISSING.md")), null);
});
