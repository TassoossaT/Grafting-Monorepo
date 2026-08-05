import { exec, execFile } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { promisify } from 'util';

export function worktreePathForTask(repoPath: string, taskId: string): string {
    return path.join(repoPath, '.worktrees', taskId);
}

export function branchNameForTask(taskId: string): string {
    return `task/${taskId}`;
}

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * A long-lived process's inherited PATH predates any install that happened
 * after it started -- e.g. `gh` installed via winget mid-session. Appending
 * its well-known default install directory as a fallback means a fresh
 * install works immediately, without needing to restart the process that's
 * calling this CLI, while still preferring whatever PATH already resolves.
 */
function envWithGhFallbackPath(): NodeJS.ProcessEnv {
    const fallbackDir = 'C:\\Program Files\\GitHub CLI';
    const currentPath = process.env.PATH ?? process.env.Path ?? '';
    if (currentPath.includes(fallbackDir)) return process.env;
    return { ...process.env, PATH: `${currentPath}${path.delimiter}${fallbackDir}` };
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
        // Node treats the type as advisory on POSIX; junction avoids elevated
        // symlink privileges on Windows without an application-owned OS branch.
        await fs.symlink(path.join(repoPath, rel), target, 'junction');
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

function samePath(left: string, right: string): boolean {
    return path.relative(path.resolve(left), path.resolve(right)) === '';
}

function assertSafeTaskPath(repoPath: string, target: string): void {
    const root = path.resolve(repoPath, '.worktrees');
    const resolved = path.resolve(target);
    if (samePath(resolved, repoPath) || samePath(resolved, root) || !samePath(path.dirname(resolved), root)) {
        throw new Error(`refusing filesystem mutation outside one deterministic task path: ${resolved}`);
    }
}

async function pathExists(target: string): Promise<boolean> {
    try { await fs.lstat(target); return true; }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

/** Removes only ia-graft-created node_modules links; it never traverses them. */
async function unlinkSharedNodeModules(dir: string): Promise<string[]> {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return []; }
    const removed: string[] = [];
    for (const entry of entries) {
        const target = path.join(dir, entry.name);
        if (entry.name === 'node_modules') {
            const stat = await fs.lstat(target);
            if (stat.isSymbolicLink()) {
                await fs.unlink(target);
                removed.push(target);
            }
            // A real directory stays inside the already validated task root and
            // is removed with that root; only link-specific removal requires proof.
            continue;
        }
        if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== '.git' && entry.name !== '.worktrees') {
            removed.push(...await unlinkSharedNodeModules(target));
        }
    }
    return removed;
}

async function windowsMirrorEmpty(target: string): Promise<void> {
    const empty = await fs.mkdtemp(path.join(tmpdir(), 'ia-graft-empty-'));
    try {
        try {
            await execFileAsync('robocopy', [empty, target, '/MIR', '/XJ', '/SL', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']);
        } catch (error) {
            const code = Number((error as { code?: string | number }).code);
            if (!Number.isInteger(code) || code < 0 || code > 7) throw error;
        }
    } finally {
        await fs.rm(empty, { recursive: true, force: true });
    }
}

async function safeRemoveTaskDirectory(repoPath: string, target: string): Promise<void> {
    assertSafeTaskPath(repoPath, target);
    if (!await pathExists(target)) return;
    if ((await fs.lstat(target)).isSymbolicLink()) {
        throw new Error(`refusing cleanup: task root itself is a symlink or junction: ${target}`);
    }
    await unlinkSharedNodeModules(target);
    try { await removeWithRetry(target); }
    catch (firstError) {
        try { await windowsMirrorEmpty(target); }
        catch (fallbackError) {
            if ((fallbackError as NodeJS.ErrnoException).code === 'ENOENT') throw firstError;
            throw fallbackError;
        }
        await removeWithRetry(target);
    }
}

interface WorktreeRecord { path: string; branch?: string; head?: string }

function parseWorktrees(output: string): WorktreeRecord[] {
    const records: WorktreeRecord[] = [];
    let current: WorktreeRecord | undefined;
    for (const field of output.split('\0')) {
        if (!field) { if (current) records.push(current); current = undefined; continue; }
        const separator = field.indexOf(' ');
        const key = separator === -1 ? field : field.slice(0, separator);
        const value = separator === -1 ? '' : field.slice(separator + 1);
        if (key === 'worktree') { if (current) records.push(current); current = { path: value }; }
        else if (current && key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
        else if (current && key === 'HEAD') current.head = value;
    }
    if (current) records.push(current);
    return records;
}

function commandError(error: unknown): string {
    const value = error as { stderr?: string; stdout?: string; message?: string; code?: string };
    return value.stderr?.trim() || value.stdout?.trim() || value.message || (value.code === 'ENOENT' ? 'command not found' : String(error));
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
        await executeGit(['push', '--set-upstream', 'origin', this.branchName], this.worktreePath);
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
    async createPullRequest(title: string, body: string, baseBranch: string): Promise<{ url: string; state: 'created' | 'existing' | 'manual'; reason?: string }> {
        const existing = await this.existingPullRequest();
        if (existing) {
            if (existing.baseRefName !== baseBranch) {
                throw new Error(`existing PR #${existing.number} targets ${existing.baseRefName}, but task base is ${baseBranch}`);
            }
            return { url: existing.url, state: 'existing' };
        }
        try {
            await execFileAsync('gh', ['auth', 'status'], { cwd: this.worktreePath, env: envWithGhFallbackPath() });
        } catch (error) {
            const reason = `gh unavailable or unauthenticated: ${commandError(error)}`;
            return { url: await this.compareUrl(baseBranch), state: 'manual', reason };
        }
        try {
            const { stdout } = await execFileAsync('gh', [
                'pr', 'create', '--title', title, '--body', body,
                '--base', baseBranch, '--head', this.branchName,
            ], { cwd: this.worktreePath, env: envWithGhFallbackPath() });
            return { url: stdout.trim(), state: 'created' };
        } catch (error) {
            throw new Error(`gh pr create failed for base ${baseBranch}: ${commandError(error)}`);
        }
    }

    /**
     * Looks up this session's branch's own already-open PR, if one exists --
     * used when `gh pr create` fails because there already is one (a normal
     * outcome of pushing follow-up commits to an in-review task), not because
     * `gh` is unavailable. Returns `null` for any other reason (no such PR,
     * `gh` unreachable), which the caller treats the same as "couldn't open one."
     */
    private async existingPullRequest(): Promise<{ number: number; url: string; baseRefName: string } | null> {
        try {
            const { stdout } = await execFileAsync(
                'gh',
                ['pr', 'view', this.branchName, '--json', 'number,url,baseRefName'],
                { cwd: this.worktreePath, env: envWithGhFallbackPath() },
            );
            const result = JSON.parse(stdout) as { number?: number; url?: string; baseRefName?: string };
            return result.number && result.url && result.baseRefName
                ? { number: result.number, url: result.url, baseRefName: result.baseRefName }
                : null;
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
        // Node selects the host shell; ia-graft does not inspect the platform.
        const invocation = execAsync(command, { cwd: this.worktreePath });
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
        assertSafeTaskPath(this.repoPath, this.worktreePath);
        if (await pathExists(this.worktreePath)) await unlinkSharedNodeModules(this.worktreePath);
        try {
            await executeGit(['worktree', 'remove', '--force', this.worktreePath], this.repoPath);
        } catch (error) {
            const records = parseWorktrees(await executeGit(['worktree', 'list', '--porcelain', '-z'], this.repoPath));
            if (records.some((record) => samePath(record.path, this.worktreePath))) throw error;
        }
        await safeRemoveTaskDirectory(this.repoPath, this.worktreePath);
        await executeGit(['worktree', 'prune'], this.repoPath);
    }

    /**
     * Reopens the session for an already-existing task worktree, without
     * running any git command -- used by `task done`/`task cleanup`, which
     * are separate CLI invocations from the `task new` that created it.
     * @param repoPath The absolute path to the main repository.
     * @param taskId The task identifier the worktree and branch are derived from.
     */
    static open(repoPath: string, taskId: string, nodeModulesLinked = true): GitWorktreeSession {
        return new GitWorktreeSession(repoPath, worktreePathForTask(repoPath, taskId), branchNameForTask(taskId), nodeModulesLinked);
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

    private async worktrees(): Promise<WorktreeRecord[]> {
        return parseWorktrees(await executeGit(['worktree', 'list', '--porcelain', '-z'], this.repoPath));
    }

    private async localBranchExists(branch: string): Promise<boolean> {
        try { await executeGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], this.repoPath); return true; }
        catch { return false; }
    }

    private async remoteBranchExists(branch: string): Promise<boolean> {
        try { await executeGit(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`], this.repoPath); return true; }
        catch {
            try { await executeGit(['ls-remote', '--exit-code', '--heads', 'origin', branch], this.repoPath); return true; }
            catch { return false; }
        }
    }

    private async branchConfig(branch: string, key: 'base' | 'parent'): Promise<string | undefined> {
        try { return await executeGit(['config', '--get', `branch.${branch}.ia-graft-${key}`], this.repoPath); }
        catch { return undefined; }
    }

    private async setBranchConfig(branch: string, key: 'base' | 'parent', value: string): Promise<void> {
        await executeGit(['config', `branch.${branch}.ia-graft-${key}`, value], this.repoPath);
    }

    async resolveDefaultBranch(): Promise<{ branch: string; source: string }> {
        let remote = '';
        try { remote = await executeGit(['remote', 'get-url', 'origin'], this.repoPath); } catch { /* handled below */ }
        if (/github\.com[/:]/i.test(remote)) {
            try {
                const { stdout } = await execFileAsync('gh', ['repo', 'view', '--json', 'defaultBranchRef'], {
                    cwd: this.repoPath, env: envWithGhFallbackPath(),
                });
                const parsed = JSON.parse(stdout) as { defaultBranchRef?: { name?: string } };
                if (parsed.defaultBranchRef?.name) return { branch: parsed.defaultBranchRef.name, source: 'gh' };
            } catch { /* Git-native offline fallbacks below */ }
        }
        try {
            const symbolic = await executeGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], this.repoPath);
            if (symbolic.startsWith('origin/')) return { branch: symbolic.slice('origin/'.length), source: 'origin/HEAD' };
        } catch { /* next fallback */ }
        try {
            const advertised = await executeGit(['ls-remote', '--symref', 'origin', 'HEAD'], this.repoPath);
            const match = advertised.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/m);
            if (match?.[1]) return { branch: match[1], source: 'origin HEAD' };
        } catch { /* next fallback */ }
        for (const candidate of ['master', 'main']) {
            if (await this.remoteBranchExists(candidate)) return { branch: candidate, source: 'remote branch fallback' };
        }
        throw new Error('could not determine the default branch from gh, origin/HEAD, or origin HEAD');
    }

    private async pullRequestForBranch(branch: string): Promise<{
        number: number; url: string; state: string; mergedAt?: string | null; headRefName: string; baseRefName: string;
    } | undefined> {
        try {
            const { stdout } = await execFileAsync('gh', [
                'pr', 'view', branch, '--json', 'number,url,state,mergedAt,headRefName,baseRefName',
            ], { cwd: this.repoPath, env: envWithGhFallbackPath() });
            return JSON.parse(stdout);
        } catch { return undefined; }
    }

    async pullRequestByNumber(prNumber: number): Promise<{
        number: number; url: string; state: string; mergedAt?: string | null; headRefName: string; baseRefName: string;
    }> {
        try {
            const { stdout } = await execFileAsync('gh', [
                'pr', 'view', String(prNumber), '--json', 'number,url,state,mergedAt,headRefName,baseRefName',
            ], { cwd: this.repoPath, env: envWithGhFallbackPath() });
            return JSON.parse(stdout);
        } catch (error) {
            throw new Error(`could not resolve PR #${prNumber}: ${commandError(error)}`);
        }
    }

    /** Creates, reattaches, repairs, or resumes the deterministic task worktree. */
    async createOrResumeSession(
        taskId: string,
        options: { base?: string; parentTaskId?: string } = {},
    ): Promise<{ session: GitWorktreeSession; resumed: boolean; repaired: boolean; base: string; parent?: string }> {
        const branch = branchNameForTask(taskId);
        const worktree = worktreePathForTask(this.repoPath, taskId);
        let status = await this.taskStatus(taskId);
        const existingPr = status.pr as { number?: number; state?: string } | undefined;
        if (existingPr?.state && existingPr.state.toUpperCase() !== 'OPEN') {
            throw new Error(`refusing resume: task PR #${existingPr.number ?? '?'} is ${existingPr.state.toLowerCase()}; create a new task ID from the current default branch`);
        }
        if (status.checkoutMode === 'main') throw new Error('task branch is checked out in main; run task checkout --restore first');
        if (status.checkoutMode === 'unexpected') throw new Error(status.issues.join('; '));
        const requestedParent = options.parentTaskId ? branchNameForTask(options.parentTaskId) : undefined;
        if (options.base && requestedParent) throw new Error('base and parent are mutually exclusive');
        const requestedBase = requestedParent ?? options.base;
        if (requestedBase && status.base && requestedBase !== status.base) {
            throw new Error(`task base mismatch: recorded ${status.base}, requested ${requestedBase}`);
        }
        if (status.checkoutMode === 'worktree') {
            const base = status.base ?? requestedBase ?? (await this.resolveDefaultBranch()).branch;
            if (!status.base) await this.setBranchConfig(branch, 'base', base);
            if (options.parentTaskId && !status.parent) await this.setBranchConfig(branch, 'parent', options.parentTaskId);
            return {
                session: GitWorktreeSession.open(this.repoPath, taskId, await pathExists(path.join(worktree, 'node_modules'))), resumed: true, repaired: false,
                base,
                parent: options.parentTaskId ?? status.parent,
            };
        }
        let repaired = false;
        if (status.orphanDirectory) {
            await safeRemoveTaskDirectory(this.repoPath, worktree);
            await executeGit(['worktree', 'prune'], this.repoPath);
            repaired = true;
            status = await this.taskStatus(taskId);
        }
        const base = status.base ?? requestedBase ?? (await this.resolveDefaultBranch()).branch;
        await fs.mkdir(path.dirname(worktree), { recursive: true });
        if (status.branchLocal) {
            await executeGit(['worktree', 'add', worktree, branch], this.repoPath);
        } else if (status.branchRemote) {
            await executeGit(['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`], this.repoPath);
            await executeGit(['worktree', 'add', '--track', '-b', branch, worktree, `origin/${branch}`], this.repoPath);
        } else {
            let startPoint = base;
            if (!await this.localBranchExists(base)) {
                await executeGit(['fetch', 'origin', `${base}:refs/remotes/origin/${base}`], this.repoPath);
                startPoint = `origin/${base}`;
            }
            await executeGit(['worktree', 'add', '--no-track', '-b', branch, worktree, startPoint], this.repoPath);
            await this.setBranchConfig(branch, 'base', base);
            if (options.parentTaskId) await this.setBranchConfig(branch, 'parent', options.parentTaskId);
        }
        if (!status.base) await this.setBranchConfig(branch, 'base', base);
        if (options.parentTaskId && !status.parent) await this.setBranchConfig(branch, 'parent', options.parentTaskId);
        const { linked, reason } = await linkSharedNodeModules(this.repoPath, worktree);
        if (!linked && reason !== 'main checkout has no node_modules; run pnpm install there first') {
            throw new Error(`worktree created but failed to link node_modules: ${reason}`);
        }
        return { session: GitWorktreeSession.open(this.repoPath, taskId, linked), resumed: status.branchLocal || status.branchRemote, repaired, base, parent: options.parentTaskId ?? status.parent };
    }

    async taskStatus(taskId: string): Promise<{
        taskId: string; exists: boolean; branch: string; worktreePath: string; branchLocal: boolean; branchRemote: boolean;
        worktreeRegistered: boolean; directoryExists: boolean; orphanDirectory: boolean; checkoutMode: 'worktree' | 'main' | 'missing' | 'unexpected';
        location?: string; dirty?: boolean; head?: string; base?: string; parent?: string; pr?: unknown; issues: string[];
    }> {
        const branch = branchNameForTask(taskId);
        const worktreePath = worktreePathForTask(this.repoPath, taskId);
        const records = await this.worktrees();
        const expected = records.find((record) => samePath(record.path, worktreePath));
        const byBranch = records.find((record) => record.branch === branch);
        const branchLocal = await this.localBranchExists(branch);
        const branchRemote = await this.remoteBranchExists(branch);
        const directoryExists = await pathExists(worktreePath);
        const issues: string[] = [];
        if (directoryExists && !expected) issues.push('orphan directory exists but is not a registered Git worktree');
        if (expected && expected.branch !== branch) issues.push(`reserved task path is registered to unexpected branch ${expected.branch ?? 'detached HEAD'}`);
        if (byBranch && !samePath(byBranch.path, worktreePath) && !samePath(byBranch.path, this.repoPath)) issues.push(`task branch is checked out in unexpected worktree ${byBranch.path}`);
        const location = byBranch?.path ?? expected?.path;
        const checkoutMode = byBranch && samePath(byBranch.path, this.repoPath) ? 'main' as const
            : expected?.branch === branch ? 'worktree' as const
            : location ? 'unexpected' as const : 'missing' as const;
        let dirty: boolean | undefined;
        let head: string | undefined;
        if (location) {
            dirty = (await executeGit(['status', '--porcelain'], location)).length > 0;
            head = await executeGit(['rev-parse', '--short', 'HEAD'], location);
        } else if (branchLocal) head = await executeGit(['rev-parse', '--short', branch], this.repoPath);
        return {
            taskId, branch, worktreePath,
            exists: branchLocal || branchRemote || Boolean(expected) || directoryExists,
            branchLocal, branchRemote, worktreeRegistered: Boolean(expected), directoryExists,
            orphanDirectory: directoryExists && !expected, checkoutMode, location, dirty, head,
            base: await this.branchConfig(branch, 'base'), parent: await this.branchConfig(branch, 'parent'),
            pr: await this.pullRequestForBranch(branch), issues,
        };
    }

    async cleanupTask(taskId: string, force: boolean): Promise<{ discarded: boolean; removedOrphan: boolean }> {
        const status = await this.taskStatus(taskId);
        if (!status.exists) return { discarded: force, removedOrphan: false };
        if (status.checkoutMode === 'main') throw new Error('refusing cleanup while task is checked out in main; run task checkout --restore first');
        if (status.dirty && !force) throw new Error('refusing cleanup: task worktree has uncommitted changes (use --force only to abandon them)');
        if (!force) {
            const merge = await this.branchMergeStatus(status.branch);
            if (!merge.merged) throw new Error(`refusing cleanup: ${merge.reason}`);
        }
        if (status.worktreeRegistered) await GitWorktreeSession.open(this.repoPath, taskId).cleanup();
        else if (status.directoryExists) await safeRemoveTaskDirectory(this.repoPath, status.worktreePath);
        if (status.branchLocal) await executeGit(['branch', '-D', status.branch], this.repoPath);
        return { discarded: force, removedOrphan: status.orphanDirectory };
    }

    /** Opens only a structurally healthy linked task worktree; never main. */
    async openSession(taskId: string): Promise<GitWorktreeSession> {
        const status = await this.taskStatus(taskId);
        if (status.checkoutMode === 'main') throw new Error('task mutations are forbidden in main; run task checkout --restore first');
        if (status.checkoutMode !== 'worktree' || status.issues.length > 0) {
            throw new Error(`task worktree is not healthy; run task new or task doctor: ${status.issues.join('; ') || status.checkoutMode}`);
        }
        return GitWorktreeSession.open(this.repoPath, taskId);
    }

    async resumeFromPullRequest(prNumber: number): Promise<{
        taskId: string; pr: { number: number; url: string; state: string; baseRefName: string; headRefName: string };
        session: GitWorktreeSession; repaired: boolean;
    }> {
        const pr = await this.pullRequestByNumber(prNumber);
        if (pr.state.toUpperCase() !== 'OPEN') throw new Error(`refusing resume: PR #${prNumber} is ${pr.state.toLowerCase()}`);
        if (!pr.headRefName.startsWith('task/')) throw new Error(`PR #${prNumber} head is not an ia-graft branch: ${pr.headRefName}`);
        const taskId = pr.headRefName.slice('task/'.length);
        const parentTaskId = pr.baseRefName.startsWith('task/') ? pr.baseRefName.slice('task/'.length) : undefined;
        const result = await this.createOrResumeSession(taskId, parentTaskId ? { parentTaskId } : { base: pr.baseRefName });
        return { taskId, pr, session: result.session, repaired: result.repaired };
    }

    async checkoutTask(taskId: string): Promise<{ previousBranch: string; branch: string }> {
        let active: string | undefined;
        try { active = await executeGit(['config', '--get', 'ia-graft.checkout.task'], this.repoPath); } catch { /* none */ }
        if (active) throw new Error(`main checkout already hosts task ${active}; restore it first`);
        const status = await this.taskStatus(taskId);
        if (status.checkoutMode !== 'worktree' || status.issues.length > 0) throw new Error(`task worktree is not healthy: ${status.issues.join('; ') || status.checkoutMode}`);
        if (status.dirty) throw new Error('refusing checkout: task worktree has uncommitted changes');
        if ((await executeGit(['status', '--porcelain'], this.repoPath)).length > 0) throw new Error('refusing checkout: main checkout has uncommitted changes');
        const previousBranch = await executeGit(['branch', '--show-current'], this.repoPath);
        if (!previousBranch) throw new Error('refusing checkout: main checkout is in detached HEAD state');
        await executeGit(['config', 'ia-graft.checkout.task', taskId], this.repoPath);
        await executeGit(['config', 'ia-graft.checkout.previousBranch', previousBranch], this.repoPath);
        try {
            await GitWorktreeSession.open(this.repoPath, taskId).cleanup();
            await executeGit(['switch', status.branch], this.repoPath);
        } catch (error) {
            await executeGit(['config', '--unset', 'ia-graft.checkout.task'], this.repoPath).catch(() => undefined);
            await executeGit(['config', '--unset', 'ia-graft.checkout.previousBranch'], this.repoPath).catch(() => undefined);
            const after = await this.taskStatus(taskId);
            if (after.checkoutMode === 'missing') await this.createOrResumeSession(taskId, { base: status.base });
            throw error;
        }
        return { previousBranch, branch: status.branch };
    }

    async restoreCheckout(force = false): Promise<{ taskId: string; branch: string; worktreePath: string; discardedChanges: boolean }> {
        let taskId: string | undefined;
        let previousBranch: string | undefined;
        try { taskId = await executeGit(['config', '--get', 'ia-graft.checkout.task'], this.repoPath); } catch { /* none */ }
        try { previousBranch = await executeGit(['config', '--get', 'ia-graft.checkout.previousBranch'], this.repoPath); } catch { /* none */ }
        if (!taskId || !previousBranch) throw new Error('no ia-graft task checkout is active in main');
        const expected = branchNameForTask(taskId);
        const current = await executeGit(['branch', '--show-current'], this.repoPath);
        if (current !== expected) throw new Error(`refusing restore: expected ${expected}, found ${current || 'detached HEAD'}`);
        const dirty = (await executeGit(['status', '--porcelain'], this.repoPath)).length > 0;
        if (dirty && !force) throw new Error('refusing restore: main checkout has uncommitted task changes (use --force only to discard them)');
        if (dirty) {
            await executeGit(['restore', '--staged', '--worktree', '--source=HEAD', '--', '.'], this.repoPath);
            await executeGit(['clean', '-fd'], this.repoPath);
        }
        const base = await this.branchConfig(expected, 'base');
        await executeGit(['switch', previousBranch], this.repoPath);
        try {
            const restored = await this.createOrResumeSession(taskId, { base });
            return { taskId, branch: expected, worktreePath: restored.session.worktreePath, discardedChanges: dirty };
        } finally {
            await executeGit(['config', '--unset', 'ia-graft.checkout.task'], this.repoPath).catch(() => undefined);
            await executeGit(['config', '--unset', 'ia-graft.checkout.previousBranch'], this.repoPath).catch(() => undefined);
        }
    }

    async resolveTaskBase(taskId: string, requested?: string): Promise<string> {
        const branch = branchNameForTask(taskId);
        const recorded = await this.branchConfig(branch, 'base');
        const pr = await this.pullRequestForBranch(branch);
        const expected = recorded ?? pr?.baseRefName ?? (await this.resolveDefaultBranch()).branch;
        if (requested && requested !== expected) throw new Error(`task base mismatch: recorded ${expected}, requested ${requested}`);
        const resolved = requested ?? expected;
        if (resolved.startsWith('task/') && !await this.remoteBranchExists(resolved)) {
            throw new Error(`parent task branch ${resolved} is not published; run task done for the parent before the child`);
        }
        return resolved;
    }

    async taskGraph(): Promise<Array<{ taskId: string; branch: string; base?: string; parent?: string; head: string; location?: string; pr?: unknown }>> {
        const output = await executeGit(['for-each-ref', '--format=%(refname:short)%00%(objectname:short)', 'refs/heads/task/'], this.repoPath);
        const worktrees = await this.worktrees();
        const result: Array<{ taskId: string; branch: string; base?: string; parent?: string; head: string; location?: string; pr?: unknown }> = [];
        for (const line of output.split(/\r?\n/).filter(Boolean)) {
            const [branch, head] = line.split('\0');
            if (!branch || !head) continue;
            result.push({
                taskId: branch.slice('task/'.length), branch, head,
                base: await this.branchConfig(branch, 'base'), parent: await this.branchConfig(branch, 'parent'),
                location: worktrees.find((record) => record.branch === branch)?.path,
                pr: await this.pullRequestForBranch(branch),
            });
        }
        return result;
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
            try {
                await this.cleanupTask(id, false);
                cleaned.push(id);
            } catch (error) {
                skipped.push({
                    id,
                    reason: error instanceof Error ? `cleanup failed: ${error.message}` : `cleanup failed: ${String(error)}`,
                });
            }
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
