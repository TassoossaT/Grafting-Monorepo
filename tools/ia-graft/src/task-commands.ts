import { GitClient } from "./git-client.ts";

export interface CliError {
  ok: false;
  error: string;
  [key: string]: unknown;
}

const fail = (error: string): CliError => ({ ok: false, error });
const MAX_BATCH_COMMANDS = 12;
const MAX_BATCH_SUMMARY_CHARS = 1_500;

function compactBatchSummary(summary: string): string {
  if (summary.length <= MAX_BATCH_SUMMARY_CHARS) return summary;
  const marker = "\n...[batch result truncated]...\n";
  const side = Math.floor((MAX_BATCH_SUMMARY_CHARS - marker.length) / 2);
  return `${summary.slice(0, side)}${marker}${summary.slice(-side)}`;
}

const TASK_ID_PATTERN = /^[A-Z][A-Z0-9-]{2,63}$/;

export function isValidTaskId(taskId: string): boolean {
  return TASK_ID_PATTERN.test(taskId);
}

export interface TaskNewInput {
  taskId: string;
  base?: string;
  parent?: string;
}

/**
 * Creates an isolated worktree + branch for a task. No status, no JSON record.
 * It prepares workspace-aware dependency overlays when the main checkout has
 * an installation to reuse, and reports the missing-install case explicitly.
 *
 * Sweeps merged-PR worktrees first, silently and best-effort -- nobody
 * calling this needs to know that happens, and a sweep failure (e.g. `gh`
 * unreachable) never blocks creating the task that was actually asked for.
 */
export async function taskNew(repoRoot: string, input: TaskNewInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  const client = new GitClient(repoRoot);
  await client.sweepMergedWorktrees().catch(() => undefined);
  if (input.parent && !isValidTaskId(input.parent)) return fail(`invalid parent task id: ${input.parent}`);
  const { session, resumed, repaired, base, parent, dependencies } = await client.createOrResumeSession(input.taskId, {
    base: input.base,
    parentTaskId: input.parent,
  });
  return {
    ok: true as const,
    worktreePath: session.worktreePath,
    branch: session.branchName,
    nodeModulesLinked: session.nodeModulesLinked,
    resumed,
    repaired,
    base,
    parent,
    dependencyMode: dependencies.mode,
    dependencyOverlays: dependencies.overlays,
    workspaceLinks: dependencies.workspaceLinks,
    dependenciesMaterialized: dependencies.materialized ?? false,
    dependencyLockfileHash: dependencies.lockfileHash,
    dependencyWorkspaceConfigHash: dependencies.workspaceConfigHash,
    dependencyVirtualStore: dependencies.virtualStore,
    dependencyReason: dependencies.reason,
  };
}

export interface TaskCommitInput {
  taskId: string;
  message: string;
  files?: string[];
}

/** Stages (all files, or a given subset) and commits inside the task's worktree. */
export async function taskCommit(repoRoot: string, input: TaskCommitInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  if (!input.message) return fail("message is required");
  const client = new GitClient(repoRoot);
  const session = await client.openSession(input.taskId);
  const unmerged = await session.unmergedPaths();
  const marked = await session.conflictMarkerPaths(unmerged);
  if (marked.length > 0) return { ok: false as const, error: "conflict markers remain in unresolved files", conflicts: marked };
  await session.add(input.files && input.files.length > 0 ? input.files : ".");
  const remaining = await session.unmergedPaths();
  if (remaining.length > 0) return { ok: false as const, error: "unresolved merge conflicts remain", conflicts: remaining };
  await session.commit(input.message);
  return { ok: true as const };
}

export interface TaskTestInput {
  taskId: string;
  command?: string;
  commands?: string[];
  keepGoing?: boolean;
}

/**
 * Runs a test/check command inside the task's worktree and returns a
 * compact pass/fail summary instead of raw output -- spend tokens on the
 * result, not the transcript.
 */
export async function taskTest(repoRoot: string, input: TaskTestInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  if (input.command && input.commands?.length) return fail("command and commands are mutually exclusive");
  const commands = input.commands?.length ? input.commands : input.command ? [input.command] : [];
  if (commands.length === 0) return fail("at least one command is required");
  if (commands.some((command) => typeof command !== "string" || command.trim().length === 0)) return fail("every command must be a non-empty string");
  if (commands.length > MAX_BATCH_COMMANDS) return fail(`a test batch may contain at most ${MAX_BATCH_COMMANDS} commands`);
  const forbidden = commands.find((command) => /\b(?:pnpm|npm|yarn|bun)\s+(?:install|add|remove|update|upgrade|ci)\b/i.test(command));
  if (forbidden) {
    return fail("dependency-mutating commands are forbidden in task worktrees; run installs in the main checkout, then task deps --id <ID>");
  }
  const client = new GitClient(repoRoot);
  const session = await client.openSession(input.taskId);
  const results: Array<{ command: string; passed: boolean; summary: string }> = [];
  for (const command of commands) {
    const result = await session.runTests(command);
    results.push({ command, passed: result.passed, summary: commands.length > 1 ? compactBatchSummary(result.summary) : result.summary });
    if (!result.passed && !input.keepGoing) break;
  }
  if (input.command && !input.commands) return { ok: true as const, passed: results[0]!.passed, summary: results[0]!.summary };
  const passed = results.length === commands.length && results.every((result) => result.passed);
  return {
    ok: true as const,
    passed,
    summary: `${results.filter((result) => result.passed).length}/${commands.length} commands passed`,
    results,
  };
}

export interface TaskDoneInput {
  taskId: string;
  title: string;
  body: string;
  base?: string;
}

/**
 * Pushes the task's branch and opens a pull request. Leaves the worktree in place for
 * review follow-up. If `gh` is unavailable or fails, the push still happens and the
 * result names a manual compare URL instead of failing the whole call.
 */
export async function taskDone(repoRoot: string, input: TaskDoneInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  if (!input.title || !input.body) return fail("title and body are required");
  const client = new GitClient(repoRoot);
  const session = await client.openSession(input.taskId);
  const base = await client.resolveTaskBase(input.taskId, input.base);
  await session.push();
  const pr = await session.createPullRequest(input.title, input.body, base);
  return { ok: true as const, prUrl: pr.url, prState: pr.state, base, note: pr.state === "manual" ? `branch pushed; open the PR manually at prUrl (${pr.reason})` : undefined };
}

export interface TaskCleanupInput {
  taskId: string;
  force?: boolean;
}

/** Removes a merged task's worktree/local branch and prunes its verified, unused remote branch. */
export async function taskCleanup(repoRoot: string, input: TaskCleanupInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  const client = new GitClient(repoRoot);
  const result = await client.cleanupTask(input.taskId, input.force ?? false);
  return { ok: true as const, ...result };
}

export async function taskStatus(repoRoot: string, input: { taskId: string }) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  return { ok: true as const, ...(await new GitClient(repoRoot).taskStatus(input.taskId)) };
}

export async function taskDoctor(repoRoot: string, input: { taskId: string }) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  const diagnosis = await new GitClient(repoRoot).taskStatus(input.taskId);
  const dependenciesReady = diagnosis.dependencyMode === "workspace-aware";
  const healthy = diagnosis.checkoutMode === "worktree" && diagnosis.issues.length === 0
    && !diagnosis.mergeInProgress && dependenciesReady;
  const recommendedAction = diagnosis.mergeInProgress && diagnosis.syncSource ? "resolve conflicts, then task commit; or task sync --abort"
    : diagnosis.mergeInProgress ? "resolve conflicts, then task commit"
    : diagnosis.dependencyMode === "legacy-shared" ? "task deps --id <ID>"
    : diagnosis.dependencyMode === "unmanaged" ? "inspect unmanaged node_modules before task deps"
    : diagnosis.dependencyMode === "none" ? "install dependencies in main, then task deps --id <ID>"
    : healthy ? "none"
    : diagnosis.orphanDirectory ? "task new --id <ID>"
    : diagnosis.checkoutMode === "main" ? "task checkout --restore"
    : "task new --id <ID>";
  return { ok: true as const, healthy, dependenciesReady, ...diagnosis, recommendedAction };
}

export async function taskDependencies(repoRoot: string, input: { taskId: string; install?: boolean }) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  return {
    ok: true as const,
    ...(await new GitClient(repoRoot).prepareTaskDependencies(input.taskId, { install: input.install })),
  };
}

export async function taskSync(repoRoot: string, input: { taskId: string; fetch?: boolean; abort?: boolean }) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  return { ok: true as const, ...(await new GitClient(repoRoot).syncTask(input.taskId, { fetch: input.fetch, abort: input.abort })) };
}

export async function taskResume(repoRoot: string, input: { taskId?: string; pr?: number }) {
  if (input?.pr !== undefined) {
    if (!Number.isInteger(input.pr) || input.pr <= 0) return fail(`invalid PR number: ${input.pr}`);
    const result = await new GitClient(repoRoot).resumeFromPullRequest(input.pr);
    return { ok: true as const, taskId: result.taskId, branch: result.session.branchName, worktreePath: result.session.worktreePath, pr: result.pr, repaired: result.repaired };
  }
  if (!input?.taskId || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  const result = await new GitClient(repoRoot).createOrResumeSession(input.taskId);
  return {
    ok: true as const, taskId: input.taskId, branch: result.session.branchName, worktreePath: result.session.worktreePath,
    resumed: result.resumed, repaired: result.repaired, base: result.base,
    dependencyMode: result.dependencies.mode, dependencyOverlays: result.dependencies.overlays, workspaceLinks: result.dependencies.workspaceLinks,
    dependenciesMaterialized: result.dependencies.materialized ?? false,
    dependencyLockfileHash: result.dependencies.lockfileHash,
    dependencyWorkspaceConfigHash: result.dependencies.workspaceConfigHash,
    dependencyVirtualStore: result.dependencies.virtualStore,
  };
}

export async function taskCheckout(repoRoot: string, input: { taskId?: string; restore?: boolean; force?: boolean }) {
  const client = new GitClient(repoRoot);
  if (input?.restore) return { ok: true as const, ...(await client.restoreCheckout(input.force ?? false)) };
  if (!input?.taskId || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  return { ok: true as const, taskId: input.taskId, ...(await client.checkoutTask(input.taskId)) };
}

export async function taskGraph(repoRoot: string) {
  const client = new GitClient(repoRoot);
  const defaultBranch = await client.resolveDefaultBranch();
  return { ok: true as const, defaultBranch, tasks: await client.taskGraph() };
}

/**
 * Sweeps every worktree under `.worktrees/`, cleans up (worktree + local
 * branch) the ones whose PR is already merged, and leaves everything else
 * untouched. Worktrees stop accumulating without anyone having to remember
 * to run `task cleanup` by hand after every merge.
 */
export async function taskSweep(repoRoot: string) {
  const client = new GitClient(repoRoot);
  const { cleaned, skipped, remoteBranches } = await client.sweepMergedWorktrees();
  return { ok: true as const, cleaned, skipped, remoteBranches };
}
