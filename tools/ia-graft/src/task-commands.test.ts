import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isValidTaskId, taskCleanup, taskCommit, taskDone, taskNew } from "./task-commands.ts";

const roots: string[] = [];

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ia-graft-"));
  roots.push(root);
  return root;
};

test.after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("isValidTaskId accepts uppercase-led ids and rejects lowercase", () => {
  assert.equal(isValidTaskId("DEMO-TASK"), true);
  assert.equal(isValidTaskId("demo-task"), false);
});

test("taskNew rejects an invalid task id before touching git", async () => {
  const root = await makeRoot();
  const result = await taskNew(root, { taskId: "not valid" });
  assert.equal(result.ok, false);
});

test("taskDone rejects a task without a title or body before touching git", async () => {
  const root = await makeRoot();
  const result = await taskDone(root, { taskId: "DEMO-TASK", title: "", body: "" });
  assert.equal(result.ok, false);
});

test("taskCleanup rejects an invalid task id before touching git", async () => {
  const root = await makeRoot();
  const result = await taskCleanup(root, { taskId: "not valid" });
  assert.equal(result.ok, false);
});

test("taskCommit rejects an invalid task id or a missing message before touching git", async () => {
  const root = await makeRoot();
  const badId = await taskCommit(root, { taskId: "not valid", message: "x" });
  assert.equal(badId.ok, false);
  const noMessage = await taskCommit(root, { taskId: "DEMO-TASK", message: "" });
  assert.equal(noMessage.ok, false);
});

const makeRepoWithBareRemote = async (): Promise<string> => {
  const root = await makeRoot();
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["commit", "--allow-empty", "-m", "root"], { cwd: root });

  const cloneRemote = await mkdtemp(join(tmpdir(), "ia-graft-remote-"));
  roots.push(cloneRemote);
  execFileSync("git", ["clone", "--bare", root, join(cloneRemote, "origin.git")], { cwd: root });
  execFileSync("git", ["remote", "add", "origin", join(cloneRemote, "origin.git")], { cwd: root });
  execFileSync("git", ["fetch", "origin"], { cwd: root });
  return root;
};

test("taskNew creates a deterministic worktree that taskCleanup removes", async () => {
  const root = await makeRepoWithBareRemote();

  const created = await taskNew(root, { taskId: "DEMO-TASK", base: "main" });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const entries = await readdir(join(root, ".worktrees"));
  assert.deepEqual(entries, ["DEMO-TASK"]);

  const cleaned = await taskCleanup(root, { taskId: "DEMO-TASK" });
  assert.equal(cleaned.ok, true);
  await assert.rejects(readdir(join(root, ".worktrees", "DEMO-TASK")));
});

test("taskCommit stages and commits inside the task's own worktree", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "DEMO-TASK", base: "main" });
  const worktree = join(root, ".worktrees", "DEMO-TASK");
  await writeFile(join(worktree, "note.txt"), "hello\n", "utf8");

  const result = await taskCommit(root, { taskId: "DEMO-TASK", message: "add note" });
  assert.equal(result.ok, true);

  const log = execFileSync("git", ["log", "--oneline", "-1"], { cwd: worktree }).toString();
  assert.match(log, /add note/);
  const status = execFileSync("git", ["status", "--short"], { cwd: worktree }).toString();
  assert.equal(status.trim(), "");
});

test("taskDone pushes and falls back to a manual compare URL when gh cannot open a PR", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "DEMO-TASK", base: "main" });
  const worktree = join(root, ".worktrees", "DEMO-TASK");
  await writeFile(join(worktree, "note.txt"), "hello\n", "utf8");
  await taskCommit(root, { taskId: "DEMO-TASK", message: "add note" });

  const result = await taskDone(root, { taskId: "DEMO-TASK", title: "t", body: "b", base: "main" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(typeof result.prUrl, "string");
  // `gh` may or may not be installed/authenticated in the environment running this test;
  // either outcome must be well-formed rather than throwing.
  if (!result.opened) {
    assert.match(result.prUrl as string, /compare\/main\.\.\.task\/DEMO-TASK/);
    assert.equal(typeof result.note, "string");
  }
});
