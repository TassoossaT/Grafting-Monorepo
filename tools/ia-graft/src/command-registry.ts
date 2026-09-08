/**
 * Single Source of Truth (SSOT) Command Registry.
 *
 * Defines all ia-graft operations once. Both the CLI router (bin.ts) and the
 * Model Context Protocol server (mcp-server.ts) derive their routes, schemas,
 * tool manifests, and execution handlers from this single table.
 */

import { delegateRun } from "./delegate-commands.ts";
import { delegateEdit } from "./delegate-edit-commands.ts";
import { delegateResearch } from "./delegate-research-commands.ts";
import { runDocCheck } from "./doc-check.ts";
import { runGuardCheck } from "./guard-command.ts";
import {
  issueClose,
  issueDoctor,
  issueList,
  issueNew,
  issueReopen,
  issueTree,
  issueUpdate,
  issueView,
} from "./issue-commands.ts";
import { prChecks, prDiff, prList, prView } from "./pr-commands.ts";
import {
  taskCheckout,
  taskCleanup,
  taskCommit,
  taskContext,
  taskDependencies,
  taskDoctor,
  taskDone,
  taskGraph,
  taskNew,
  taskResume,
  taskStatus,
  taskSweep,
  taskSync,
  taskTest,
} from "./task-commands.ts";

export interface CommandParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  items?: { type: "string" };
  properties?: Record<string, unknown>;
}

export interface CommandDefinition {
  name: string;
  group: string;
  subcommand?: string;
  description: string;
  parameters: Record<string, CommandParameter>;
  aliases?: string[];
  handler: (repoRoot: string, input: any) => Promise<any>;
}

export const COMMAND_REGISTRY: CommandDefinition[] = [
  // ---------------------------------------------------------------------------
  // TASK COMMANDS
  // ---------------------------------------------------------------------------
  {
    name: "graft_task_new",
    group: "task",
    subcommand: "new",
    description: "Creates an isolated task worktree under .worktrees/<ID> branched from the base branch.",
    parameters: {
      taskId: { type: "string", description: "Task ID (e.g. TASK-123-FEATURE)", required: true },
      base: { type: "string", description: "Optional base branch name (defaults to repository default branch)" },
    },
    handler: (root, input) => taskNew(root, input ?? {}),
  },
  {
    name: "graft_task_resume",
    group: "task",
    subcommand: "resume",
    description: "Resumes or opens a task worktree and retrieves complete recovery context (commits, diffs, dirty files, dependencies).",
    parameters: {
      taskId: { type: "string", description: "Target task ID" },
      pr: { type: "number", description: "Optional PR number to resume from" },
    },
    handler: (root, input) => taskResume(root, input ?? {}),
  },
  {
    name: "graft_task_status",
    group: "task",
    subcommand: "status",
    description: "Checks health, branch, dirty files, and worktree status for a task.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true },
    },
    handler: (root, input) => taskStatus(root, input ?? {}),
  },
  {
    name: "graft_task_doctor",
    group: "task",
    subcommand: "doctor",
    description: "Diagnoses task worktree issues, merge conflicts, orphaned directories, or broken dependency overlays.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true },
    },
    handler: (root, input) => taskDoctor(root, input ?? {}),
  },
  {
    name: "graft_task_commit",
    group: "task",
    subcommand: "commit",
    description: "Stages and commits changes inside the task worktree with AI co-authorship.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true },
      message: { type: "string", description: "Conventional commit message", required: true },
      files: { type: "array", description: "Optional list of specific files to stage", items: { type: "string" } },
      amend: { type: "boolean", description: "Amend the previous commit" },
      dryRun: { type: "boolean", description: "Validate without writing a commit" },
      generateDocs: { type: "boolean", description: "Run docs:generate and include derived signatures in commit" },
      agent: { type: "string", description: "AI agent identifier" },
    },
    handler: (root, input) => taskCommit(root, input ?? {}),
  },
  {
    name: "graft_task_test",
    group: "task",
    subcommand: "test",
    description: "Runs verification command(s) inside the task worktree with token-capped summary output.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true },
      command: { type: "string", description: "Single verification command (e.g. pnpm test)" },
      commands: { type: "array", description: "List of verification commands to run sequentially", items: { type: "string" } },
      keepGoing: { type: "boolean", description: "Continue running remaining commands if one fails" },
    },
    handler: (root, input) => taskTest(root, input ?? {}),
  },
  {
    name: "graft_task_done",
    group: "task",
    subcommand: "done",
    description: "Pre-commit hook & PR submission: runs doc-check, mirrors artifacts, regenerates docs/signatures, creates single atomic commit, pushes branch, and opens/updates PR.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true },
      title: { type: "string", description: "Pull request title and commit message", required: true },
      body: { type: "string", description: "Pull request description markdown", required: true },
      base: { type: "string", description: "Target base branch (defaults to task base)" },
      skipDocGen: { type: "boolean", description: "Skip automatic docs:generate step" },
    },
    handler: (root, input) => taskDone(root, input ?? {}),
  },
  {
    name: "graft_task_sync",
    group: "task",
    subcommand: "sync",
    description: "Integrates base updates forward-only without rebasing to keep task branch synchronized.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true },
      fetch: { type: "boolean", description: "Fetch origin before merging base" },
      abort: { type: "boolean", description: "Abort an in-progress merge conflict" },
    },
    handler: (root, input) => taskSync(root, input ?? {}),
  },
  {
    name: "graft_task_deps",
    group: "task",
    subcommand: "deps",
    description: "Manages package dependencies in task worktree via directory overlays and lockfile sync without raw pnpm install.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true },
      install: { type: "boolean", description: "Materialize workspace dependency overlays" },
      updateLockfile: { type: "boolean", description: "Update lockfile with modified dependencies" },
      add: { type: "string", description: "Package spec to add (e.g. @scope/lib@workspace:*)" },
      workspace: { type: "string", description: "Target workspace package directory" },
      dev: { type: "boolean", description: "Add as devDependency" },
    },
    handler: (root, input) => taskDependencies(root, input ?? {}),
  },
  {
    name: "graft_task_cleanup",
    group: "task",
    subcommand: "cleanup",
    description: "Safely removes merged worktree and deletes task branch after PR merge.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true },
      force: { type: "boolean", description: "Force cleanup even if PR is not detected as merged" },
    },
    handler: (root, input) => taskCleanup(root, input ?? {}),
  },
  {
    name: "graft_task_checkout",
    group: "task",
    subcommand: "checkout",
    description: "Temporarily checks out task branch in main tree or restores previous checkout.",
    parameters: {
      taskId: { type: "string", description: "Target task ID" },
      restore: { type: "boolean", description: "Restore main checkout to previous branch" },
      force: { type: "boolean", description: "Force restore discarding untracked changes" },
    },
    handler: (root, input) => taskCheckout(root, input ?? {}),
  },
  {
    name: "graft_task_graph",
    group: "task",
    subcommand: "graph",
    description: "Returns the active task worktree dependency hierarchy graph.",
    parameters: {},
    handler: (root) => taskGraph(root),
  },
  {
    name: "graft_task_sweep",
    group: "task",
    subcommand: "sweep",
    description: "Sweeps and cleans all task worktrees whose pull requests have already merged.",
    parameters: {},
    handler: (root) => taskSweep(root),
  },

  // ---------------------------------------------------------------------------
  // CONTEXT COMMANDS
  // ---------------------------------------------------------------------------
  {
    name: "graft_context",
    group: "context",
    description: "Resolves token-efficient architectural context pack, project dependencies, and rules.",
    parameters: {
      pack: { type: "boolean", description: "Resolve structured context pack for active task" },
      taskId: { type: "string", description: "Target task ID to scope context resolution" },
      paths: { type: "array", description: "Target file paths to scope context resolution", items: { type: "string" } },
      query: { type: "string", description: "Search query across index and signatures" },
      scope: { type: "string", description: "Filter index by package or path prefix" },
      map: { type: "boolean", description: "Return repository structure map" },
    },
    aliases: ["graft_context_pack"],
    handler: (root, input) => {
      // If called via legacy graft_context_pack alias, default pack to true
      const effectiveInput = input?.pack === undefined && (input?.taskId || input?.paths)
        ? { ...input, pack: true }
        : (input ?? {});
      return taskContext(root, effectiveInput);
    },
  },

  // ---------------------------------------------------------------------------
  // ISSUE COMMANDS
  // ---------------------------------------------------------------------------
  {
    name: "graft_issue_list",
    group: "issue",
    subcommand: "list",
    description: "Lists GitHub issues filtered by state, milestone, area, priority, or type with parent-child metadata.",
    parameters: {
      limit: { type: "number", description: "Maximum issues to return (default 30)" },
      state: { type: "string", description: "Filter by issue state: open, closed, or all" },
      milestone: { type: "string", description: "Filter by milestone title" },
      area: { type: "string", description: "Filter by area label" },
      priority: { type: "string", description: "Filter by priority label (P0-crit, P1-high, etc.)" },
      type: { type: "string", description: "Filter by type label (task, epic, bug, decision)" },
    },
    handler: (root, input) => issueList(root, input ?? {}),
  },
  {
    name: "graft_issue_view",
    group: "issue",
    subcommand: "view",
    description: "Views detailed GitHub issue including parent epic, sub-issues summary, labels, and state.",
    parameters: {
      id: { type: "number", description: "Issue number", required: true },
    },
    handler: (root, input) => issueView(root, input ?? {}),
  },
  {
    name: "graft_issue_new",
    group: "issue",
    subcommand: "new",
    description: "Creates a new issue with standardized metadata labels and optional parent link.",
    parameters: {
      title: { type: "string", description: "Issue title", required: true },
      body: { type: "string", description: "Issue description markdown" },
      type: { type: "string", description: "Type label (task, epic, bug, decision)" },
      area: { type: "string", description: "Area label" },
      priority: { type: "string", description: "Priority label (P0-crit, P1-high, P2-medium, P3-low)" },
      milestone: { type: "string", description: "Milestone title" },
      parent: { type: "number", description: "Parent epic/issue number" },
    },
    handler: (root, input) => issueNew(root, input ?? {}),
  },
  {
    name: "graft_issue_update",
    group: "issue",
    subcommand: "update",
    description: "Updates issue title, body, status, priority, area, milestone, or parent.",
    parameters: {
      id: { type: "number", description: "Issue number to update", required: true },
      title: { type: "string", description: "New title" },
      body: { type: "string", description: "New body markdown" },
      status: { type: "string", description: "Status label (backlog, in-progress, in-review, blocked, done)" },
      priority: { type: "string", description: "Priority label" },
      area: { type: "string", description: "Area label" },
      milestone: { type: "string", description: "Milestone title" },
      parent: { type: "number", description: "Parent issue number" },
    },
    handler: (root, input) => issueUpdate(root, input ?? {}),
  },
  {
    name: "graft_issue_close",
    group: "issue",
    subcommand: "close",
    description: "Closes an issue with optional reason (completed, not_planned) and comment.",
    parameters: {
      id: { type: "number", description: "Issue number to close", required: true },
      reason: { type: "string", description: "Close reason: completed or not_planned" },
      comment: { type: "string", description: "Optional closing comment" },
    },
    handler: (root, input) => issueClose(root, input ?? {}),
  },
  {
    name: "graft_issue_reopen",
    group: "issue",
    subcommand: "reopen",
    description: "Reopens a closed issue with optional comment.",
    parameters: {
      id: { type: "number", description: "Issue number to reopen", required: true },
      comment: { type: "string", description: "Optional reopening comment" },
    },
    handler: (root, input) => issueReopen(root, input ?? {}),
  },
  {
    name: "graft_issue_tree",
    group: "issue",
    subcommand: "tree",
    description: "Returns hierarchical tree of epics, parent-child links, progress stats, and orphan tasks.",
    parameters: {
      epic: { type: "number", description: "Optional parent epic ID to scope the tree" },
    },
    handler: (root, input) => issueTree(root, input ?? {}),
  },
  {
    name: "graft_issue_doctor",
    group: "issue",
    subcommand: "doctor",
    description: "Audits repository issues for orphan tasks, missing metadata, cycles, and invalid parent-child links.",
    parameters: {},
    handler: (root) => issueDoctor(root),
  },

  // ---------------------------------------------------------------------------
  // PULL REQUEST COMMANDS
  // ---------------------------------------------------------------------------
  {
    name: "graft_pr_list",
    group: "pr",
    subcommand: "list",
    description: "Lists pull requests with branch, state, draft status, and CI check summary.",
    parameters: {
      limit: { type: "number", description: "Maximum PRs to return (default 30)" },
      state: { type: "string", description: "Filter by state: open, closed, merged, or all" },
      base: { type: "string", description: "Filter by target base branch" },
    },
    handler: (root, input) => prList(root, input ?? {}),
  },
  {
    name: "graft_pr_view",
    group: "pr",
    subcommand: "view",
    description: "Views pull request details including mergeability, CI checks rollup, and truncated body.",
    parameters: {
      id: { type: "number", description: "Pull request number", required: true },
    },
    handler: (root, input) => prView(root, input ?? {}),
  },
  {
    name: "graft_pr_checks",
    group: "pr",
    subcommand: "checks",
    description: "Inspects CI check run details and extracts tailored log failure summaries without dumping full logs.",
    parameters: {
      id: { type: "number", description: "Pull request number", required: true },
      failedOnly: { type: "boolean", description: "Only return failing check runs" },
    },
    handler: (root, input) => prChecks(root, input ?? {}),
  },
  {
    name: "graft_pr_diff",
    group: "pr",
    subcommand: "diff",
    description: "Returns token-compact diff summary or stat for a pull request.",
    parameters: {
      id: { type: "number", description: "Pull request number", required: true },
      stat: { type: "boolean", description: "Only return diffstat line counts per file" },
    },
    handler: (root, input) => prDiff(root, input ?? {}),
  },

  // ---------------------------------------------------------------------------
  // DELEGATE COMMANDS
  // ---------------------------------------------------------------------------
  {
    name: "graft_delegate_run",
    group: "delegate",
    subcommand: "run",
    description: "Executes a headless CLI prompt for web searches or broad surveys.",
    parameters: {
      prompt: { type: "string", description: "Instruction prompt", required: true },
      effort: { type: "string", description: "Effort level: low, medium, or high" },
      file: { type: "array", description: "Context files to pass", items: { type: "string" } },
      jsonSchema: { type: "string", description: "Optional JSON schema string for structured output" },
    },
    handler: (root, input) => delegateRun(root, input ?? {}),
  },
  {
    name: "graft_delegate_edit",
    group: "delegate",
    subcommand: "edit",
    description: "Delegates sandboxed code editing within a task worktree with revert-on-escape protection.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true },
      prompt: { type: "string", description: "Editing prompt", required: true },
      effort: { type: "string", description: "Effort level: low, medium, or high" },
      scope: { type: "array", description: "Allowed file/directory path prefixes", items: { type: "string" } },
      context: { type: "string", description: "Additional grounding context" },
    },
    handler: (root, input) => delegateEdit(root, input ?? {}),
  },
  {
    name: "graft_delegate_research",
    group: "delegate",
    subcommand: "research",
    description: "Delegates a deep research topic and writes the findings directly to a markdown file.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true },
      topic: { type: "string", description: "Research topic", required: true },
      outputFile: { type: "string", description: "Destination markdown file path (must end with .md)", required: true },
      effort: { type: "string", description: "Effort level: low, medium, or high" },
    },
    handler: (root, input) => delegateResearch(root, input ?? {}),
  },

  // ---------------------------------------------------------------------------
  // SYSTEM & GUARD COMMANDS
  // ---------------------------------------------------------------------------
  {
    name: "graft_doc_check",
    group: "doc-check",
    description: "Validates instruction file line count limits (AGENTS.md <= 100 lines, adapters <= 30 lines).",
    parameters: {},
    handler: (root) => runDocCheck(root),
  },
  {
    name: "graft_guard_check",
    group: "guard-check",
    description: "Validates deterministic tool permissions and blocks unsafe raw git or gh executions.",
    parameters: {
      tool: { type: "string", description: "Tool name (e.g. run_command)" },
      command: { type: "string", description: "Command line to check" },
    },
    handler: (root, input) => runGuardCheck(root, input ?? {}),
  },
];

/**
 * Converts a CommandDefinition into the standard Model Context Protocol tool schema.
 */
export function commandToMcpTool(cmd: CommandDefinition, overrideName?: string) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [paramName, paramDef] of Object.entries(cmd.parameters)) {
    if (paramDef.type === "array") {
      properties[paramName] = {
        type: "array",
        items: paramDef.items ?? { type: "string" },
        description: paramDef.description,
      };
    } else {
      properties[paramName] = {
        type: paramDef.type,
        description: paramDef.description,
      };
    }
    if (paramDef.required) {
      required.push(paramName);
    }
  }

  return {
    name: overrideName ?? cmd.name,
    description: cmd.description,
    inputSchema: {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  };
}

/**
 * Returns all active MCP tools, including both primary command names and backwards-compatible aliases.
 */
export function getAllMcpTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  const tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];
  for (const cmd of COMMAND_REGISTRY) {
    tools.push(commandToMcpTool(cmd));
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        tools.push(commandToMcpTool(cmd, alias));
      }
    }
  }
  return tools;
}

/**
 * Finds a command definition by its MCP tool name or alias.
 */
export function findCommandByMcpName(name: string): CommandDefinition | undefined {
  return COMMAND_REGISTRY.find((cmd) => cmd.name === name || (cmd.aliases && cmd.aliases.includes(name)));
}

/**
 * Finds a command definition by CLI group and subcommand route.
 */
export function findCommandByCliRoute(group: string, subcommand?: string): CommandDefinition | undefined {
  return COMMAND_REGISTRY.find((cmd) => {
    if (cmd.group !== group) return false;
    if (cmd.subcommand === undefined && (subcommand === undefined || subcommand === "")) return true;
    return cmd.subcommand === subcommand;
  });
}
