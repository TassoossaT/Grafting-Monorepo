import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { delegateEdit } from "./delegate-edit-commands.ts";
import { taskNew } from "./task-commands.ts";

const roots: string[] = [];
test.after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** A real repo with a real `ia-graft` task worktree -- delegateEdit's safety gate depends on genuine git state, not a mock. */
const makeRepoWithTask = async (taskId: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ia-graft-delegate-edit-"));
  roots.push(root);
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(join(root, ".gitignore"), ".worktrees/\nnode_modules/\n", "utf8");
  execFileSync("git", ["add", ".gitignore"], { cwd: root });
  execFileSync("git", ["commit", "-m", "root"], { cwd: root });
  const created = await taskNew(root, { taskId, base: "main" });
  assert.equal(created.ok, true);
  return root;
};

test("delegateEdit rejects an invalid task id before touching git", async () => {
  const result = await delegateEdit("/repo", { taskId: "not valid", prompt: "hi" });
  assert.equal(result.ok, false);
});

test("delegateEdit rejects a missing prompt", async () => {
  const root = await makeRepoWithTask("DEMO-EDIT");
  const result = await delegateEdit(root, { taskId: "DEMO-EDIT", prompt: "" });
  assert.equal(result.ok, false);
});

test("delegateEdit refuses to run against a task that has no worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "ia-graft-delegate-edit-"));
  roots.push(root);
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  execFileSync("git", ["commit", "--allow-empty", "-m", "root"], { cwd: root });
  const result = await delegateEdit(root, { taskId: "NEVER-CREATED", prompt: "hi" });
  assert.equal(result.ok, false);
});

test("delegateEdit reports a file the agent created inside scope, without reverting it", async () => {
  const root = await makeRepoWithTask("DEMO-EDIT-2");
  const exec = (async (_cmd: string, _args: string[], options: { cwd: string }) => {
    await writeFile(join(options.cwd, "docs-notes.md"), "split content", "utf8");
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  const result = await delegateEdit(root, { taskId: "DEMO-EDIT-2", prompt: "split the doc", scope: ["docs-notes.md"] }, { exec });
  assert.equal(result.ok, true);
  assert.deepEqual((result as { changedFiles: string[] }).changedFiles, ["docs-notes.md"]);
  assert.deepEqual((result as { revertedOutOfScope: string[] }).revertedOutOfScope, []);
});

test("delegateEdit deletes a new (untracked) file the agent created outside scope", async () => {
  const root = await makeRepoWithTask("DEMO-EDIT-3");
  const worktree = join(root, ".worktrees", "DEMO-EDIT-3");
  const exec = (async (_cmd: string, _args: string[], options: { cwd: string }) => {
    await writeFile(join(options.cwd, "unrelated.ts"), "// should not survive", "utf8");
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  const result = await delegateEdit(root, { taskId: "DEMO-EDIT-3", prompt: "edit docs only", scope: ["docs/"] }, { exec });
  assert.equal(result.ok, true);
  assert.deepEqual((result as { changedFiles: string[] }).changedFiles, []);
  assert.deepEqual((result as { revertedOutOfScope: string[] }).revertedOutOfScope, ["unrelated.ts"]);
  assert.equal(existsSync(join(worktree, "unrelated.ts")), false, "the out-of-scope untracked file must actually be gone, not just reported as reverted");
});

test("delegateEdit reverts a modification to a tracked file outside scope, back to HEAD when the tree was clean", async () => {
  const root = await makeRepoWithTask("DEMO-EDIT-4");
  const worktree = join(root, ".worktrees", "DEMO-EDIT-4");
  await writeFile(join(worktree, "README.md"), "original\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: worktree });
  execFileSync("git", ["commit", "-m", "seed readme"], { cwd: worktree });

  const exec = (async (_cmd: string, _args: string[], options: { cwd: string }) => {
    await writeFile(join(options.cwd, "README.md"), "tampered\n", "utf8");
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  const result = await delegateEdit(root, { taskId: "DEMO-EDIT-4", prompt: "edit docs only", scope: ["docs/"] }, { exec });
  assert.equal(result.ok, true);
  assert.deepEqual((result as { revertedOutOfScope: string[] }).revertedOutOfScope, ["README.md"]);
  const restored = (await readFile(join(worktree, "README.md"), "utf8")).replace(/\r\n/g, "\n");
  assert.equal(restored, "original\n");
});

test("delegateEdit restores a tracked file to its PRE-CALL content, not HEAD, when the caller already had uncommitted changes to it", async () => {
  // Regression test: reverting an out-of-scope file must never destroy the
  // caller's own uncommitted work in that same file -- discovered live when
  // an out-of-scope edit collaterally wiped uncommitted work-in-progress by
  // resetting straight to HEAD instead of the pre-call state.
  const root = await makeRepoWithTask("DEMO-EDIT-5");
  const worktree = join(root, ".worktrees", "DEMO-EDIT-5");
  await writeFile(join(worktree, "README.md"), "committed\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: worktree });
  execFileSync("git", ["commit", "-m", "seed readme"], { cwd: worktree });
  // Caller's own uncommitted edit, made before invoking delegate edit at all.
  await writeFile(join(worktree, "README.md"), "my uncommitted work\n", "utf8");

  const exec = (async (_cmd: string, _args: string[], options: { cwd: string }) => {
    await writeFile(join(options.cwd, "README.md"), "gemini tampered this\n", "utf8");
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  const result = await delegateEdit(root, { taskId: "DEMO-EDIT-5", prompt: "edit docs only", scope: ["docs/"] }, { exec });
  assert.equal(result.ok, true);
  assert.deepEqual((result as { revertedOutOfScope: string[] }).revertedOutOfScope, ["README.md"]);
  const restored = (await readFile(join(worktree, "README.md"), "utf8")).replace(/\r\n/g, "\n");
  assert.equal(restored, "my uncommitted work\n", "must restore the caller's pre-call uncommitted content, not fall back to the last commit");
});

test("delegateEdit leaves a pre-existing untracked out-of-scope file alone instead of deleting it", async () => {
  const root = await makeRepoWithTask("DEMO-EDIT-6");
  const worktree = join(root, ".worktrees", "DEMO-EDIT-6");
  await writeFile(join(worktree, "scratch.txt"), "pre-existing scratch content", "utf8");

  const exec = (async () => ({ stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" })) as never;
  const result = await delegateEdit(root, { taskId: "DEMO-EDIT-6", prompt: "edit docs only", scope: ["docs/"] }, { exec });
  assert.equal(result.ok, true);
  assert.deepEqual((result as { revertedOutOfScope: string[] }).revertedOutOfScope, []);
  assert.equal(existsSync(join(worktree, "scratch.txt")), true);
});

test("delegateEdit pins the CLI's workspace to the worktree via --add-dir, not just cwd", async () => {
  // Regression test: `agy` was found to ignore the spawned process's cwd on
  // its own and write into its own default workspace instead; --add-dir is
  // what actually pins it to the intended directory.
  const root = await makeRepoWithTask("DEMO-EDIT-8");
  const worktree = join(root, ".worktrees", "DEMO-EDIT-8");
  let calledArgs: string[] = [];
  const exec = (async (_cmd: string, args: string[]) => {
    calledArgs = args;
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  await delegateEdit(root, { taskId: "DEMO-EDIT-8", prompt: "hi" }, { exec });
  assert.equal(calledArgs[calledArgs.indexOf("--add-dir") + 1], worktree);
});

test("delegateEdit surfaces a failure when the CLI itself fails", async () => {
  const root = await makeRepoWithTask("DEMO-EDIT-7");
  const exec = (async () => {
    throw new Error("spawn agy ENOENT");
  }) as never;
  const result = await delegateEdit(root, { taskId: "DEMO-EDIT-7", prompt: "hi" }, { exec });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /delegate edit failed.*ENOENT/);
});
