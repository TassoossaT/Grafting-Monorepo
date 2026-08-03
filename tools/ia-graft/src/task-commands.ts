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
}

/** Creates an isolated worktree + branch for a task. No status, no JSON record. */
export async function taskNew(repoRoot: string, input: TaskNewInput) {
  if (!isValidTaskId(input.taskId)) return fail(`invalid task id: ${input.taskId}`);
  const client = new GitClient(repoRoot);
  const session = await client.createSession(input.taskId, input.base ?? "main");
  return { ok: true as const, worktreePath: session.worktreePath, branch: session.branchName };
}

export interface TaskCommitInput {
  taskId: string;
  message: string;
  files?: string[];
}

/** Stages (all files, or a given subset) and commits inside the task's worktree. */
export async function taskCommit(repoRoot: string, input: TaskCommitInput) {
  if (!isValidTaskId(input.taskId)) return fail(`invalid task id: ${input.taskId}`);
  if (!input.message) return fail("message is required");
  const client = new GitClient(repoRoot);
  const session = client.openSession(input.taskId);
  await session.add(input.files && input.files.length > 0 ? input.files : ".");
  await session.commit(input.message);
  return { ok: true as const };
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
  if (!isValidTaskId(input.taskId)) return fail(`invalid task id: ${input.taskId}`);
  if (!input.title || !input.body) return fail("title and body are required");
  const client = new GitClient(repoRoot);
  const session = client.openSession(input.taskId);
  await session.push();
  const { url, opened } = await session.createPullRequest(input.title, input.body, input.base ?? "main");
  return opened
    ? { ok: true as const, prUrl: url, opened }
    : { ok: true as const, prUrl: url, opened, note: "gh could not open the PR automatically; branch is pushed, open the PR manually at prUrl" };
}

export interface TaskCleanupInput {
  taskId: string;
}

/** Removes a task's worktree after its pull request has merged. The remote branch is left intact. */
export async function taskCleanup(repoRoot: string, input: TaskCleanupInput) {
  if (!isValidTaskId(input.taskId)) return fail(`invalid task id: ${input.taskId}`);
  const client = new GitClient(repoRoot);
  const session = client.openSession(input.taskId);
  await session.cleanup();
  return { ok: true as const };
}
