import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isValidTaskId, taskCleanup, taskCommit, taskDone, taskNew, taskSweep, taskTest } from "./task-commands.ts";

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

test("taskNew sweeps first, silently, without disturbing an unrelated worktree it can't confirm as merged", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "EARLIER-TASK", base: "main" });

  const created = await taskNew(root, { taskId: "NEWER-TASK", base: "main" });
  assert.equal(created.ok, true);

  // gh has no real GitHub repo to check against here, so the sweep taskNew
  // ran internally could not confirm anything as merged -- both worktrees
  // must still be there.
  const entries = (await readdir(join(root, ".worktrees"))).sort();
  assert.deepEqual(entries, ["EARLIER-TASK", "NEWER-TASK"]);
});

test("taskNew reports nodeModulesLinked: false when the main checkout has no node_modules, without failing", async () => {
  const root = await makeRepoWithBareRemote();
  const created = await taskNew(root, { taskId: "DEMO-TASK", base: "main" });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.nodeModulesLinked, false);
});

test("taskNew links every node_modules in the tree (root and nested packages), pnpm-workspace style", async () => {
  const root = await makeRepoWithBareRemote();
  await mkdir(join(root, "node_modules", "some-pkg"), { recursive: true });
  await writeFile(join(root, "node_modules", "some-pkg", "index.js"), "module.exports = 1;\n", "utf8");
  // A package-local node_modules pnpm would never hoist to the root -- the
  // scenario a root-only link cannot cover.
  await mkdir(join(root, "tools", "fake-pkg", "node_modules", "@types"), { recursive: true });

  const created = await taskNew(root, { taskId: "DEMO-TASK", base: "main" });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.nodeModulesLinked, true);

  const worktree = join(root, ".worktrees", "DEMO-TASK");
  const rootLink = await readlink(join(worktree, "node_modules"));
  assert.equal(rootLink, join(root, "node_modules"));
  const nestedLink = await readlink(join(worktree, "tools", "fake-pkg", "node_modules"));
  assert.equal(nestedLink, join(root, "tools", "fake-pkg", "node_modules"));
});

test("taskTest returns a compact summary rather than raw output, for both a passing and a failing command", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "DEMO-TASK", base: "main" });
  const worktree = join(root, ".worktrees", "DEMO-TASK");
  await writeFile(
    join(worktree, "fake-pass.mjs"),
    "console.log('# tests 1');\nconsole.log('# pass 1');\nconsole.log('# fail 0');\n",
    "utf8",
  );
  await writeFile(join(worktree, "fake-fail.mjs"), "process.exit(1);\n", "utf8");

  const passing = await taskTest(root, { taskId: "DEMO-TASK", command: "node fake-pass.mjs" });
  assert.equal(passing.ok, true);
  if (!passing.ok) return;
  assert.equal(passing.passed, true);
  assert.match(passing.summary, /# pass 1/);

  const failing = await taskTest(root, { taskId: "DEMO-TASK", command: "node fake-fail.mjs" });
  assert.equal(failing.ok, true);
  if (!failing.ok) return;
  assert.equal(failing.passed, false);
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

test("taskSweep reports empty results when there is no .worktrees directory yet", async () => {
  const root = await makeRoot();
  const result = await taskSweep(root);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.cleaned, []);
  assert.deepEqual(result.skipped, []);
});

test("taskSweep never deletes anything when it cannot reach gh to confirm a real merge -- not even a branch that is a trivial ancestor of the base", async () => {
  // A fake bare remote has no real GitHub repo behind it, so `gh pr list`
  // always fails here -- this exercises the "can't confirm, so don't touch
  // it" safety path deliberately, not a stand-in for a real merge check.
  // It also proves the specific false-positive a local ancestry check alone
  // would have produced: fast-forwarding the fake remote's own base branch
  // to the "merged" task's tip makes the *other*, untouched task branch a
  // trivial ancestor of that same base too (it still points at their shared
  // root commit) -- ancestry alone cannot tell "merged" apart from "never
  // touched," which is exactly why there is no such fallback anymore.
  const root = await makeRoot();
  execFileSync("git", ["init", "-b", "master"], { cwd: root });
  execFileSync("git", ["commit", "--allow-empty", "-m", "root"], { cwd: root });
  const cloneRemote = await mkdtemp(join(tmpdir(), "ia-graft-remote-"));
  roots.push(cloneRemote);
  execFileSync("git", ["clone", "--bare", root, join(cloneRemote, "origin.git")], { cwd: root });
  execFileSync("git", ["remote", "add", "origin", join(cloneRemote, "origin.git")], { cwd: root });
  execFileSync("git", ["fetch", "origin"], { cwd: root });

  await taskNew(root, { taskId: "NOT-MERGED", base: "master" });
  await taskNew(root, { taskId: "ALREADY-MERGED", base: "master" });
  const mergedWorktree = join(root, ".worktrees", "ALREADY-MERGED");
  await writeFile(join(mergedWorktree, "note.txt"), "hello\n", "utf8");
  await taskCommit(root, { taskId: "ALREADY-MERGED", message: "add note" });
  execFileSync("git", ["push", "origin", "task/ALREADY-MERGED:master"], { cwd: mergedWorktree });

  const result = await taskSweep(root);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.cleaned, []);
  assert.equal(result.skipped.length, 2);

  await readdir(join(root, ".worktrees", "ALREADY-MERGED"));
  await readdir(join(root, ".worktrees", "NOT-MERGED"));
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
