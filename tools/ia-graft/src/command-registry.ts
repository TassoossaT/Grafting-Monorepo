/**
 * Single source of truth for every ia-graft command.
 *
 * A command is declared exactly once, here, and three consumers are derived
 * from that one declaration:
 *
 *   - the MCP tool manifest and its JSON Schema (`mcp-server.ts`),
 *   - the `--flag value` argv parser (`flag-input.ts`),
 *   - the CLI route table and usage text (`bin.ts`).
 *
 * The declaration is bound to the handler's own input interface by
 * `defineCommand<TInput>`: `parameters` is a mapped type over `keyof
 * Required<TInput>`, so a field the handler accepts but nobody declared, a
 * declared field the handler does not have, and a required/optional mismatch
 * are all *compile* errors. Drift is caught by `pnpm typecheck`, not by
 * review -- which is the whole reason this table exists (#260: the schema had
 * silently diverged from ten handlers, and `graft_guard_check` was uncallable
 * because its required `agent` was missing from the manifest).
 *
 * Adding a command therefore means: write the handler and its `*Input`
 * interface, then add one `defineCommand<ThatInput>({...})` entry. There is
 * no second place to update.
 */

import { delegateRun, type DelegateRunInput } from "./commands/delegate/run.ts";
import { delegateEdit, type DelegateEditInput } from "./commands/delegate/edit.ts";
import { delegateResearch, type DelegateResearchInput } from "./commands/delegate/research.ts";
import { runDocCheck } from "./commands/doc-check.ts";
import { runGuardCheck, type GuardCheckInput } from "./commands/guard.ts";
import {
  issueClose,
  issueDoctor,
  issueList,
  issueNew,
  issueReopen,
  issueTree,
  issueUpdate,
  issueView,
  type IssueCloseInput,
  type IssueDoctorInput,
  type IssueListInput,
  type IssueNewInput,
  type IssueReopenInput,
  type IssueTreeInput,
  type IssueUpdateInput,
  type IssueViewInput,
} from "./commands/issue.ts";
import {
  prChecks,
  prDiff,
  prList,
  prView,
  type PrChecksInput,
  type PrDiffInput,
  type PrListInput,
  type PrViewInput,
} from "./commands/pr.ts";
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
  type TaskCheckoutInput,
  type TaskCleanupInput,
  type TaskCommitInput,
  type TaskContextInput,
  type TaskDependenciesInput,
  type TaskDoctorInput,
  type TaskDoneInput,
  type TaskNewInput,
  type TaskResumeInput,
  type TaskStatusInput,
  type TaskSyncInput,
  type TaskTestInput,
} from "./commands/task.ts";

/** A command whose handler takes no input at all. */
export type NoInput = Record<never, never>;

export interface ParameterSpec {
  /** JSON Schema type published to MCP, and the coercion applied to the raw argv string. */
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  /** Element type for `array`. Defaults to string. */
  items?: { type: "string" };
  /**
   * Primary CLI flag. Defaults to `--<kebab-case of the key>`, which is right
   * for most parameters; declare it only where the established flag differs
   * from the field name (`taskId` is `--id`, `files` is `--file`).
   */
  flag?: string;
  /** Further accepted spellings of the same flag, for back-compatibility. */
  flagAliases?: string[];
  /** Also bind the first non-flag argument after the route to this parameter. */
  positional?: true;
  /**
   * The value carries prose, so `--<flag>-file <path>` is accepted beside it.
   * Prefer the file form: `ia-graft.cmd` forwards argv with `%*` and
   * `cmd.exe` ends the command at a literal newline, so a multi-line value
   * passed inline is silently truncated.
   */
  prose?: true;
  /** `array` only: additionally split each occurrence on commas. */
  csv?: true;
  /** Parse the raw CLI string as JSON before handing it to the handler. */
  json?: true;
  /** Exposed over MCP but never read from argv, so no flag is derived. */
  mcpOnly?: true;
  /** Applied by the CLI when the flag is absent. A defaulted parameter is not reported as MCP-required. */
  default?: string | number | boolean;
}

type RequiredSpec = ParameterSpec & { required: true };
type OptionalSpec = ParameterSpec & { required?: false };

/**
 * Forces the declared parameters to be exactly the handler's input fields:
 * a field the handler accepts but nobody declared, a declared field the
 * handler does not have, and a required/optional mismatch are all errors.
 */
type ParametersOf<TInput> = {
  [K in keyof Required<TInput>]-?: undefined extends TInput[K] ? OptionalSpec : RequiredSpec;
};

/** A command route: a group, and optionally a subcommand under it. */
export interface CommandRoute {
  group: string;
  subcommand?: string;
}

export interface CommandDefinition<TInput> extends CommandRoute {
  /** MCP tool name, and the command's identity in error messages. */
  name: string;
  description: string;
  /** Extra CLI spellings of the same command, e.g. `task context` for `context`. */
  routeAliases?: CommandRoute[];
  parameters: ParametersOf<TInput>;
  handler: (repoRoot: string, input: TInput) => Promise<unknown>;
}

/** The registry's element type, with the per-command input type erased. */
export interface AnyCommand extends CommandRoute {
  name: string;
  description: string;
  routeAliases?: CommandRoute[];
  parameters: Record<string, ParameterSpec & { required?: boolean }>;
  handler: (repoRoot: string, input: any) => Promise<any>;
}

function defineCommand<TInput>(definition: CommandDefinition<TInput>): AnyCommand {
  return definition as unknown as AnyCommand;
}

export const COMMAND_REGISTRY: AnyCommand[] = [
  // ---------------------------------------------------------------------------
  // TASK COMMANDS
  // ---------------------------------------------------------------------------
  defineCommand<TaskNewInput>({
    name: "graft_task_new",
    group: "task",
    subcommand: "new",
    description: "Creates an isolated task worktree under .worktrees/<ID> branched from the base branch.",
    parameters: {
      taskId: { type: "string", description: "Task ID, e.g. TASK-123-FEATURE", required: true, flag: "--id" },
      base: { type: "string", description: "Base branch name, defaulting to the repository default branch" },
      parent: {
        type: "string",
        description:
          "Parent task ID to branch from. Do not use: a PR targeting task/** matches no CI trigger, and squash-merging the parent conflicts every child. See AGENTS.md section 2.",
      },
    },
    handler: (root, input) => taskNew(root, input),
  }),
  defineCommand<TaskResumeInput>({
    name: "graft_task_resume",
    group: "task",
    subcommand: "resume",
    description:
      "Resumes or opens a task worktree and retrieves complete recovery context: commits, diffs, dirty files, dependencies.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", flag: "--id" },
      pr: { type: "number", description: "PR number to resume from, when the task ID is unknown" },
    },
    handler: (root, input) => taskResume(root, input),
  }),
  defineCommand<TaskStatusInput>({
    name: "graft_task_status",
    group: "task",
    subcommand: "status",
    description: "Checks health, branch, dirty files, and worktree status for a task.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true, flag: "--id" },
    },
    handler: (root, input) => taskStatus(root, input),
  }),
  defineCommand<TaskDoctorInput>({
    name: "graft_task_doctor",
    group: "task",
    subcommand: "doctor",
    description: "Diagnoses task worktree issues, merge conflicts, orphaned directories, or broken dependency overlays.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true, flag: "--id" },
    },
    handler: (root, input) => taskDoctor(root, input),
  }),
  defineCommand<TaskCommitInput>({
    name: "graft_task_commit",
    group: "task",
    subcommand: "commit",
    description: "Stages and commits changes inside the task worktree with AI co-authorship.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true, flag: "--id" },
      message: { type: "string", description: "Conventional commit message", required: true, prose: true },
      files: { type: "array", description: "Specific files to stage, instead of everything dirty", flag: "--file" },
      coAuthors: {
        type: "array",
        description:
          "Co-authored-by trailers to append. The presets gemini, claude, codex and copilot expand to full identities.",
        flag: "--co-author",
      },
      agent: { type: "string", description: "Primary AI agent identifier, e.g. claude, gemini, codex" },
      amend: { type: "boolean", description: "Amend the previous commit" },
      dryRun: { type: "boolean", description: "Validate without writing a commit", flagAliases: ["--check"] },
      generateDocs: {
        type: "boolean",
        description: "Run docs:generate and include derived signatures in the commit",
        flagAliases: ["--docs"],
      },
    },
    handler: (root, input) => taskCommit(root, input),
  }),
  defineCommand<TaskTestInput>({
    name: "graft_task_test",
    group: "task",
    subcommand: "test",
    description: "Runs verification command(s) inside the task worktree with token-capped summary output.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true, flag: "--id" },
      command: {
        type: "string",
        description: "A single verification command, e.g. pnpm test. Mutually exclusive with commands.",
        mcpOnly: true,
      },
      commands: {
        type: "array",
        description: "Verification commands to run in order. Over the CLI, repeat --command.",
        flag: "--command",
      },
      keepGoing: { type: "boolean", description: "Continue running the remaining commands after one fails" },
    },
    handler: (root, input) => taskTest(root, input),
  }),
  defineCommand<TaskDoneInput>({
    name: "graft_task_done",
    group: "task",
    subcommand: "done",
    description:
      "Submits the task: runs doc-check, regenerates docs and signatures into one atomic commit, pushes the branch, and opens or updates the PR.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true, flag: "--id" },
      title: { type: "string", description: "Pull request title and commit message", required: true, prose: true },
      body: {
        type: "string",
        description: "Pull request description markdown, e.g. Closes #<ISSUE-ID>",
        required: true,
        prose: true,
      },
      base: { type: "string", description: "Target base branch, defaulting to the task base" },
      skipDocGen: { type: "boolean", description: "Skip the automatic docs:generate step", flagAliases: ["--skip-docs"] },
    },
    handler: (root, input) => taskDone(root, input),
  }),
  defineCommand<TaskSyncInput>({
    name: "graft_task_sync",
    group: "task",
    subcommand: "sync",
    description: "Integrates base updates forward-only, without rebasing, to keep the task branch synchronized.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true, flag: "--id" },
      fetch: { type: "boolean", description: "Fetch origin before merging the base" },
      abort: { type: "boolean", description: "Abort an in-progress merge conflict" },
    },
    handler: (root, input) => taskSync(root, input),
  }),
  defineCommand<TaskDependenciesInput>({
    name: "graft_task_deps",
    group: "task",
    subcommand: "deps",
    description:
      "Manages package dependencies in the task worktree through directory overlays and lockfile sync, without a raw install.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true, flag: "--id" },
      install: { type: "boolean", description: "Materialize workspace dependency overlays" },
      updateLockfile: {
        type: "boolean",
        description: "Update the lockfile with modified dependencies",
        flagAliases: ["--update"],
      },
      add: { type: "string", description: "Package spec to add, e.g. @scope/lib@workspace:*", flagAliases: ["--pkg"] },
      workspace: { type: "string", description: "Target workspace package directory", flagAliases: ["--filter"] },
      dev: { type: "boolean", description: "Add as a devDependency", flagAliases: ["-D"] },
    },
    handler: (root, input) => taskDependencies(root, input),
  }),
  defineCommand<TaskCleanupInput>({
    name: "graft_task_cleanup",
    group: "task",
    subcommand: "cleanup",
    description: "Safely removes a merged worktree and deletes the task branch after the PR merges.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true, flag: "--id" },
      force: { type: "boolean", description: "Clean up even when the PR is not detected as merged" },
    },
    handler: (root, input) => taskCleanup(root, input),
  }),
  defineCommand<TaskCheckoutInput>({
    name: "graft_task_checkout",
    group: "task",
    subcommand: "checkout",
    description: "Temporarily checks out a task branch in the main tree, or restores the previous checkout.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", flag: "--id" },
      restore: { type: "boolean", description: "Restore the main checkout to its previous branch" },
      force: { type: "boolean", description: "Force the restore, discarding untracked changes" },
    },
    handler: (root, input) => taskCheckout(root, input),
  }),
  defineCommand<NoInput>({
    name: "graft_task_graph",
    group: "task",
    subcommand: "graph",
    description: "Returns the active task worktree dependency hierarchy graph.",
    parameters: {},
    handler: (root) => taskGraph(root),
  }),
  defineCommand<NoInput>({
    name: "graft_task_sweep",
    group: "task",
    subcommand: "sweep",
    description: "Sweeps and cleans every task worktree whose pull request has already merged.",
    parameters: {},
    handler: (root) => taskSweep(root),
  }),

  // ---------------------------------------------------------------------------
  // CONTEXT
  // ---------------------------------------------------------------------------
  defineCommand<TaskContextInput>({
    name: "graft_context",
    group: "context",
    routeAliases: [{ group: "task", subcommand: "context" }],
    description:
      "Resolves a token-efficient architectural context pack, project dependencies, and rules. Run this when starting or resuming a task. With no arguments it returns the repository structure map.",
    parameters: {
      pack: { type: "boolean", description: "Resolve the structured context pack for the active task" },
      taskId: {
        type: "string",
        description: "Task ID to scope context resolution to. Implies pack.",
        flag: "--id",
        flagAliases: ["--task"],
      },
      paths: { type: "array", description: "File paths to scope context resolution to", csv: true },
      query: { type: "string", description: "Search query across the index and extracted signatures" },
      scope: { type: "string", description: "Filter the index by package or path prefix" },
    },
    handler: (root, input) => taskContext(root, input),
  }),

  // ---------------------------------------------------------------------------
  // ISSUE COMMANDS
  // ---------------------------------------------------------------------------
  defineCommand<IssueListInput>({
    name: "graft_issue_list",
    group: "issue",
    subcommand: "list",
    description: "Lists GitHub issues filtered by type, area, status, priority, or parent, with parent-child metadata.",
    parameters: {
      type: { type: "string", description: "Filter by type label: task, epic, bug, decision" },
      area: { type: "string", description: "Filter by area label" },
      status: {
        type: "string",
        description: "Filter by status label: backlog, in-progress, in-review, blocked, done",
      },
      priority: {
        type: "string",
        description: "Filter by priority label: P0-critical, P1-high, P2-medium, P3-low",
      },
      limit: { type: "number", description: "Maximum issues to return, default 30" },
      parent: { type: "number", description: "Only issues under this parent epic" },
      orphan: { type: "boolean", description: "Only issues with no parent epic" },
    },
    handler: (root, input) => issueList(root, input),
  }),
  defineCommand<IssueViewInput>({
    name: "graft_issue_view",
    group: "issue",
    subcommand: "view",
    description: "Views one issue in detail, including parent epic, sub-issue summary, labels, and state.",
    parameters: {
      id: { type: "number", description: "Issue number", required: true, positional: true },
    },
    handler: (root, input) => issueView(root, input),
  }),
  defineCommand<IssueNewInput>({
    name: "graft_issue_new",
    group: "issue",
    subcommand: "new",
    description: "Creates a new issue with standardized metadata labels and an optional parent link.",
    parameters: {
      title: { type: "string", description: "Issue title", required: true, prose: true },
      type: {
        type: "string",
        description: "Type label: task, refinement, chore, bug, epic",
        required: true,
        default: "task",
      },
      area: { type: "string", description: "Area label" },
      priority: { type: "string", description: "Priority label: P0-critical, P1-high, P2-medium, P3-low" },
      status: { type: "string", description: "Status label: backlog, in-progress, in-review, blocked, done" },
      milestone: { type: "string", description: "Milestone title" },
      body: { type: "string", description: "Issue description markdown", prose: true },
      parent: { type: "number", description: "Parent epic or issue number" },
    },
    handler: (root, input) => issueNew(root, input),
  }),
  defineCommand<IssueUpdateInput>({
    name: "graft_issue_update",
    group: "issue",
    subcommand: "update",
    description: "Updates an issue's status, priority, or body, changes its open/closed state, and can add a comment.",
    parameters: {
      id: { type: "number", description: "Issue number to update", required: true, positional: true },
      status: { type: "string", description: "Status label: backlog, in-progress, in-review, blocked, done" },
      priority: { type: "string", description: "Priority label" },
      comment: { type: "string", description: "Comment to post on the issue", prose: true },
      body: { type: "string", description: "Replacement body markdown", prose: true },
      state: { type: "string", description: "New state: open or closed" },
      reason: { type: "string", description: "Close reason: completed or not_planned" },
    },
    handler: (root, input) => issueUpdate(root, input),
  }),
  defineCommand<IssueCloseInput>({
    name: "graft_issue_close",
    group: "issue",
    subcommand: "close",
    description: "Closes an issue with an optional reason and comment.",
    parameters: {
      id: { type: "number", description: "Issue number to close", required: true, positional: true },
      reason: { type: "string", description: "Close reason: completed or not_planned" },
      comment: { type: "string", description: "Closing comment", prose: true },
    },
    handler: (root, input) => issueClose(root, input),
  }),
  defineCommand<IssueReopenInput>({
    name: "graft_issue_reopen",
    group: "issue",
    subcommand: "reopen",
    description: "Reopens a closed issue with an optional comment.",
    parameters: {
      id: { type: "number", description: "Issue number to reopen", required: true, positional: true },
      comment: { type: "string", description: "Reopening comment", prose: true },
    },
    handler: (root, input) => issueReopen(root, input),
  }),
  defineCommand<IssueTreeInput>({
    name: "graft_issue_tree",
    group: "issue",
    subcommand: "tree",
    description: "Returns a hierarchical tree of epics, parent-child links, progress stats, and orphan tasks.",
    parameters: {
      epic: {
        type: "number",
        description: "Parent epic ID to scope the tree to",
        flagAliases: ["--id"],
        positional: true,
      },
      limit: { type: "number", description: "Maximum issues to scan" },
    },
    handler: (root, input) => issueTree(root, input),
  }),
  defineCommand<IssueDoctorInput>({
    name: "graft_issue_doctor",
    group: "issue",
    subcommand: "doctor",
    description: "Audits issues for orphan tasks, missing metadata, and invalid parent-child links.",
    parameters: {
      limit: { type: "number", description: "Maximum issues to scan" },
    },
    handler: (root, input) => issueDoctor(root, input),
  }),

  // ---------------------------------------------------------------------------
  // PULL REQUEST COMMANDS
  // ---------------------------------------------------------------------------
  defineCommand<PrListInput>({
    name: "graft_pr_list",
    group: "pr",
    subcommand: "list",
    description: "Lists pull requests with branch, state, draft status, and CI check summary.",
    parameters: {
      limit: { type: "number", description: "Maximum PRs to return, default 30" },
      state: { type: "string", description: "Filter by state: open, closed, or all" },
    },
    handler: (root, input) => prList(root, input),
  }),
  defineCommand<PrViewInput>({
    name: "graft_pr_view",
    group: "pr",
    subcommand: "view",
    description: "Views a pull request, including mergeability, CI checks rollup, and truncated body.",
    parameters: {
      id: {
        type: "number",
        description: "Pull request number. Omit it and pass task instead to resolve the PR from a task branch.",
        positional: true,
        flagAliases: ["--pr"],
      },
      task: { type: "string", description: "Task ID whose branch's PR should be resolved" },
    },
    handler: (root, input) => prView(root, input),
  }),
  defineCommand<PrChecksInput>({
    name: "graft_pr_checks",
    group: "pr",
    subcommand: "checks",
    description: "Inspects CI check runs and extracts tailored failure summaries without dumping full logs.",
    parameters: {
      id: {
        type: "number",
        description: "Pull request number. Omit it and pass task instead.",
        positional: true,
        flagAliases: ["--pr"],
      },
      task: { type: "string", description: "Task ID whose branch's PR should be resolved" },
      failedOnly: { type: "boolean", description: "Only return failing check runs" },
    },
    handler: (root, input) => prChecks(root, input),
  }),
  defineCommand<PrDiffInput>({
    name: "graft_pr_diff",
    group: "pr",
    subcommand: "diff",
    description: "Returns a token-compact diff summary or diffstat for a pull request.",
    parameters: {
      id: {
        type: "number",
        description: "Pull request number. Omit it and pass task instead.",
        positional: true,
        flagAliases: ["--pr"],
      },
      task: { type: "string", description: "Task ID whose branch's PR should be resolved" },
      stat: { type: "boolean", description: "Only return per-file diffstat line counts" },
    },
    handler: (root, input) => prDiff(root, input),
  }),

  // ---------------------------------------------------------------------------
  // DELEGATE COMMANDS
  // ---------------------------------------------------------------------------
  defineCommand<DelegateRunInput>({
    name: "graft_delegate_run",
    group: "delegate",
    subcommand: "run",
    description: "Runs a headless prompt on the cheaper delegate model, for web searches and broad surveys.",
    parameters: {
      prompt: { type: "string", description: "Instruction prompt", required: true, prose: true },
      effort: { type: "string", description: "Effort level: low, medium, or high" },
      files: { type: "array", description: "Repo files whose content is appended to the prompt", flag: "--file" },
      jsonSchema: {
        type: "object",
        description: "JSON Schema requesting structured output instead of free text",
        json: true,
      },
    },
    handler: (root, input) => delegateRun(root, input),
  }),
  defineCommand<DelegateEditInput>({
    name: "graft_delegate_edit",
    group: "delegate",
    subcommand: "edit",
    description:
      "Delegates sandboxed code editing inside a task worktree, reverting any edit outside the declared scope.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true, flag: "--id" },
      prompt: { type: "string", description: "Editing prompt", required: true, prose: true },
      effort: { type: "string", description: "Effort level: low, medium, or high" },
      scope: {
        type: "array",
        description: "Path prefixes the edit may touch. Anything changed outside them is reverted.",
      },
      context: {
        type: "string",
        description:
          "Extra grounding on top of the automatic .ai/INDEX.md grounding. Usually leave it unset: composing it spends the caller's own tokens.",
        prose: true,
      },
      groundInRepoContext: {
        type: "boolean",
        description:
          "Ground the prompt in .ai/INDEX.md automatically. Default true; disable with --no-ground-in-repo-context for work unrelated to this repo.",
        default: true,
      },
    },
    handler: (root, input) => delegateEdit(root, input),
  }),
  defineCommand<DelegateResearchInput>({
    name: "graft_delegate_research",
    group: "delegate",
    subcommand: "research",
    description: "Delegates a research topic and writes the findings straight to a markdown file in the task worktree.",
    parameters: {
      taskId: { type: "string", description: "Target task ID", required: true, flag: "--id" },
      topic: { type: "string", description: "Research topic", required: true, prose: true },
      outputFile: {
        type: "string",
        description: "Destination markdown path, which must end in .md",
        required: true,
      },
      effort: { type: "string", description: "Effort level: low, medium, or high" },
    },
    handler: (root, input) => delegateResearch(root, input),
  }),

  // ---------------------------------------------------------------------------
  // SYSTEM & GUARD COMMANDS
  // ---------------------------------------------------------------------------
  defineCommand<NoInput>({
    name: "graft_doc_check",
    group: "doc-check",
    description: "Validates instruction-file size budgets: AGENTS.md at most 100 lines, agent adapters at most 30.",
    parameters: {},
    handler: (root) => runDocCheck(root),
  }),
  defineCommand<GuardCheckInput>({
    name: "graft_guard_check",
    group: "guard-check",
    description:
      "Returns the guard's verdict for a prospective Write, Edit, or Bash call, using the exact rules the PreToolUse hook enforces.",
    parameters: {
      agent: { type: "string", description: "Calling agent identifier, e.g. claude, gemini, codex", required: true },
      tool: { type: "string", description: "Tool to check: Write, Edit, or Bash", required: true },
      path: { type: "string", description: "Target file path, for Write or Edit" },
      command: { type: "string", description: "Command line, for Bash", prose: true },
    },
    handler: (root, input) => runGuardCheck(root, input),
  }),
];

const CAMEL_BOUNDARY = /(?<=[a-z0-9])(?=[A-Z])/g;

/** The CLI flag a parameter is read from, derived from its key unless declared. */
export function parameterFlag(key: string, spec: ParameterSpec): string {
  return spec.flag ?? `--${key.replace(CAMEL_BOUNDARY, "-").toLowerCase()}`;
}

/** Every flag spelling a parameter accepts, primary first. */
export function parameterFlags(key: string, spec: ParameterSpec): string[] {
  return [parameterFlag(key, spec), ...(spec.flagAliases ?? [])];
}

/** All routes a command answers on, primary first. */
export function commandRoutes(cmd: AnyCommand): CommandRoute[] {
  return [{ group: cmd.group, subcommand: cmd.subcommand }, ...(cmd.routeAliases ?? [])];
}

/** Renders one route the way it is typed on the command line. */
export function routeLabel(route: CommandRoute): string {
  return route.subcommand ? `${route.group} ${route.subcommand}` : route.group;
}

/** Converts a command into its Model Context Protocol tool schema. */
export function commandToMcpTool(cmd: AnyCommand) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, spec] of Object.entries(cmd.parameters)) {
    properties[key] =
      spec.type === "array"
        ? { type: "array", items: spec.items ?? { type: "string" }, description: spec.description }
        : { type: spec.type, description: spec.description };
    // A parameter carrying a default is satisfiable without the caller, so it
    // is not advertised as required even though the handler's field is not
    // optional.
    if (spec.required && spec.default === undefined) required.push(key);
  }

  return {
    name: cmd.name,
    description: cmd.description,
    inputSchema: {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  };
}

/**
 * The full MCP tool manifest: exactly one tool per registered command.
 *
 * There are deliberately no aliases. A second name for the same command is a
 * duplicate an agent has to choose between, and the heuristic that used to
 * tell `graft_context_pack` apart from `graft_context` guessed at the
 * caller's intent from which fields happened to be set (#260).
 */
export function getAllMcpTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return COMMAND_REGISTRY.map((cmd) => commandToMcpTool(cmd));
}

/** Finds a command by its MCP tool name. */
export function findCommandByMcpName(name: string): AnyCommand | undefined {
  return COMMAND_REGISTRY.find((cmd) => cmd.name === name);
}

/**
 * Finds a command by CLI route, matching a route alias too.
 *
 * A group whose command takes no subcommand matches when `subcommand` is
 * absent. `bin.ts` never passes a flag in here, so an argument that looks
 * like a flag can no longer be mistaken for a subcommand and strand the
 * command -- which is what made `ia-graft context --map` answer with the
 * usage text even though the usage text documents it (#260).
 */
export function findCommandByCliRoute(group: string, subcommand?: string): AnyCommand | undefined {
  return COMMAND_REGISTRY.find((cmd) =>
    commandRoutes(cmd).some(
      (route) => route.group === group && (route.subcommand ?? undefined) === (subcommand || undefined),
    ),
  );
}
