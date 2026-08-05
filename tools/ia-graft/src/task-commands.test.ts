import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isValidTaskId, taskCheckout, taskCleanup, taskCommit, taskDoctor, taskDone, taskGraph, taskNew, taskSweep, taskTest } from "./task-commands.ts";

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
  await writeFile(join(root, ".gitignore"), ".worktrees/\n", "utf8");
  execFileSync("git", ["add", ".gitignore"], { cwd: root });
  execFileSync("git", ["commit", "-m", "root"], { cwd: root });

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

  const cleaned = await taskCleanup(root, { taskId: "DEMO-TASK", force: true });
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

test("taskDone distinguishes unavailable gh from a real PR creation failure", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "DEMO-TASK", base: "main" });
  const worktree = join(root, ".worktrees", "DEMO-TASK");
  await writeFile(join(worktree, "note.txt"), "hello\n", "utf8");
  await taskCommit(root, { taskId: "DEMO-TASK", message: "add note" });

  try {
    const result = await taskDone(root, { taskId: "DEMO-TASK", title: "t", body: "b", base: "main" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.prState, "manual");
      assert.match(result.note ?? "", /unavailable or unauthenticated/);
    }
  } catch (error) {
    assert.match(String(error), /gh pr create failed for base main/);
  }
});

test("taskNew resumes an existing task and taskStatus derives its state", async () => {
  const root = await makeRepoWithBareRemote();
  const first = await taskNew(root, { taskId: "RESUME-TASK", base: "main" });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.resumed, false);
  const second = await taskNew(root, { taskId: "RESUME-TASK", base: "main" });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.resumed, true);
  const status = await (await import("./task-commands.ts")).taskStatus(root, { taskId: "RESUME-TASK" });
  assert.equal(status.ok, true);
  if (status.ok) assert.equal(status.exists, true);
});

test("taskCleanup refuses an unmerged task unless force is explicit", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "KEEP-TASK", base: "main" });
  await assert.rejects(taskCleanup(root, { taskId: "KEEP-TASK" }), /refusing cleanup/);
  const cleaned = await taskCleanup(root, { taskId: "KEEP-TASK", force: true });
  assert.equal(cleaned.ok, true);
});
test("taskTest refuses dependency mutations against shared node_modules", async () => {
  const root = await makeRoot();
  const result = await taskTest(root, { taskId: "DEMO-TASK", command: "pnpm install" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /shared/);
});

test("taskNew reattaches an existing local task branch after its worktree was removed", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "REATTACH-TASK", base: "main" });
  const worktree = join(root, ".worktrees", "REATTACH-TASK");
  execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: root });

  const resumed = await taskNew(root, { taskId: "REATTACH-TASK", base: "main" });
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.repaired, false);
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: worktree }).toString().trim(), "task/REATTACH-TASK");
});

test("taskDoctor detects and taskNew repairs an orphan task directory", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "ORPHAN-TASK", base: "main" });
  const worktree = join(root, ".worktrees", "ORPHAN-TASK");
  execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: root });
  await mkdir(worktree, { recursive: true });
  await writeFile(join(worktree, "leftover.txt"), "orphan\n", "utf8");

  const diagnosis = await taskDoctor(root, { taskId: "ORPHAN-TASK" });
  assert.equal(diagnosis.ok, true);
  if (!diagnosis.ok) return;
  assert.equal(diagnosis.orphanDirectory, true);
  assert.equal(diagnosis.healthy, false);

  const repaired = await taskNew(root, { taskId: "ORPHAN-TASK", base: "main" });
  assert.equal(repaired.ok, true);
  if (!repaired.ok) return;
  assert.equal(repaired.repaired, true);
  await assert.rejects(readFile(join(worktree, "leftover.txt"), "utf8"));
});

test("force cleanup removes shared node_modules links without touching their targets", async () => {
  const root = await makeRepoWithBareRemote();
  await mkdir(join(root, "node_modules", "keep-me"), { recursive: true });
  await writeFile(join(root, "node_modules", "keep-me", "sentinel.txt"), "safe\n", "utf8");
  await taskNew(root, { taskId: "SAFE-CLEANUP", base: "main" });

  const cleaned = await taskCleanup(root, { taskId: "SAFE-CLEANUP", force: true });
  assert.equal(cleaned.ok, true);
  assert.equal(await readFile(join(root, "node_modules", "keep-me", "sentinel.txt"), "utf8"), "safe\n");
});

test("taskNew and taskGraph derive master when it is the real default branch", async () => {
  const root = await makeRoot();
  execFileSync("git", ["init", "-b", "master"], { cwd: root });
  execFileSync("git", ["commit", "--allow-empty", "-m", "root"], { cwd: root });
  const cloneRemote = await mkdtemp(join(tmpdir(), "ia-graft-remote-"));
  roots.push(cloneRemote);
  execFileSync("git", ["clone", "--bare", root, join(cloneRemote, "origin.git")], { cwd: root });
  execFileSync("git", ["remote", "add", "origin", join(cloneRemote, "origin.git")], { cwd: root });
  execFileSync("git", ["fetch", "origin"], { cwd: root });

  const created = await taskNew(root, { taskId: "DEFAULT-BASE" });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.base, "master");
  const graph = await taskGraph(root);
  assert.equal(graph.defaultBranch.branch, "master");
});

test("dependent tasks start from their parent and expose the stack in taskGraph", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "STACK-PARENT", base: "main" });
  const parentWorktree = join(root, ".worktrees", "STACK-PARENT");
  await writeFile(join(parentWorktree, "parent.txt"), "parent\n", "utf8");
  await taskCommit(root, { taskId: "STACK-PARENT", message: "parent layer" });

  const child = await taskNew(root, { taskId: "STACK-CHILD", parent: "STACK-PARENT" });
  assert.equal(child.ok, true);
  if (!child.ok) return;
  assert.equal(child.base, "task/STACK-PARENT");
  assert.equal(child.parent, "STACK-PARENT");
  assert.equal((await readFile(join(root, ".worktrees", "STACK-CHILD", "parent.txt"), "utf8")).trim(), "parent");

  const graph = await taskGraph(root);
  const row = graph.tasks.find((task) => task.taskId === "STACK-CHILD");
  assert.equal(row?.parent, "STACK-PARENT");
  assert.equal(row?.base, "task/STACK-PARENT");
});

test("task checkout moves a clean task to main for testing and restore recreates its worktree", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "CHECKOUT-TASK", base: "main" });

  const checkedOut = await taskCheckout(root, { taskId: "CHECKOUT-TASK" });
  assert.equal(checkedOut.ok, true);
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: root }).toString().trim(), "task/CHECKOUT-TASK");
  const during = await taskDoctor(root, { taskId: "CHECKOUT-TASK" });
  assert.equal(during.ok, true);
  if (!during.ok) return;
  assert.equal(during.checkoutMode, "main");

  await writeFile(join(root, "generated-during-test.txt"), "generated\n", "utf8");
  await assert.rejects(taskCheckout(root, { restore: true }), /uncommitted task changes/);
  const restored = await taskCheckout(root, { restore: true, force: true });
  assert.equal(restored.ok, true);
  assert.equal("discardedChanges" in restored && restored.discardedChanges, true);
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: root }).toString().trim(), "main");
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: join(root, ".worktrees", "CHECKOUT-TASK") }).toString().trim(), "task/CHECKOUT-TASK");
  await assert.rejects(readFile(join(root, "generated-during-test.txt"), "utf8"));
});

test("taskNew recreates a local worktree from an existing remote-only task branch", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "REMOTE-RESUME", base: "main" });
  const worktree = join(root, ".worktrees", "REMOTE-RESUME");
  await writeFile(join(worktree, "remote.txt"), "remote\n", "utf8");
  await taskCommit(root, { taskId: "REMOTE-RESUME", message: "remote state" });
  execFileSync("git", ["push", "origin", "task/REMOTE-RESUME"], { cwd: worktree });
  await taskCleanup(root, { taskId: "REMOTE-RESUME", force: true });

  const resumed = await taskNew(root, { taskId: "REMOTE-RESUME" });
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.resumed, true);
  assert.equal((await readFile(join(worktree, "remote.txt"), "utf8")).trim(), "remote");
});

test("force cleanup handles paths longer than the legacy Windows MAX_PATH", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "LONG-PATH-CLEANUP", base: "main" });
  const worktree = join(root, ".worktrees", "LONG-PATH-CLEANUP");
  const deep = join(worktree, ...Array.from({ length: 14 }, (_, index) => `segment-${index.toString().padStart(2, "0")}-abcdefghij`));
  await mkdir(deep, { recursive: true });
  await writeFile(join(deep, "sentinel.txt"), "long\n", "utf8");

  const cleaned = await taskCleanup(root, { taskId: "LONG-PATH-CLEANUP", force: true });
  assert.equal(cleaned.ok, true);
  await assert.rejects(readdir(worktree));
});

test("task done refuses a base that differs from the task's recorded parent", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "BASE-PARENT", base: "main" });
  await taskNew(root, { taskId: "BASE-CHILD", parent: "BASE-PARENT" });
  await assert.rejects(
    taskDone(root, { taskId: "BASE-CHILD", title: "child", body: "child body", base: "main" }),
    /task base mismatch/,
  );
  await assert.rejects(
    taskDone(root, { taskId: "BASE-CHILD", title: "child", body: "child body" }),
    /parent task branch task\/BASE-PARENT is not published/,
  );
});
