import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

export function worktreePathForTask(repoPath: string, taskId: string): string {
    return path.join(repoPath, '.worktrees', taskId);
}

export function branchNameForTask(taskId: string): string {
    return `task/${taskId}`;
}

const execFileAsync = promisify(execFile);

/**
 * A long-lived process's inherited PATH predates any install that happened
 * after it started -- e.g. `gh` installed via winget mid-session. Appending
 * its well-known default install directory as a fallback means a fresh
 * install works immediately, without needing to restart the process that's
 * calling this CLI, while still preferring whatever PATH already resolves.
 */
function envWithGhFallbackPath(): NodeJS.ProcessEnv {
    if (process.platform !== 'win32') return process.env;
    const fallbackDir = 'C:\\Program Files\\GitHub CLI';
    const currentPath = process.env.PATH ?? process.env.Path ?? '';
    if (currentPath.includes(fallbackDir)) return process.env;
    return { ...process.env, PATH: `${currentPath};${fallbackDir}` };
}

/**
 * Finds every `node_modules` directory under `dir`, at any depth, without
 * descending into one once found -- pnpm nests its content-addressable
 * store (`node_modules/.pnpm/...`) inside each `node_modules` it creates, so
 * recursing further would only re-discover the same install's own internals,
 * not another package's independent dependency tree. Skips `.git` and
 * `.worktrees` (never contains source packages, and `.worktrees` holds other
 * tasks' own checkouts, not this repo's own package tree).
 */
async function findNodeModulesDirs(dir: string, relBase = ''): Promise<string[]> {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    const results: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === '.git' || entry.name === '.worktrees') continue;
        const rel = relBase ? path.join(relBase, entry.name) : entry.name;
        if (entry.name === 'node_modules') {
            results.push(rel);
            continue;
        }
        results.push(...(await findNodeModulesDirs(path.join(dir, entry.name), rel)));
    }
    return results;
}

/**
 * Links every `node_modules` directory in the main checkout into a fresh
 * task worktree, at the same relative path. `git worktree add` only brings
 * tracked files -- `node_modules` is gitignored, so every new worktree
 * starts with none, breaking anything that needs a real dependency tree
 * (tsc, most tests). A single root-level link is not enough in a pnpm
 * workspace: pnpm gives each package its own local `node_modules` (symlinks
 * into the shared root `.pnpm` store), so `tools/ia-graft/node_modules`,
 * `apps/*\/node_modules`, etc. each need their own link too -- Node's
 * parent-directory module-resolution walk cannot substitute for a
 * package-local dependency that pnpm never hoists to the workspace root.
 * Returns `{ linked: false }` (not an error) when the main checkout itself
 * has no root `node_modules` yet -- nothing to link, and that is the main
 * checkout's own problem to fix (`pnpm install`), not this worktree's.
 */
async function linkSharedNodeModules(repoPath: string, worktreePath: string): Promise<{ linked: boolean; reason?: string }> {
    const rootNodeModules = path.join(repoPath, 'node_modules');
    try {
        await fs.access(rootNodeModules);
    } catch {
        return { linked: false, reason: 'main checkout has no node_modules; run pnpm install there first' };
    }
    const relativeDirs = await findNodeModulesDirs(repoPath);
    for (const rel of relativeDirs) {
        const target = path.join(worktreePath, rel);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.symlink(path.join(repoPath, rel), target, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return { linked: true };
}

/**
 * Retries a recursive removal a few times with backoff before giving up.
 * Windows can hold a directory handle open briefly after a process that ran
 * inside it (tsc, a test runner) exits, surfacing as a transient EBUSY/EPERM
 * on the very next `fs.rm` rather than a real, permanent failure.
 */
async function removeWithRetry(target: string, attempts = 5, delayMs = 300): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await fs.rm(target, { recursive: true, force: true });
            return;
        } catch (error) {
            const code = (error as { code?: string }).code;
            if (attempt === attempts || (code !== 'EBUSY' && code !== 'EPERM')) throw error;
            await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        }
    }
}

const TAP_SUMMARY_LINE = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/;
const TAP_FAILURE_LINE = /^not ok\b/;

/**
 * Reduces test-runner output to what actually matters: for node:test's TAP
 * output, the failing test lines plus the summary counters; for anything
 * else (no recognizable TAP summary present), the last 40 lines, on the
 * assumption the interesting part -- especially a failure -- is at the end.
 */
function summarizeTestOutput(output: string): string {
    const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
    const summary = lines.filter((line) => TAP_SUMMARY_LINE.test(line));
    if (summary.length > 0) {
        const failures = lines.filter((line) => TAP_FAILURE_LINE.test(line));
        return [...failures, ...summary].join('\n');
    }
    return lines.slice(-40).join('\n');
}

/**
 * Executes a Git command safely without shell interpretation to prevent injection.
 * @param args The command arguments.
 * @param cwd The working directory.
 * @returns A promise that resolves with the stdout.
 * @throws An error if the command fails.
 */
async function executeGit(args: string[], cwd: string): Promise<string> {
    try {
        const { stdout, stderr } = await execFileAsync('git', args, { cwd });
        return stdout.trim();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`git ${args[0]} failed: ${detail}`);
    }
}

/**
 * Represents an isolated Git worktree session for a single task.
 * This ensures that concurrent operations do not conflict with each other.
 */
export class GitWorktreeSession {
    public readonly repoPath: string;
    public readonly worktreePath: string;
    public readonly branchName: string;
    public readonly nodeModulesLinked: boolean;

    private constructor(repoPath: string, worktreePath: string, branchName: string, nodeModulesLinked: boolean) {
        this.repoPath = repoPath;
        this.worktreePath = worktreePath;
        this.branchName = branchName;
        this.nodeModulesLinked = nodeModulesLinked;
    }

    /**
     * Stages a file or files for the next commit.
     * @param filePaths A single file path or an array of file paths.
     */
    async add(filePaths: string | string[]): Promise<void> {
        const files = Array.isArray(filePaths) ? filePaths : [filePaths];
        await executeGit(['add', ...files], this.worktreePath);
    }

    /**
     * Commits the staged changes to the worktree's branch.
     * @param message The commit message.
     */
    async commit(message: string): Promise<void> {
        // The -m flag can be tricky with special characters. Using a temporary file is safer.
        const tempMsgFile = path.join(this.worktreePath, `.git_commit_msg_${randomBytes(8).toString('hex')}`);
        await fs.writeFile(tempMsgFile, message);
        try {
            await executeGit(['commit', '-F', tempMsgFile], this.worktreePath);
        } finally {
            await fs.unlink(tempMsgFile);
        }
    }

    /**
     * Pushes the current branch to the remote repository.
     */
    async push(): Promise<void> {
        await executeGit(['push', 'origin', this.branchName], this.worktreePath);
    }

    /**
     * Fetches the latest changes from the remote.
     */
    async fetch(): Promise<void> {
        await executeGit(['fetch'], this.worktreePath);
    }

    /**
     * Opens a pull request for this session's branch against baseBranch, via the `gh` CLI.
     * Calling `task done` again on a branch that already has an open PR (e.g. pushing
     * follow-up commits) is expected, not an error -- `gh pr create` itself fails with
     * "already exists" in that case, so this looks up and returns the existing PR's own
     * URL instead of falling back to a misleading "couldn't open one" compare URL.
     * Falls back to a manual compare-URL only when `gh` is genuinely missing/unauthenticated,
     * so a caller without `gh` set up still gets a usable next step rather than a stack trace.
     * @param title The PR title.
     * @param body The PR body/description.
     * @param baseBranch The branch to open the PR against.
     * @returns The PR URL (or manual compare URL) and whether it was actually opened.
     */
    async createPullRequest(title: string, body: string, baseBranch: string): Promise<{ url: string; state: 'created' | 'existing' | 'manual' }> {
        try {
            const { stdout } = await execFileAsync(
                'gh',
                ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch, '--head', this.branchName],
                { cwd: this.worktreePath, env: envWithGhFallbackPath() },
            );
            return { url: stdout.trim(), state: 'created' };
        } catch {
            const existing = await this.existingPullRequestUrl();
            if (existing) return { url: existing, state: 'existing' };
            return { url: await this.compareUrl(baseBranch), state: 'manual' };
        }
    }

    /**
     * Looks up this session's branch's own already-open PR, if one exists --
     * used when `gh pr create` fails because there already is one (a normal
     * outcome of pushing follow-up commits to an in-review task), not because
     * `gh` is unavailable. Returns `null` for any other reason (no such PR,
     * `gh` unreachable), which the caller treats the same as "couldn't open one."
     */
    private async existingPullRequestUrl(): Promise<string | null> {
        try {
            const { stdout } = await execFileAsync(
                'gh',
                ['pr', 'view', this.branchName, '--json', 'url'],
                { cwd: this.worktreePath, env: envWithGhFallbackPath() },
            );
            const { url } = JSON.parse(stdout) as { url?: string };
            return url ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Builds the manual "open a pull request" URL for this session's branch,
     * from the repo's own `origin` remote -- used when `gh` cannot open one automatically.
     */
    private async compareUrl(baseBranch: string): Promise<string> {
        const remote = await executeGit(['remote', 'get-url', 'origin'], this.worktreePath);
        const httpsBase = remote
            .replace(/^git@([^:]+):/, 'https://$1/')
            .replace(/\.git$/, '');
        return `${httpsBase}/compare/${baseBranch}...${this.branchName}?expand=1`;
    }

    /**
     * Runs a test/check command inside the worktree and returns a compact
     * summary instead of raw output -- spending tokens only on pass/fail
     * evidence, not the full verbose stream. Recognizes node:test's TAP
     * summary lines and `not ok` failures; falls back to the last 40 lines
     * of output for any other runner.
     * @param command The full shell command to run (e.g. a `node --test ...`
     * or `pnpm test` invocation).
     */
    async runTests(command: string): Promise<{ passed: boolean; summary: string }> {
        const isWin = process.platform === 'win32';
        const invocation = isWin
            ? execFileAsync('cmd.exe', ['/d', '/s', '/c', command], { cwd: this.worktreePath })
            : execFileAsync('/bin/sh', ['-c', command], { cwd: this.worktreePath });
        try {
            const { stdout, stderr } = await invocation;
            return { passed: true, summary: summarizeTestOutput(`${stdout}\n${stderr}`) };
        } catch (error) {
            const execError = error as { stdout?: string; stderr?: string; message: string };
            const output = `${execError.stdout ?? ''}\n${execError.stderr ?? execError.message}`;
            return { passed: false, summary: summarizeTestOutput(output) };
        }
    }

    /**
     * Cleans up the worktree by removing the directory and pruning the git metadata.
     */
    async cleanup(): Promise<void> {
        // First, remove the worktree directory itself. A process that recently ran inside it
        // (tsc, a test runner) can leave Windows holding a directory handle open for a moment
        // after exit, surfacing as a transient EBUSY here -- retry with backoff before giving up.
        await removeWithRetry(this.worktreePath);

        // Then, tell git to prune the worktree metadata using the original repoPath
        await executeGit(['worktree', 'prune'], this.repoPath);

        // Deleting the remote branch is a separate, conscious decision -- not done here.
    }

    /**
     * Creates a new worktree session for a task, at a deterministic path/branch
     * derived from taskId so a later CLI invocation can find it again without
     * any persisted state.
     * @param repoPath The absolute path to the main repository.
     * @param baseBranch The branch to base the new worktree on.
     * @param taskId The task identifier the worktree and branch are derived from.
     * @returns A new GitWorktreeSession instance.
     */
    static async create(repoPath: string, baseBranch: string, taskId: string): Promise<GitWorktreeSession> {
        const worktreePath = worktreePathForTask(repoPath, taskId);
        const branchName = branchNameForTask(taskId);

        // Ensure the .worktrees directory exists
        await fs.mkdir(path.dirname(worktreePath), { recursive: true });

        // Ensure the base branch is up to date
        await executeGit(['fetch', 'origin', baseBranch], repoPath);

        // Create the worktree and the new branch in a single command linked to the remote base
        await executeGit(['worktree', 'add', '-b', branchName, worktreePath, `origin/${baseBranch}`], repoPath);

        // Required, not best-effort: the caller only sees this session as created once the
        // worktree actually has a usable dependency tree (or the main checkout has none to give it).
        const { linked, reason } = await linkSharedNodeModules(repoPath, worktreePath);
        if (!linked && reason !== 'main checkout has no node_modules; run pnpm install there first') {
            throw new Error(`worktree created but failed to link node_modules: ${reason}`);
        }
        return new GitWorktreeSession(repoPath, worktreePath, branchName, linked);
    }

    /**
     * Reopens the session for an already-existing task worktree, without
     * running any git command -- used by `task done`/`task cleanup`, which
     * are separate CLI invocations from the `task new` that created it.
     * @param repoPath The absolute path to the main repository.
     * @param taskId The task identifier the worktree and branch are derived from.
     */
    static open(repoPath: string, taskId: string): GitWorktreeSession {
        return new GitWorktreeSession(repoPath, worktreePathForTask(repoPath, taskId), branchNameForTask(taskId), true);
    }
}

/**
 * A client for managing Git repositories with support for concurrent, isolated operations
 * using Git worktrees.
 */
export class GitClient {
    /**
     * @param repoPath The absolute path to the root of the Git repository.
     */
    private readonly repoPath: string;

    constructor(repoPath: string) {
        if (!path.isAbsolute(repoPath)) {
            throw new Error("The repository path must be absolute.");
        }
        this.repoPath = repoPath;
    }

    /**
     * Creates a new isolated session to work on a task. This session is
     * backed by a new Git worktree and a new branch, both derived from taskId.
     *
     * @param taskId The task identifier the worktree and branch are derived from.
     * @param baseBranch The branch to fork from (e.g., 'main' or 'develop'). Defaults to 'main'.
     * @returns A promise that resolves to a new GitWorktreeSession.
     */
    async createSession(taskId: string, baseBranch: string = 'main'): Promise<GitWorktreeSession> {
        return GitWorktreeSession.create(this.repoPath, baseBranch, taskId);
    }
    async createOrResumeSession(taskId: string, baseBranch: string = 'main'): Promise<{ session: GitWorktreeSession; resumed: boolean }> {
        const worktree = worktreePathForTask(this.repoPath, taskId);
        try {
            await fs.access(worktree);
            const branch = await executeGit(['branch', '--show-current'], worktree);
            if (branch !== branchNameForTask(taskId)) throw new Error(`task path belongs to unexpected branch ${branch}`);
            return { session: GitWorktreeSession.open(this.repoPath, taskId), resumed: true };
        } catch (error) {
            if (error instanceof Error && error.message.includes('unexpected branch')) throw error;
            return { session: await this.createSession(taskId, baseBranch), resumed: false };
        }
    }

    async taskStatus(taskId: string): Promise<{ taskId: string; exists: boolean; branch: string; dirty?: boolean; head?: string }> {
        const worktree = worktreePathForTask(this.repoPath, taskId);
        try { await fs.access(worktree); } catch { return { taskId, exists: false, branch: branchNameForTask(taskId) }; }
        const branch = await executeGit(['branch', '--show-current'], worktree);
        if (branch !== branchNameForTask(taskId)) throw new Error(`task path belongs to unexpected branch ${branch}`);
        const dirty = (await executeGit(['status', '--porcelain'], worktree)).length > 0;
        const head = await executeGit(['rev-parse', '--short', 'HEAD'], worktree);
        return { taskId, exists: true, branch, dirty, head };
    }

    async cleanupTask(taskId: string, force: boolean): Promise<void> {
        const status = await this.taskStatus(taskId);
        if (!status.exists) return;
        if (status.dirty && !force) throw new Error('refusing cleanup: task worktree has uncommitted changes (use --force only to abandon them)');
        const merge = await this.branchMergeStatus(status.branch);
        if (!merge.merged && !force) throw new Error(`refusing cleanup: ${merge.reason}`);
        await GitWorktreeSession.open(this.repoPath, taskId).cleanup();
        await executeGit(['branch', '-D', status.branch], this.repoPath).catch(() => undefined);
    }

    /**
     * Reopens the session for an already-existing task worktree created by a
     * prior `createSession` call (in a separate CLI invocation).
     * @param taskId The task identifier the worktree and branch are derived from.
     */
    openSession(taskId: string): GitWorktreeSession {
        return GitWorktreeSession.open(this.repoPath, taskId);
    }

    /**
     * Finds every task worktree under `.worktrees/`, checks each one's PR
     * merge status, and cleans up (worktree + local branch) the ones that
     * are already merged -- so worktrees stop accumulating and nobody has
     * to remember to run `task cleanup` by hand after every merge.
     * Anything not merged, or whose merge status can't be determined, is
     * left untouched and reported as skipped rather than guessed at.
     */
    async sweepMergedWorktrees(): Promise<{
        cleaned: string[];
        skipped: Array<{ id: string; reason: string }>;
    }> {
        const worktreesDir = path.join(this.repoPath, '.worktrees');
        let entries;
        try {
            entries = await fs.readdir(worktreesDir, { withFileTypes: true });
        } catch {
            return { cleaned: [], skipped: [] };
        }

        const cleaned: string[] = [];
        const skipped: Array<{ id: string; reason: string }> = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const id = entry.name;
            const branch = branchNameForTask(id);
            const status = await this.branchMergeStatus(branch);
            if (!status.merged) {
                skipped.push({ id, reason: status.reason });
                continue;
            }
            await this.cleanupTask(id, false);
            cleaned.push(id);
        }
        return { cleaned, skipped };
    }

    /**
     * Asks GitHub directly (`gh pr list --head <branch> --state merged`) --
     * the only source that's actually correct for a squash/rebase merge,
     * where the branch tip is never a literal ancestor of the base branch
     * locally. Deliberately has no local-ancestry fallback: a freshly
     * created task branch with no commits yet is trivially "an ancestor" of
     * any later commit on the base branch it forked from too, so that
     * heuristic cannot tell "merged" apart from "never touched" and would
     * risk deleting a worktree that was never actually merged. Without a
     * working `gh`, merge status is undetermined -- skip, don't guess.
     */
    private async branchMergeStatus(branch: string): Promise<{ merged: boolean; reason: string }> {
        try {
            const { stdout } = await execFileAsync(
                'gh',
                ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number'],
                { cwd: this.repoPath, env: envWithGhFallbackPath() },
            );
            const merged = JSON.parse(stdout);
            return Array.isArray(merged) && merged.length > 0
                ? { merged: true, reason: `merged via PR #${merged[0].number}` }
                : { merged: false, reason: 'no merged PR found for this branch' };
        } catch {
            return { merged: false, reason: 'could not reach gh to check merge status' };
        }
    }
}