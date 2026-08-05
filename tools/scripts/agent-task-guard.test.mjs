import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  evaluateAgentGitCommand,
  evaluateHook,
  isHarnessManagedPath,
  isReadOnlyInspectionCommand,
  normalizeRepositoryPath,
} from "./agent-task-guard.mjs";

const roots = [];

const makeRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "grafting-agent-guard-"));
  roots.push(root);
  return root;
};

test.after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const hook = (toolName, toolInput = {}) => ({
  hook_event_name: "PreToolUse",
  tool_name: toolName,
  tool_input: toolInput,
});

test("normalizeRepositoryPath resolves an in-repo path and rejects an outside one", async () => {
  const root = await makeRoot();
  assert.equal(normalizeRepositoryPath(root, "docs/x.md"), "docs/x.md");
  assert.equal(normalizeRepositoryPath(root, resolve(root, "../outside.md")), null);
});

test("allows Write/Edit anywhere inside the repository, without any task claim", async () => {
  const root = await makeRoot();
  const decision = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", { file_path: resolve(root, "AGENTS.md") }),
  });
  assert.equal(decision.allowed, true);
});

test("rejects a Write/Edit target outside the repository", async () => {
  const root = await makeRoot();
  const decision = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", { file_path: resolve(root, "../outside.md") }),
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /outside the repository/);
});

test("isHarnessManagedPath recognizes memory and plan directories on either separator style", () => {
  assert.equal(
    isHarnessManagedPath("C:\\Users\\someone\\.claude\\projects\\my-project\\memory\\note.md"),
    true,
  );
  assert.equal(isHarnessManagedPath("/home/someone/.claude/projects/my-project/memory/note.md"), true);
  assert.equal(isHarnessManagedPath("C:\\Users\\someone\\.claude\\plans\\mellow-drifting-nova.md"), true);
  assert.equal(isHarnessManagedPath("/home/someone/.claude/plans/plan.md"), true);
  assert.equal(isHarnessManagedPath("C:\\Users\\someone\\Desktop\\outside.md"), false);
  assert.equal(isHarnessManagedPath(""), false);
  assert.equal(isHarnessManagedPath(undefined), false);
});

test("allows a Write to the harness memory/plan directories even though they resolve outside the repository", async () => {
  const root = await makeRoot();
  const memory = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", {
      file_path: resolve(tmpdir(), ".claude", "projects", "some-project", "memory", "note.md"),
    }),
  });
  const plan = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", { file_path: resolve(tmpdir(), ".claude", "plans", "some-plan.md") }),
  });
  assert.equal(memory.allowed, true);
  assert.equal(plan.allowed, true);
});

test("still rejects an unrelated outside-repository path even though the harness exception exists", async () => {
  const root = await makeRoot();
  const decision = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Write", { file_path: resolve(tmpdir(), "not-claude", "plans", "some-plan.md") }),
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /outside the repository/);
});

test("allows simple read-only inspection commands and rejects composed ones", async () => {
  const root = await makeRoot();
  const inspection = await evaluateHook({
    root,
    agent: "claude",
    hookInput: hook("Bash", { command: "git status --short" }),
  });
  assert.equal(inspection.allowed, true);
  assert.equal(isReadOnlyInspectionCommand("rg --pre helper pattern ."), false);
});

test("allows Bash with no claim at all, as long as it is not a forbidden git operation", async () => {
  const root = await makeRoot();
  const decision = await evaluateHook({ root, agent: "claude", hookInput: hook("Bash", { command: "pnpm test" }) });
  assert.equal(decision.allowed, true);
});

test("allows agents to commit forward and invoke controlled task sync", () => {
  assert.equal(evaluateAgentGitCommand('git commit -m "progress"').allowed, true);
  assert.equal(evaluateAgentGitCommand("node tools/ia-graft/src/bin.ts task sync --id DEMO-TASK").allowed, true);
});

test("rejects history-rewriting and merge operations", () => {
  const commands = [
    "git merge feature",
    "git rebase main",
    "git cherry-pick abc123",
    "git revert abc123",
    "git pull origin main",
    "gh pr merge 17 --squash",
  ];
  for (const command of commands) {
    const decision = evaluateAgentGitCommand(command);
    assert.equal(decision.allowed, false, command);
  }
});

test("allows branch preparation and pushes to any branch except main/master", () => {
  const branch = evaluateAgentGitCommand("git switch -c task/DEMO-TASK");
  const push = evaluateAgentGitCommand("git push -u origin task/DEMO-TASK");
  const defaultPush = evaluateAgentGitCommand("git push origin main");
  const implicitPush = evaluateAgentGitCommand("git push");

  assert.equal(branch.allowed, true);
  assert.equal(push.allowed, true);
  assert.equal(defaultPush.allowed, false);
  assert.match(defaultPush.reason, /never push to main/);
  assert.equal(implicitPush.allowed, true);
});

test("rejects force, mirror, bulk, tag, or delete pushes", () => {
  assert.equal(evaluateAgentGitCommand("git push --force origin task/DEMO-TASK").allowed, false);
  assert.equal(evaluateAgentGitCommand("git push --delete origin task/DEMO-TASK").allowed, false);
});

test("allows only fast-forward pulls", () => {
  assert.equal(evaluateAgentGitCommand("git pull --ff-only origin main").allowed, true);
  assert.equal(evaluateAgentGitCommand("git pull --rebase origin main").allowed, false);
});

test("evaluateHook rejects an unsupported mutating tool", async () => {
  const root = await makeRoot();
  const decision = await evaluateHook({ root, agent: "claude", hookInput: hook("NotebookEdit") });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /unsupported mutating tool/);
});
