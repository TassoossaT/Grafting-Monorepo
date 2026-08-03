import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { reminderFor } from "./context-resolver-hook.mjs";

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "context-resolver-hook-"));
  mkdirSync(join(root, ".ai/state/tasks/in_progress"), { recursive: true });
  return root;
}

function writeTaskRecord(root, status, fields = {}) {
  const path = join(root, ".ai/state/tasks/in_progress", `${fields.task_id ?? "SOME-TASK"}.json`);
  writeFileSync(path, JSON.stringify({ task_id: "SOME-TASK", status, ...fields }));
  return path;
}

const hookInputFor = (tool, filePath, extra = {}) => ({
  hook_event_name: "PostToolUse",
  tool_name: tool,
  tool_input: { file_path: filePath, ...extra },
});

test("reminderFor returns the resolved digest for a Write that leaves a task in_progress", () => {
  const root = makeRoot();
  try {
    writeTaskRecord(root, "in_progress");
    const fakeResolve = ({ root: gotRoot, taskId }) => {
      assert.equal(gotRoot, root);
      assert.equal(taskId, "SOME-TASK");
      return "# Context resolution for SOME-TASK";
    };
    const digest = reminderFor(
      root,
      hookInputFor("Write", ".ai/state/tasks/in_progress/SOME-TASK.json"),
      fakeResolve,
    );
    assert.equal(digest, "# Context resolution for SOME-TASK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reminderFor returns null when the task record's current status is not in_progress", () => {
  const root = makeRoot();
  try {
    writeTaskRecord(root, "completed");
    const digest = reminderFor(
      root,
      hookInputFor("Edit", ".ai/state/tasks/in_progress/SOME-TASK.json"),
      () => "should not be called",
    );
    assert.equal(digest, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reminderFor returns null for a path outside .ai/state/tasks/<status>/<ID>.json", () => {
  const root = makeRoot();
  try {
    const digest = reminderFor(root, hookInputFor("Write", "packages/ui/AGENTS.md"), () => "unused");
    assert.equal(digest, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reminderFor returns null for a tool other than Write/Edit", () => {
  const root = makeRoot();
  try {
    writeTaskRecord(root, "in_progress");
    const digest = reminderFor(
      root,
      { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} },
      () => "unused",
    );
    assert.equal(digest, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reminderFor returns null for a non-PostToolUse hook event", () => {
  const root = makeRoot();
  try {
    writeTaskRecord(root, "in_progress");
    const digest = reminderFor(
      root,
      { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "x" } },
      () => "unused",
    );
    assert.equal(digest, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reminderFor returns null when the target file cannot be read (race with a later delete)", () => {
  const root = makeRoot();
  try {
    const digest = reminderFor(
      root,
      hookInputFor("Write", ".ai/state/tasks/in_progress/DOES-NOT-EXIST.json"),
      () => "unused",
    );
    assert.equal(digest, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reminderFor stays silent when the injected resolver throws", () => {
  const root = makeRoot();
  try {
    writeTaskRecord(root, "in_progress");
    const digest = reminderFor(
      root,
      hookInputFor("Write", ".ai/state/tasks/in_progress/SOME-TASK.json"),
      () => {
        throw new Error("missing docs/generated/project-graph.json");
      },
    );
    assert.equal(digest, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
