import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { delegateResearch } from "./delegate-research-commands.ts";
import { taskNew } from "./task-commands.ts";

const roots: string[] = [];
test.after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const makeRepoWithTask = async (taskId: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ia-graft-delegate-research-"));
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

test("delegateResearch rejects a missing topic", async () => {
  const root = await makeRepoWithTask("DEMO-RESEARCH-1");
  const result = await delegateResearch(root, { taskId: "DEMO-RESEARCH-1", topic: "", outputFile: "docs/research/x.md" });
  assert.equal(result.ok, false);
});

test("delegateResearch rejects a missing outputFile", async () => {
  const root = await makeRepoWithTask("DEMO-RESEARCH-2");
  const result = await delegateResearch(root, { taskId: "DEMO-RESEARCH-2", topic: "widgets", outputFile: "" });
  assert.equal(result.ok, false);
});

test("delegateResearch rejects an outputFile that doesn't end in .md", async () => {
  const root = await makeRepoWithTask("DEMO-RESEARCH-3");
  const result = await delegateResearch(root, { taskId: "DEMO-RESEARCH-3", topic: "widgets", outputFile: "docs/research/x.txt" });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /must end in \.md/);
});

test("delegateResearch sends a fixed research prompt naming the topic and output file", async () => {
  const root = await makeRepoWithTask("DEMO-RESEARCH-4");
  let calledArgs: string[] = [];
  const exec = (async (_cmd: string, args: string[], options: { cwd: string }) => {
    calledArgs = args;
    await writeFile(join(options.cwd, "widget-research.md"), "# Widgets\n\ncontent\n\n## Sources\n", "utf8");
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  const result = await delegateResearch(root, { taskId: "DEMO-RESEARCH-4", topic: "modern widget manufacturing", outputFile: "widget-research.md" }, { exec });
  assert.equal(result.ok, true);
  const sentPrompt = calledArgs[calledArgs.indexOf("-p") + 1]!;
  assert.match(sentPrompt, /modern widget manufacturing/);
  assert.match(sentPrompt, /widget-research\.md/);
  assert.match(sentPrompt, /search/i);
  assert.match(sentPrompt, /## Sources/);
  assert.equal(calledArgs[calledArgs.indexOf("--model") + 1], "gemini-3.6-flash-medium");
});

test("delegateResearch pins scope to outputFile alone and reverts anything else the model touches", async () => {
  const root = await makeRepoWithTask("DEMO-RESEARCH-5");
  const exec = (async (_cmd: string, _args: string[], options: { cwd: string }) => {
    await writeFile(join(options.cwd, "widget-research.md"), "# Widgets\n", "utf8");
    await writeFile(join(options.cwd, "unrelated.md"), "should not survive", "utf8");
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  const result = await delegateResearch(root, { taskId: "DEMO-RESEARCH-5", topic: "widgets", outputFile: "widget-research.md" }, { exec });
  assert.equal(result.ok, true);
  const r = result as unknown as { changedFiles: Array<{ path: string }>; revertedOutOfScope: string[] };
  assert.deepEqual(r.changedFiles.map((f) => f.path), ["widget-research.md"]);
  assert.deepEqual(r.revertedOutOfScope, ["unrelated.md"]);
});

test("delegateResearch does NOT auto-ground with .ai/INDEX.md -- it's irrelevant overhead for an external topic", async () => {
  const root = await makeRepoWithTask("DEMO-RESEARCH-6");
  await mkdir(join(root, ".ai"), { recursive: true });
  await writeFile(join(root, ".ai", "INDEX.md"), "# Repo Index\n\nThis text must not appear in a research prompt.\n", "utf8");
  let calledArgs: string[] = [];
  const exec = (async (_cmd: string, args: string[], options: { cwd: string }) => {
    calledArgs = args;
    await writeFile(join(options.cwd, "widget-research.md"), "# Widgets\n", "utf8");
    return { stdout: JSON.stringify({ status: "SUCCESS", response: "done" }), stderr: "" };
  }) as never;
  await delegateResearch(root, { taskId: "DEMO-RESEARCH-6", topic: "widgets", outputFile: "widget-research.md" }, { exec });
  const sentPrompt = calledArgs[calledArgs.indexOf("-p") + 1]!;
  assert.doesNotMatch(sentPrompt, /This text must not appear/);
});
