import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DELEGATE_PROFILES, EFFORTS, type Effort } from "./delegate-profiles.ts";
import { GitClient } from "./git-client.ts";
import { isValidTaskId, type CliError } from "./task-commands.ts";

const execFileAsync = promisify(execFile);
type ExecFile = typeof execFileAsync;

const fail = (error: string): CliError => ({ ok: false, error });

export interface DelegateEditInput {
  taskId: string;
  prompt: string;
  effort?: Effort;
  /** Path prefixes the edit is allowed to touch (e.g. ["docs/"]). Any changed file outside this is reverted, not silently kept. */
  scope?: string[];
}

function inScope(path: string, scope?: string[]): boolean {
  if (!scope || scope.length === 0) return true;
  return scope.some((prefix) => path === prefix || path.startsWith(prefix));
}

interface PorcelainEntry {
  status: string;
  path: string;
}

/** `git status --porcelain` lines are `XY path` or `XY old -> new` for renames. */
function parsePorcelain(porcelain: string): PorcelainEntry[] {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.length > 3)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3).split(" -> ").pop()!.trim() }));
}

/**
 * Captures the working tree's pre-call state so an out-of-scope revert can
 * restore to it, not to HEAD. Restoring straight to HEAD is wrong whenever
 * the caller had its own uncommitted work in a tracked file the delegated
 * edit also happened to touch -- `git checkout HEAD -- <path>` would erase
 * that uncommitted work along with the delegated one, which is exactly the
 * failure this snapshot exists to prevent. `git stash create` builds a
 * commit object of the current index+worktree diff without touching the
 * worktree itself; an empty result means the tree was already clean, so
 * HEAD is an accurate baseline for tracked files in that case.
 */
async function snapshotWorktree(worktreePath: string): Promise<{ before: Map<string, string>; baseline: string }> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: worktreePath });
  const before = new Map(parsePorcelain(stdout).map((entry) => [entry.path, entry.status]));
  const { stdout: stashOut } = await execFileAsync("git", ["stash", "create"], { cwd: worktreePath });
  return { before, baseline: stashOut.trim() || "HEAD" };
}

/**
 * Gives a delegated model real write access, but only inside an
 * already-isolated `ia-graft` task worktree -- never the main checkout --
 * and never auto-commits. The caller reviews `changedFiles` and still runs
 * the normal `task test`/`task commit`/`task done` flow, same as any other
 * edit. `scope`, when given, is enforced after the fact against a pre-call
 * snapshot: any changed file outside it is restored to what it looked like
 * right before this call (not silently kept, and not blindly reset to
 * HEAD -- see `snapshotWorktree`).
 *
 * Known limitation: a file that was ALREADY untracked before this call
 * (not created by it) is left alone if it ends up out of scope, but its
 * content is not protected if the delegated edit modifies it in place --
 * `git stash create` does not snapshot untracked files. Avoid leaving
 * untracked scratch content lying around in a worktree before running this.
 */
export async function delegateEdit(repoRoot: string, input: DelegateEditInput, { exec = execFileAsync }: { exec?: ExecFile } = {}) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  if (!input.prompt?.trim()) return fail("prompt is required");
  const effort = input.effort ?? "medium";
  const profile = DELEGATE_PROFILES[effort];
  if (!profile) return fail(`invalid effort: ${effort} (expected one of: ${EFFORTS.join(", ")})`);

  let worktreePath: string;
  try {
    const session = await new GitClient(repoRoot).openSession(input.taskId);
    worktreePath = session.worktreePath;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  const { before, baseline } = await snapshotWorktree(worktreePath);

  let response: { status?: string; response?: string };
  try {
    const { stdout } = await exec(profile.cli, profile.buildEditArgs(input.prompt), { cwd: worktreePath });
    response = JSON.parse(stdout);
  } catch (error) {
    return fail(`delegate edit failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const { stdout: porcelain } = await execFileAsync("git", ["status", "--porcelain"], { cwd: worktreePath });
  const entries = parsePorcelain(porcelain);

  const revertedOutOfScope: string[] = [];
  for (const entry of entries) {
    if (inScope(entry.path, input.scope)) continue;
    if (entry.status === "??") {
      if (before.has(entry.path)) continue; // pre-existing untracked file: not this call's to manage or delete
      await execFileAsync("git", ["clean", "-f", "--", entry.path], { cwd: worktreePath }).catch(() => undefined);
    } else {
      await execFileAsync("git", ["checkout", baseline, "--", entry.path], { cwd: worktreePath }).catch(() => undefined);
    }
    revertedOutOfScope.push(entry.path);
  }
  const changedFiles = entries.map((entry) => entry.path).filter((path) => !revertedOutOfScope.includes(path));

  return {
    ok: true as const,
    taskId: input.taskId,
    worktreePath,
    effort,
    model: profile.label,
    agentStatus: response.status,
    summary: (response.response ?? "").trim(),
    changedFiles,
    revertedOutOfScope,
  };
}
