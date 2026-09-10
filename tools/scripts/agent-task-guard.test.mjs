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
  MCP_ONLY_AGENTS,
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

test("allows the ia-graft launcher for an agent that has no MCP client", () => {
  for (const agent of ["codex", "gemini"]) {
    assert.equal(evaluateAgentGitCommand('.\\ia-graft.cmd task commit --id DEMO-TASK --message "progress"', agent).allowed, true);
    assert.equal(evaluateAgentGitCommand('./ia-graft.cmd task test --id DEMO-TASK --command "pnpm test"', agent).allowed, true);
    assert.equal(evaluateAgentGitCommand("node tools/ia-graft/src/bin.ts task sync --id DEMO-TASK", agent).allowed, true);
  }
});

/**
 * An agent with the MCP server registered has exactly one ia-graft path, so
 * the schema it is checked against is the one the registry generates rather
 * than none at all (#260). The deny message names the tool to call, derived
 * from the route rather than kept in a second table here.
 */
test("denies the ia-graft launcher for an MCP-only agent, naming the tool to use instead", () => {
  for (const agent of MCP_ONLY_AGENTS) {
    const decision = evaluateAgentGitCommand('.\\ia-graft.cmd task done --id DEMO-TASK --title "t" --body "b"', agent);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /mcp__ia-graft__graft_task_done/);

    assert.equal(evaluateAgentGitCommand("node tools/ia-graft/src/bin.ts task sync --id DEMO-TASK", agent).allowed, false);
    assert.match(
      evaluateAgentGitCommand(".\\ia-graft.cmd guard-check --tool Bash", agent).reason,
      /mcp__ia-graft__graft_guard_check/,
    );
  }
});

/**
 * Every rule is a substring match over the command line, so a forbidden
 * phrase quoted inside an argument used to be denied as though it were being
 * run -- which blocked, among other things, writing about the policy.
 */
test("a forbidden phrase quoted inside an argument is not treated as a command", () => {
  const quoted = [
    'echo "direct git commit is forbidden"',
    "echo 'run git push through ia-graft instead'",
    'node -e "console.log(\'gh issue create\')"',
  ];
  for (const command of quoted) {
    assert.equal(evaluateAgentGitCommand(command, "codex").allowed, true, command);
  }

  // The unquoted command itself is still denied.
  assert.equal(evaluateAgentGitCommand('git commit -m "direct git commit is forbidden"', "codex").allowed, false);
});

test("rejects direct package manager installation commands", () => {
  const installs = ["pnpm install", "npm install", "pnpm add lodash", "uv add pytest"];
  for (const command of installs) {
    const decision = evaluateAgentGitCommand(command);
    assert.equal(decision.allowed, false, command);
    assert.match(decision.reason, /direct package-manager installation is forbidden/);
  }
});

test("rejects direct git mutating commands in favor of ia-graft", () => {
  const mutatingGit = [
    { cmd: 'git commit -m "feat: new thing"', reason: /direct 'git commit' is forbidden/ },
    { cmd: "git add .", reason: /direct 'git add' is forbidden/ },
    { cmd: "git checkout -b feature", reason: /direct 'git checkout\/switch\/branch' is forbidden/ },
    { cmd: "git switch main", reason: /direct 'git checkout\/switch\/branch' is forbidden/ },
    { cmd: "git branch new-branch", reason: /direct 'git checkout\/switch\/branch' is forbidden/ },
    { cmd: "git push -u origin feature", reason: /direct 'git push' is forbidden/ },
    { cmd: "git reset --hard HEAD", reason: /direct raw git state mutation/ },
    { cmd: "git stash", reason: /direct raw git state mutation/ },
  ];

  for (const { cmd, reason } of mutatingGit) {
    const decision = evaluateAgentGitCommand(cmd);
    assert.equal(decision.allowed, false, cmd);
    assert.match(decision.reason, reason);
  }
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

test("rejects direct raw gh commands in favor of ia-graft", () => {
  const rawGhCommands = [
    "gh issue list",
    "gh issue view 224",
    "gh issue create --title 'x' --body 'y'",
    "gh pr create --title 'x' --body 'y'",
    "gh repo view",
  ];
  for (const command of rawGhCommands) {
    const decision = evaluateAgentGitCommand(command);
    assert.equal(decision.allowed, false, command);
    assert.match(decision.reason, /direct raw 'gh' commands are forbidden/);
  }
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
