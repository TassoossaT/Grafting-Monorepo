import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  evaluateAgentGitCommand,
  evaluateHook,
  isReadOnlyInspectionCommand,
} from "./agent-task-guard.mjs";

const roots = [];

const makeRoot = async (tasks = []) => {
  const root = await mkdtemp(join(tmpdir(), "grafting-agent-guard-"));
  roots.push(root);
  await mkdir(resolve(root, ".ai/state/tasks"), { recursive: true });
  await mkdir(resolve(root, ".ai/state/handoffs"), { recursive: true });
  for (const task of tasks) {
    await writeFile(
      resolve(root, `.ai/state/tasks/${task.task_id}.json`),
      `${JSON.stringify(task, null, 2)}\n`,
      "utf8",
    );
  }
  return root;
};

test.after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const task = (taskId, owner, affectedPaths, status = "in_progress") => ({
  task_id: taskId,
  status,
  owner,
  affected_paths: affectedPaths,
});

const hook = (toolName, toolInput = {}) => ({
  hook_event_name: "PreToolUse",
  tool_name: toolName,
  tool_input: toolInput,
});

test("blocks Bash until the agent owns an active task", async () => {
  const root = await makeRoot();
  const decision = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Bash", { command: "node build.mjs" }),
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /no in_progress task is owned by claude/);
});

test("allows only simple read-only inspection commands before a claim", async () => {
  const root = await makeRoot();
  const inspection = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Bash", { command: "git status --short" }),
  });
  const compound = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Bash", { command: "git status --short; touch escaped.txt" }),
  });
  assert.equal(inspection.allowed, true);
  assert.equal(compound.allowed, false);
  assert.equal(isReadOnlyInspectionCommand("rg --pre helper pattern ."), false);
});

test("allows a new task record to break the claim bootstrap cycle", async () => {
  const root = await makeRoot();
  const decision = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", { file_path: resolve(root, ".ai/state/tasks/I-004.json") }),
  });
  assert.equal(decision.allowed, true);
});

test("rejects mutation of completed and foreign-owned task records", async () => {
  const root = await makeRoot([
    task("DONE-TASK", "claude", [], "completed"),
    task("CODEX-TASK", "codex", [], "in_progress"),
  ]);
  const completed = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Edit", { file_path: resolve(root, ".ai/state/tasks/DONE-TASK.json") }),
  });
  const foreign = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Edit", { file_path: resolve(root, ".ai/state/tasks/CODEX-TASK.json") }),
  });
  assert.equal(completed.allowed, false);
  assert.match(completed.reason, /completed/);
  assert.equal(foreign.allowed, false);
  assert.match(foreign.reason, /belongs to codex/);
});

test("allows exact and directory-scoped writes owned by the active task", async () => {
  const root = await makeRoot([
    task("CLAUDE-TASK", "claude", ["README.md", "tools/extractor/"]),
  ]);
  const exact = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Edit", { file_path: resolve(root, "README.md") }),
  });
  const directory = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", { file_path: resolve(root, "tools/extractor/index.mjs") }),
  });
  assert.equal(exact.allowed, true);
  assert.equal(directory.allowed, true);
});

test("rejects writes outside the active task scope", async () => {
  const root = await makeRoot([task("CLAUDE-TASK", "claude", ["tools/extractor/"])]);
  const decision = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Edit", { file_path: resolve(root, "CURRENT_PLANNING_STATE.md") }),
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /outside active task CLAUDE-TASK/);
});

test("rejects paths owned by another active task", async () => {
  const root = await makeRoot([
    task("CLAUDE-TASK", "claude", ["docs/"]),
    task("CODEX-TASK", "codex", ["docs/adr/"]),
  ]);
  const decision = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", { file_path: resolve(root, "docs/adr/ADR-0014.md") }),
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /owned by active task CODEX-TASK/);
});

test("allows Bash only after a unique active claim", async () => {
  const root = await makeRoot([task("CLAUDE-TASK", "claude", ["tools/"])]);
  const decision = await evaluateHook({ root, agent: "claude", hookInput: hook("Bash") });
  assert.equal(decision.allowed, true);
});

test("rejects explicit and implicit agent commit operations even with an active task", async () => {
  const root = await makeRoot([task("CLAUDE-TASK", "claude", ["tools/"])]);
  const commands = [
    'git commit -m "forbidden"',
    "git merge feature",
    "git rebase main",
    "git cherry-pick abc123",
    "git revert abc123",
    "git stash push",
    "git pull origin main",
    "gh pr merge 17 --squash",
  ];
  for (const command of commands) {
    const decision = await evaluateHook({
      root,
      agent: "claude",
      hookInput: hook("Bash", { command }),
    });
    assert.equal(decision.allowed, false, command);
  }
});

test("allows branch preparation and only explicit isolated-branch pushes", async () => {
  const root = await makeRoot([task("CLAUDE-TASK", "claude", ["tools/"])]);
  const branch = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Bash", { command: "git switch -c ai/claude/CLAUDE-TASK" }),
  });
  const push = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Bash", { command: "git push -u origin ai/claude/CLAUDE-TASK" }),
  });
  const defaultPush = evaluateAgentGitCommand("git push origin main");
  const implicitPush = evaluateAgentGitCommand("git push");

  assert.equal(branch.allowed, true);
  assert.equal(push.allowed, true);
  assert.equal(defaultPush.allowed, false);
  assert.match(defaultPush.reason, /never push to main/);
  assert.equal(implicitPush.allowed, false);
  assert.match(implicitPush.reason, /explicit isolated/);
});

test("allows only fast-forward pulls", () => {
  assert.equal(evaluateAgentGitCommand("git pull --ff-only origin main").allowed, true);
  assert.equal(evaluateAgentGitCommand("git pull --rebase origin main").allowed, false);
});

test("rejects multiple simultaneous tasks owned by the same agent", async () => {
  const root = await makeRoot([
    task("CLAUDE-ONE", "claude", ["one/"]),
    task("CLAUDE-TWO", "claude", ["two/"]),
  ]);
  const decision = await evaluateHook({ root, agent: "claude", hookInput: hook("Bash") });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /more than one in_progress task/);
});

test("enforces handoff sender identity and immutability", async () => {
  const root = await makeRoot([task("CLAUDE-TASK", "claude", [".ai/state/handoffs/"])]);
  const correctPath = resolve(
    root,
    ".ai/state/handoffs/20260729T150000Z--CLAUDE-TASK--claude-to-codex.json",
  );
  const wrongPath = resolve(
    root,
    ".ai/state/handoffs/20260729T150001Z--CLAUDE-TASK--codex-to-claude.json",
  );
  const correct = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", { file_path: correctPath }),
  });
  const wrong = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", { file_path: wrongPath }),
  });
  await writeFile(correctPath, "{}\n", "utf8");
  const overwrite = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", { file_path: correctPath }),
  });
  assert.equal(correct.allowed, true);
  assert.equal(wrong.allowed, false);
  assert.match(wrong.reason, /identify claude as the sender/);
  assert.equal(overwrite.allowed, false);
  assert.match(overwrite.reason, /cannot be overwritten/);
});

test("rejects Write targets outside the repository", async () => {
  const root = await makeRoot([task("CLAUDE-TASK", "claude", ["docs/"])]);
  const decision = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", { file_path: resolve(root, "../outside.md") }),
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /outside the repository/);
});
