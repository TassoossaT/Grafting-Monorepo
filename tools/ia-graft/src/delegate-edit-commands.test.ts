import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { delegateEdit } from "./delegate-edit-commands.ts";
import { taskNew } from "./task-commands.ts";

interface ChangedFileStat {
  path: string;
  status: "added" | "modified";
  linesBefore: number;
  linesAfter: number;
  wordsBefore: number;
  wordsAfter: number;
}
interface DelegateEditOk {
  changedFiles: ChangedFileStat[];
  revertedOutOfScope: string[];
  contentStats: { totalWordsBefore: number; totalWordsAfter: number; retentionRatio: number | null; possibleContentLoss: boolean };
}

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
  const r = result as unknown as DelegateEditOk;
  assert.deepEqual(r.changedFiles, [{ path: "docs-notes.md", status: "added", linesBefore: 0, linesAfter: 1, wordsBefore: 0, wordsAfter: 2 }]);
  assert.deepEqual(r.revertedOutOfScope, []);
});

test("delegateEdit keeps a file created inside a brand-new subdirectory, in scope, without deleting the whole directory", async () => {
  // Regression test: found live when a delegated research call wrote
  // docs/research/node-lts.md into a not-yet-existing docs/ directory.
  // `git status --porcelain` (without --untracked-files=all) collapses a
  // wholly-new directory into a single `?? docs/` entry; that collapsed
  // path didn't match the file-level scope, got treated as out of scope,
  // and `git clean`ed the entire directory away -- including the file
  // that was actually supposed to survive.
  const root = await makeRepoWithTask("DEMO-EDIT-15");
  const worktree = join(root, ".worktrees", "DEMO-EDIT-15");
  const exec = (async (_cmd: string, _args: string[], options: { cwd: string }) => {
    await mkdir(join(options.cwd, "docs", "research"), { recursive: true });
    await writeFile(join(options.cwd, "docs", "research", "node-lts.md"), "# Node LTS\n", "utf8");
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  const result = await delegateEdit(root, { taskId: "DEMO-EDIT-15", prompt: "research", scope: ["docs/research/node-lts.md"] }, { exec });
  assert.equal(result.ok, true);
  const r = result as unknown as DelegateEditOk;
  assert.deepEqual(r.changedFiles.map((f) => f.path), ["docs/research/node-lts.md"]);
  assert.deepEqual(r.revertedOutOfScope, []);
  assert.equal(existsSync(join(worktree, "docs", "research", "node-lts.md")), true);
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
  const r = result as unknown as DelegateEditOk;
  assert.deepEqual(r.changedFiles, []);
  assert.deepEqual(r.revertedOutOfScope, ["unrelated.ts"]);
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

test("delegateEdit reports per-file word/line stats and flags a sharp word-count drop as possible content loss", async () => {
  const root = await makeRepoWithTask("DEMO-EDIT-9");
  const worktree = join(root, ".worktrees", "DEMO-EDIT-9");
  await writeFile(join(worktree, "notes.md"), "one two three four five six seven eight nine ten\n", "utf8");
  execFileSync("git", ["add", "notes.md"], { cwd: worktree });
  execFileSync("git", ["commit", "-m", "seed notes"], { cwd: worktree });

  const exec = (async (_cmd: string, _args: string[], options: { cwd: string }) => {
    await writeFile(join(options.cwd, "notes.md"), "one two\n", "utf8");
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "trimmed" }), stderr: "" };
  }) as never;
  const result = await delegateEdit(root, { taskId: "DEMO-EDIT-9", prompt: "trim this", scope: ["notes.md"] }, { exec });
  assert.equal(result.ok, true);
  const r = result as unknown as DelegateEditOk;
  assert.equal(r.changedFiles.length, 1);
  assert.deepEqual(r.changedFiles[0], { path: "notes.md", status: "modified", linesBefore: 1, linesAfter: 1, wordsBefore: 10, wordsAfter: 2 });
  assert.equal(r.contentStats.retentionRatio, 0.2);
  assert.equal(r.contentStats.possibleContentLoss, true);
});

test("delegateEdit uses a pre-existing untracked file's real prior content as the stats baseline, not zero", async () => {
  // Regression test: found live when a scratch file that existed on disk
  // but had never been `git add`ed was treated as if it had no prior
  // content at all (wordsBefore: 0), masking a real drop from four
  // expected split files down to just one rewritten file.
  const root = await makeRepoWithTask("DEMO-EDIT-12");
  const worktree = join(root, ".worktrees", "DEMO-EDIT-12");
  await writeFile(join(worktree, "scratch.md"), "one two three four five six seven eight\n", "utf8"); // untracked, never committed

  const exec = (async (_cmd: string, _args: string[], options: { cwd: string }) => {
    await writeFile(join(options.cwd, "scratch.md"), "one two\n", "utf8");
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  const result = await delegateEdit(root, { taskId: "DEMO-EDIT-12", prompt: "trim this", scope: ["scratch.md"] }, { exec });
  assert.equal(result.ok, true);
  const r = result as unknown as DelegateEditOk;
  assert.equal(r.changedFiles[0]!.status, "modified");
  assert.equal(r.changedFiles[0]!.wordsBefore, 8);
  assert.equal(r.contentStats.retentionRatio, 0.25);
  assert.equal(r.contentStats.possibleContentLoss, true);
});

test("delegateEdit does not flag content loss when a split preserves total word count across the new files", async () => {
  const root = await makeRepoWithTask("DEMO-EDIT-10");
  const worktree = join(root, ".worktrees", "DEMO-EDIT-10");
  await writeFile(join(worktree, "big.md"), "alpha beta gamma delta epsilon zeta\n", "utf8");
  execFileSync("git", ["add", "big.md"], { cwd: worktree });
  execFileSync("git", ["commit", "-m", "seed big"], { cwd: worktree });

  const exec = (async (_cmd: string, _args: string[], options: { cwd: string }) => {
    await writeFile(join(options.cwd, "big.md"), "alpha beta gamma\n", "utf8");
    await writeFile(join(options.cwd, "part.md"), "delta epsilon zeta\n", "utf8");
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "split" }), stderr: "" };
  }) as never;
  const result = await delegateEdit(root, { taskId: "DEMO-EDIT-10", prompt: "split", scope: ["big.md", "part.md"] }, { exec });
  assert.equal(result.ok, true);
  const r = result as unknown as DelegateEditOk;
  assert.equal(r.contentStats.totalWordsBefore, 6);
  assert.equal(r.contentStats.totalWordsAfter, 6);
  assert.equal(r.contentStats.retentionRatio, 1);
  assert.equal(r.contentStats.possibleContentLoss, false);
});

test("delegateEdit automatically grounds the prompt with .ai/INDEX.md when present, at no extra caller cost", async () => {
  const root = await makeRepoWithTask("DEMO-EDIT-13");
  await mkdir(join(root, ".ai"), { recursive: true });
  await writeFile(join(root, ".ai", "INDEX.md"), "# Repo Index\n\nDocs live under docs/, split by topic.\n", "utf8");
  let calledArgs: string[] = [];
  const exec = (async (_cmd: string, args: string[]) => {
    calledArgs = args;
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  await delegateEdit(root, { taskId: "DEMO-EDIT-13", prompt: "do the thing" }, { exec });
  const sentPrompt = calledArgs[calledArgs.indexOf("-p") + 1]!;
  assert.match(sentPrompt, /Docs live under docs\/, split by topic\./);
  assert.match(sentPrompt, /do the thing/);
  assert.ok(sentPrompt.indexOf("Repo Index") < sentPrompt.indexOf("do the thing"), "auto grounding must come before the prompt, not after");
});

test("delegateEdit sends the prompt as-is when there is no .ai/INDEX.md and no explicit context", async () => {
  const root = await makeRepoWithTask("DEMO-EDIT-14");
  let calledArgs: string[] = [];
  const exec = (async (_cmd: string, args: string[]) => {
    calledArgs = args;
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  await delegateEdit(root, { taskId: "DEMO-EDIT-14", prompt: "do the thing" }, { exec });
  assert.equal(calledArgs[calledArgs.indexOf("-p") + 1], "do the thing");
});

test("delegateEdit prepends caller-supplied context ahead of the prompt sent to the CLI", async () => {
  const root = await makeRepoWithTask("DEMO-EDIT-11");
  let calledArgs: string[] = [];
  const exec = (async (_cmd: string, args: string[]) => {
    calledArgs = args;
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  await delegateEdit(root, { taskId: "DEMO-EDIT-11", prompt: "do the thing", context: "Repo convention: keep files under 200 lines." }, { exec });
  const sentPrompt = calledArgs[calledArgs.indexOf("-p") + 1]!;
  assert.match(sentPrompt, /Repo convention: keep files under 200 lines\./);
  assert.match(sentPrompt, /do the thing/);
  assert.ok(sentPrompt.indexOf("Repo convention") < sentPrompt.indexOf("do the thing"), "context must come before the prompt, not after");
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
