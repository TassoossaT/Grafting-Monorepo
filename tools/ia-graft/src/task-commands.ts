import { GitClient } from "./git-client.ts";

export interface CliError {
  ok: false;
  error: string;
  [key: string]: unknown;
}

const fail = (error: string): CliError => ({ ok: false, error });

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
 * Only returns once the worktree has a linked `node_modules` (or the main
 * checkout genuinely has none to give it) -- a worktree without one silently
 * breaks tsc/most tests, so this is not best-effort.
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
  const { session, resumed, repaired, base, parent } = await client.createOrResumeSession(input.taskId, {
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
  await session.add(input.files && input.files.length > 0 ? input.files : ".");
  await session.commit(input.message);
  return { ok: true as const };
}

export interface TaskTestInput {
  taskId: string;
  command: string;
}

/**
 * Runs a test/check command inside the task's worktree and returns a
 * compact pass/fail summary instead of raw output -- spend tokens on the
 * result, not the transcript.
 */
export async function taskTest(repoRoot: string, input: TaskTestInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  if (!input.command) return fail("command is required");
  if (/\b(?:pnpm|npm|yarn|bun)\s+(?:install|add|remove|update|upgrade|ci)\b/i.test(input.command)) {
    return fail("dependency-mutating commands are forbidden in task worktrees because node_modules is shared; run installs in the main checkout");
  }
  const client = new GitClient(repoRoot);
  const session = await client.openSession(input.taskId);
  const { passed, summary } = await session.runTests(input.command);
  return { ok: true as const, passed, summary };
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

/** Removes a task's worktree after its pull request has merged. The remote branch is left intact. */
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
  const healthy = diagnosis.checkoutMode === "worktree" && diagnosis.issues.length === 0;
  const recommendedAction = healthy ? "none"
    : diagnosis.orphanDirectory ? "task new --id <ID>"
    : diagnosis.checkoutMode === "main" ? "task checkout --restore"
    : "task new --id <ID>";
  return { ok: true as const, healthy, ...diagnosis, recommendedAction };
}

export async function taskResume(repoRoot: string, input: { taskId?: string; pr?: number }) {
  if (input?.pr !== undefined) {
    if (!Number.isInteger(input.pr) || input.pr <= 0) return fail(`invalid PR number: ${input.pr}`);
    const result = await new GitClient(repoRoot).resumeFromPullRequest(input.pr);
    return { ok: true as const, taskId: result.taskId, branch: result.session.branchName, worktreePath: result.session.worktreePath, pr: result.pr, repaired: result.repaired };
  }
  if (!input?.taskId || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  const result = await new GitClient(repoRoot).createOrResumeSession(input.taskId);
  return { ok: true as const, taskId: input.taskId, branch: result.session.branchName, worktreePath: result.session.worktreePath, resumed: result.resumed, repaired: result.repaired, base: result.base };
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
  const { cleaned, skipped } = await client.sweepMergedWorktrees();
  return { ok: true as const, cleaned, skipped };
}
