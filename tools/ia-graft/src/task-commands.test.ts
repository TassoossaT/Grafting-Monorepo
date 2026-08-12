import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { appendPullRequestSection, deleteRemoteBranchWithLease, GitClient, remoteBranchDeletionPlan } from "./git-client.ts";
import { formatCommitMessageWithCoAuthors, isValidTaskId, resolveCoAuthor, taskCheckout, taskCleanup, taskCommit, taskContext, taskDependencies, taskDoctor, taskDone, taskGraph, taskNew, taskResume, taskSweep, taskSync, taskTest } from "./task-commands.ts";

const roots: string[] = [];

const runPnpm = (args: string[], cwd: string): void => {
  const options = { cwd, env: { ...process.env, CI: "true" }, stdio: "pipe" as const };
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm.cmd", ...args], options);
    return;
  }
  execFileSync("pnpm", args, options);
};

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

test("appendPullRequestSection preserves what a reviewer may already have read", () => {
  const appended = appendPullRequestSection("First round.", "Second round.");

  assert.match(appended, /^First round\./, "the original description must survive");
  assert.match(appended, /Second round\.$/, "the new prose goes after it");
  assert.match(appended, /\n---\n/, "a visible rule marks where unread content starts");
});

test("appendPullRequestSection returns the addition alone when there is no body yet", () => {
  assert.equal(appendPullRequestSection("", "Only round."), "Only round.");
  assert.equal(appendPullRequestSection("   \n\n ", "Only round."), "Only round.");
});

test("appendPullRequestSection stacks repeated updates rather than collapsing them", () => {
  const once = appendPullRequestSection("Base.", "One.");
  const twice = appendPullRequestSection(once, "Two.");

  assert.equal((twice.match(/## Update/g) ?? []).length, 2);
  assert.ok(twice.indexOf("One.") < twice.indexOf("Two."), "updates stay in the order written");
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
  await writeFile(join(root, ".gitignore"), ".worktrees/\nnode_modules/\n", "utf8");
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

test("taskNew creates workspace-aware dependency overlays for root and nested packages", async () => {
  const root = await makeRepoWithBareRemote();
  await mkdir(join(root, "node_modules", "some-pkg"), { recursive: true });
  await writeFile(join(root, "node_modules", "some-pkg", "index.js"), "module.exports = 1;\n", "utf8");
  await mkdir(join(root, "tools", "fake-pkg", "node_modules", "@types", "example"), { recursive: true });

  const created = await taskNew(root, { taskId: "DEMO-TASK", base: "main" });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.nodeModulesLinked, true);
  assert.equal(created.dependencyMode, "workspace-aware");

  const worktree = join(root, ".worktrees", "DEMO-TASK");
  const marker = JSON.parse(await readFile(join(worktree, "node_modules", ".ia-graft-overlay.json"), "utf8"));
  assert.equal(marker.version, 1);
  assert.equal(await readlink(join(worktree, "node_modules", "some-pkg")), join(root, "node_modules", "some-pkg"));
  assert.equal(
    await readlink(join(worktree, "tools", "fake-pkg", "node_modules", "@types", "example")),
    join(root, "tools", "fake-pkg", "node_modules", "@types", "example"),
  );
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

test("resolveCoAuthor resolves known presets and custom author strings", () => {
  assert.equal(resolveCoAuthor("gemini"), "Gemini <gemini@google.com>");
  assert.equal(resolveCoAuthor("CLAUDE"), "Claude <claude@anthropic.com>");
  assert.equal(resolveCoAuthor("codex"), "Codex <codex@openai.com>");
  assert.equal(resolveCoAuthor("Custom <custom@example.com>"), "Custom <custom@example.com>");
  assert.equal(resolveCoAuthor("Agent X"), "Agent X <agent.x@ai.grafting.dev>");
});

test("formatCommitMessageWithCoAuthors appends Co-authored-by trailers correctly", () => {
  const formatted = formatCommitMessageWithCoAuthors("feat: add awesome feature", ["gemini", "claude"]);
  assert.equal(formatted, "feat: add awesome feature\n\nCo-authored-by: Gemini <gemini@google.com>\nCo-authored-by: Claude <claude@anthropic.com>\n");

  const existing = "feat: feature\n\nCo-authored-by: Gemini <gemini@google.com>\n";
  const updated = formatCommitMessageWithCoAuthors(existing, ["gemini", "codex"]);
  assert.equal(updated, "feat: feature\n\nCo-authored-by: Gemini <gemini@google.com>\nCo-authored-by: Codex <codex@openai.com>\n");
});

test("taskCommit appends Co-authored-by trailers when coAuthors or agent is specified", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "COAUTHOR-TASK", base: "main" });
  const worktree = join(root, ".worktrees", "COAUTHOR-TASK");
  await writeFile(join(worktree, "ai.txt"), "built by AI\n", "utf8");

  const result = await taskCommit(root, {
    taskId: "COAUTHOR-TASK",
    message: "feat: AI contribution",
    agent: "gemini",
    coAuthors: ["claude", "codex"],
  });
  assert.equal(result.ok, true);

  const fullLog = execFileSync("git", ["log", "-1"], { cwd: worktree }).toString();
  assert.match(fullLog, /feat: AI contribution/);
  assert.match(fullLog, /Co-authored-by: Gemini <gemini@google\.com>/);
  assert.match(fullLog, /Co-authored-by: Claude <claude@anthropic\.com>/);
  assert.match(fullLog, /Co-authored-by: Codex <codex@openai\.com>/);
});

test("taskSweep reports empty results when there is no .worktrees directory yet", async () => {
  const root = await makeRoot();
  const result = await taskSweep(root);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.cleaned, []);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.remoteBranches, []);
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

test("remote branch deletion requires a matching merged SHA and no open dependent PR", () => {
  const branch = "task/MERGED-TASK";
  const head = "a".repeat(40);
  const proof = { number: 42, headRefName: branch, headRefOid: head };

  assert.deepEqual(remoteBranchDeletionPlan(branch, undefined, proof, []), {
    remove: false,
    state: "already-absent",
    reason: "remote branch is already absent",
  });
  assert.equal(remoteBranchDeletionPlan(branch, head, proof, [77]).state, "preserved-open-dependent-pr");
  assert.equal(remoteBranchDeletionPlan(branch, head, proof, undefined).state, "preserved-verification-unavailable");
  assert.deepEqual(remoteBranchDeletionPlan(branch, head, proof, []), {
    remove: true,
    state: "delete",
    expectedHead: head,
    mergedPr: 42,
  });
  assert.throws(
    () => remoteBranchDeletionPlan(branch, "b".repeat(40), proof, []),
    /does not match merged PR/,
  );
  assert.throws(
    () => remoteBranchDeletionPlan("feature/not-a-task", head, proof, []),
    /outside task\/\*/,
  );
});

test("remote task branch deletion is atomic against the expected SHA", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "REMOTE-DELETE", base: "main" });
  const worktree = join(root, ".worktrees", "REMOTE-DELETE");
  await writeFile(join(worktree, "remote-delete.txt"), "delete me\n", "utf8");
  await taskCommit(root, { taskId: "REMOTE-DELETE", message: "remote deletion fixture" });
  const branch = "task/REMOTE-DELETE";
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree }).toString().trim();
  execFileSync("git", ["push", "origin", branch], { cwd: worktree });

  await assert.rejects(
    deleteRemoteBranchWithLease(root, branch, "0".repeat(40)),
    /stale info|rejected/,
  );
  assert.match(execFileSync("git", ["ls-remote", "--heads", "origin", branch], { cwd: root }).toString(), new RegExp(head));

  await deleteRemoteBranchWithLease(root, branch, head);
  assert.equal(execFileSync("git", ["ls-remote", "--heads", "origin", branch], { cwd: root }).toString().trim(), "");
  await taskCleanup(root, { taskId: "REMOTE-DELETE", force: true });
});

test("taskTest refuses dependency mutations inside a task worktree", async () => {
  const root = await makeRoot();
  const result = await taskTest(root, { taskId: "DEMO-TASK", command: "pnpm install" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /main checkout/);
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

test("force cleanup removes managed dependency overlays without touching their targets", async () => {
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
test("a stacked task retargets the default branch once its parent has landed", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "LANDED-PARENT", base: "main" });
  await taskNew(root, { taskId: "LANDED-CHILD", parent: "LANDED-PARENT" });
  // Publishing the parent at main is what a merged parent looks like from the
  // commit graph: it carries nothing main does not already have.
  execFileSync("git", ["push", "origin", "task/LANDED-PARENT"], { cwd: root });
  execFileSync("git", ["fetch", "origin"], { cwd: root });

  const client = new GitClient(root);
  // Otherwise the child's PR merges into a branch that is no longer going
  // anywhere, and its work never reaches main while the PR reads as merged.
  assert.equal(await client.resolveTaskBase("LANDED-CHILD"), "main");
  assert.equal(await client.resolveTaskBase("LANDED-CHILD", "main"), "main");
});

test("a stacked task still targets its parent while the parent is unmerged", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "OPEN-PARENT", base: "main" });
  await writeFile(join(root, ".worktrees", "OPEN-PARENT", "parent.txt"), "ahead\n", "utf8");
  await taskCommit(root, { taskId: "OPEN-PARENT", message: "parent work" });
  await taskNew(root, { taskId: "OPEN-CHILD", parent: "OPEN-PARENT" });
  execFileSync("git", ["push", "origin", "task/OPEN-PARENT"], { cwd: root });
  execFileSync("git", ["fetch", "origin"], { cwd: root });

  const client = new GitClient(root);
  assert.equal(await client.resolveTaskBase("OPEN-CHILD"), "task/OPEN-PARENT");
});

test("dependency overlays resolve workspace packages from the task worktree", async () => {
  const root = await makeRepoWithBareRemote();
  await mkdir(join(root, "node_modules"), { recursive: true });
  await mkdir(join(root, "packages", "local"), { recursive: true });
  await writeFile(join(root, "packages", "local", "index.js"), "module.exports = 'main';\n", "utf8");
  execFileSync("git", ["add", "packages/local/index.js"], { cwd: root });
  execFileSync("git", ["commit", "-m", "add local workspace package"], { cwd: root });
  await mkdir(join(root, "apps", "demo", "node_modules", "@scope"), { recursive: true });
  await symlink(join(root, "packages", "local"), join(root, "apps", "demo", "node_modules", "@scope", "local"), "junction");

  const created = await taskNew(root, { taskId: "WORKSPACE-LINKS", base: "main" });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.workspaceLinks, 1);
  const worktree = join(root, ".worktrees", "WORKSPACE-LINKS");
  const dependencyPath = join(worktree, "apps", "demo", "node_modules", "@scope", "local");
  assert.equal(await realpath(dependencyPath), await realpath(join(worktree, "packages", "local")));

  await writeFile(join(worktree, "packages", "local", "index.js"), "module.exports = 'task';\n", "utf8");
  assert.match(await readFile(join(dependencyPath, "index.js"), "utf8"), /task/);
  assert.match(await readFile(join(root, "packages", "local", "index.js"), "utf8"), /main/);

  const refreshed = await taskDependencies(root, { taskId: "WORKSPACE-LINKS" });
  assert.equal(refreshed.ok, true);
  if (refreshed.ok) assert.equal(refreshed.mode, "workspace-aware");

  await rm(join(worktree, "node_modules", ".ia-graft-overlay.json"));
  await assert.rejects(taskDependencies(root, { taskId: "WORKSPACE-LINKS" }), /unmanaged dependency directory/);
});

test("task deps --install materializes a frozen task lockfile without a main installation or lifecycle scripts", async () => {
  const root = await makeRepoWithBareRemote();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      private: true,
      scripts: { postinstall: "node -e \"require('node:fs').writeFileSync('postinstall-ran.txt','bad')\"" },
      dependencies: { "fixture-external": "file:vendor/fixture-external" },
    }),
    "utf8",
  );
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  await mkdir(join(root, "vendor", "fixture-external"), { recursive: true });
  await writeFile(
    join(root, "vendor", "fixture-external", "package.json"),
    JSON.stringify({ name: "fixture-external", version: "1.0.0", main: "index.js" }),
    "utf8",
  );
  await writeFile(join(root, "vendor", "fixture-external", "index.js"), "module.exports = 'task-only';\n", "utf8");
  runPnpm(["install", "--dir", root, "--lockfile-only", "--ignore-scripts"], root);
  execFileSync("git", ["add", "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "vendor"], { cwd: root });
  execFileSync("git", ["commit", "-m", "add task dependency fixture"], { cwd: root });
  await rm(join(root, "node_modules"), { recursive: true, force: true });

  const created = await taskNew(root, { taskId: "MATERIALIZED-DEPS", base: "main" });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.nodeModulesLinked, false);

  const installed = await taskDependencies(root, { taskId: "MATERIALIZED-DEPS", install: true });
  assert.equal(installed.ok, true);
  if (!installed.ok) return;
  assert.equal(installed.materialized, true);
  assert.match(installed.virtualStore ?? "", /node_modules[\\/]+\.ia-graft-task-deps/);
  const worktree = join(root, ".worktrees", "MATERIALIZED-DEPS");
  assert.match(await readFile(join(worktree, "node_modules", "fixture-external", "index.js"), "utf8"), /task-only/);
  await assert.rejects(readFile(join(worktree, "postinstall-ran.txt"), "utf8"));

  const resumed = await taskNew(root, { taskId: "MATERIALIZED-DEPS", base: "main" });
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.nodeModulesLinked, true);
  assert.equal(resumed.dependencyMode, "workspace-aware");
  assert.equal(resumed.dependenciesMaterialized, true);

  await writeFile(join(worktree, "pnpm-workspace.yaml"), "packages: []\n# changed after install\n", "utf8");
  const invalidated = await taskNew(root, { taskId: "MATERIALIZED-DEPS", base: "main" });
  assert.equal(invalidated.ok, true);
  if (!invalidated.ok) return;
  assert.equal(invalidated.dependenciesMaterialized, false);

  const cachePath = join(root, installed.virtualStore ?? "");
  const cleaned = await taskCleanup(root, { taskId: "MATERIALIZED-DEPS", force: true });
  assert.equal(cleaned.ok, true);
  if (!cleaned.ok) return;
  assert.equal(cleaned.dependencyCacheRemoved, true);
  await assert.rejects(readFile(join(cachePath, "lock.yaml"), "utf8"));
});

test("taskTest batches commands and caps generated output", async () => {
  const root = await makeRepoWithBareRemote();
  await taskNew(root, { taskId: "BATCH-TEST", base: "main" });
  const worktree = join(root, ".worktrees", "BATCH-TEST");
  await writeFile(join(worktree, "noisy.mjs"), "console.log('x'.repeat(20000));\n", "utf8");
  await writeFile(join(worktree, "quiet.mjs"), "console.log('ok');\n", "utf8");

  const batch = await taskTest(root, {
    taskId: "BATCH-TEST",
    commands: ["node noisy.mjs", "node quiet.mjs"],
    keepGoing: true,
  });
  assert.equal(batch.ok, true);
  if (!batch.ok) return;
  const results = batch.results;
  assert.ok(results);
  if (!results) return;
  assert.equal(batch.passed, true);
  assert.equal(results.length, 2);
  assert.ok(results[0]!.summary.length <= 6000);
  assert.match(results[0]!.summary, /line truncated/);

  const tooLarge = await taskTest(root, {
    taskId: "BATCH-TEST",
    commands: Array.from({ length: 13 }, () => "node quiet.mjs"),
  });
  assert.equal(tooLarge.ok, false);
  if (!tooLarge.ok) assert.match(tooLarge.error, /at most 12/);
});

test("taskSync integrates the recorded base with a forward-only merge commit", async () => {
  const root = await makeRepoWithBareRemote();
  await writeFile(join(root, "base.txt"), "base one\n", "utf8");
  execFileSync("git", ["add", "base.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "base one"], { cwd: root });
  execFileSync("git", ["push", "origin", "main"], { cwd: root });
  await taskNew(root, { taskId: "SYNC-TASK", base: "main" });
  const worktree = join(root, ".worktrees", "SYNC-TASK");
  await writeFile(join(worktree, "task.txt"), "task change\n", "utf8");
  await taskCommit(root, { taskId: "SYNC-TASK", message: "task change" });

  await writeFile(join(root, "base.txt"), "base two\n", "utf8");
  execFileSync("git", ["add", "base.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "base two"], { cwd: root });
  execFileSync("git", ["push", "origin", "main"], { cwd: root });

  await writeFile(join(worktree, "dirty.txt"), "not committed\n", "utf8");
  await assert.rejects(taskSync(root, { taskId: "SYNC-TASK", fetch: true }), /uncommitted changes/);
  await rm(join(worktree, "dirty.txt"));

  const synced = await taskSync(root, { taskId: "SYNC-TASK", fetch: true });
  assert.equal(synced.ok, true);
  if (!synced.ok) return;
  assert.equal(synced.completed, true);
  assert.equal(synced.updated, true);
  assert.equal(synced.mergeCommit, true);
  assert.match(await readFile(join(worktree, "base.txt"), "utf8"), /base two/);
  assert.equal(execFileSync("git", ["show", "-s", "--format=%P", "HEAD"], { cwd: worktree }).toString().trim().split(/\s+/).length, 2);
});

test("taskSync reports conflicts, protects taskCommit, and aborts only the unfinished merge", async () => {
  const root = await makeRepoWithBareRemote();
  await writeFile(join(root, "shared.txt"), "initial\n", "utf8");
  execFileSync("git", ["add", "shared.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "shared base"], { cwd: root });
  execFileSync("git", ["push", "origin", "main"], { cwd: root });
  await taskNew(root, { taskId: "CONFLICT-TASK", base: "main" });
  const worktree = join(root, ".worktrees", "CONFLICT-TASK");
  await writeFile(join(worktree, "shared.txt"), "task version\n", "utf8");
  await taskCommit(root, { taskId: "CONFLICT-TASK", message: "task version" });

  await writeFile(join(root, "shared.txt"), "base version\n", "utf8");
  execFileSync("git", ["add", "shared.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "base version"], { cwd: root });
  execFileSync("git", ["push", "origin", "main"], { cwd: root });

  const sync = await taskSync(root, { taskId: "CONFLICT-TASK", fetch: true });
  assert.equal(sync.ok, true);
  if (!sync.ok) return;
  assert.equal(sync.completed, false);
  assert.equal(sync.mergeInProgress, true);
  assert.deepEqual(sync.conflicts, ["shared.txt"]);

  const diagnosis = await taskDoctor(root, { taskId: "CONFLICT-TASK" });
  assert.equal(diagnosis.ok, true);
  if (diagnosis.ok) {
    assert.equal(diagnosis.mergeInProgress, true);
    assert.equal(diagnosis.syncSource, "origin/main");
    assert.match(diagnosis.recommendedAction, /task sync --abort/);
  }
  const unsafeCommit = await taskCommit(root, { taskId: "CONFLICT-TASK", message: "must not commit markers" });
  assert.equal(unsafeCommit.ok, false);
  if (!unsafeCommit.ok) assert.match(unsafeCommit.error, /conflict markers/);

  const aborted = await taskSync(root, { taskId: "CONFLICT-TASK", abort: true });
  assert.equal(aborted.ok, true);
  if (aborted.ok) assert.equal(aborted.aborted, true);
  assert.equal((await readFile(join(worktree, "shared.txt"), "utf8")).trim(), "task version");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: worktree }).toString().trim(), "");
});

test("taskContext resolves context sitemap and queries cleanly", async () => {
  const root = await makeRoot();
  await mkdir(join(root, ".ai"), { recursive: true });
  await writeFile(join(root, ".ai", "INDEX.md"), "# AI Context Index\n## Package Overview\n- UI: Component library");

  const full = await taskContext(root);
  assert.equal(full.ok, true);
  assert.match(full.summary!, /# AI Context Index/);

  const queryMatch = await taskContext(root, { query: "Component" });
  assert.equal(queryMatch.ok, true);
  assert.match(queryMatch.summary!, /UI: Component library/);
});

test("taskContext resolves pack mode using context-resolver", async () => {
  const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  const pack = await taskContext(repoRoot, { pack: true, paths: ["packages/ui/src/index.ts"] });
  assert.equal(pack.ok, true);
  assert.match(pack.pack!, /Context resolution/);
});

test("taskResume resolves state recovery context", async () => {
  const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  const result = await taskResume(repoRoot, { taskId: "G-TOOLING-CONTEXT-PACK" });
  assert.equal(result.ok, true);
  assert.equal(result.taskId, "G-TOOLING-CONTEXT-PACK");
  assert.equal(result.resumed, true);
  assert.ok(Array.isArray(result.recentCommits));
  assert.ok(Array.isArray(result.dirtyFiles));
  assert.ok(Array.isArray(result.affectedFiles));
});

