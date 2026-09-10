/**
 * A single task worktree, open for work: committing, testing, syncing.
 *
 * Bound to one task for its lifetime, so nothing it does can address another
 * task's worktree by accident.
 */

import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { envWithGhFallbackPath, execAsync, execFileAsync, executeGit, summarizeTestOutput } from "./exec.ts";
import { appendPullRequestSection, assertSafeTaskPath, branchNameForTask, commandError, parseWorktrees, pathExists, safeRemoveTaskDirectory, samePath, unlinkTaskDependencies, worktreePathForTask } from "./naming.ts";

export interface ExistingPullRequest {
    number: number;
    url: string;
    baseRefName: string;
    title: string;
    body: string;
}

/**
 * Separator between an existing PR body and a later `task done`'s prose.
 *
 * Deliberately a visible rule and heading rather than an invisible marker: the
 * audience is a human reviewer returning to a PR they have already read, and
 * what they need is to see where the part they have not read begins.
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

    /** Executes a git command within the task worktree. */
    async git(args: string[]): Promise<string> {
        return executeGit(args, this.worktreePath);
    }

    /**
     * Stages a file or files for the next commit.
     * @param filePaths A single file path or an array of file paths.
     */
    async add(filePaths: string | string[]): Promise<void> {
        const files = Array.isArray(filePaths) ? filePaths : [filePaths];
        await executeGit(['add', ...files], this.worktreePath);
    }

    async unmergedPaths(): Promise<string[]> {
        const output = await executeGit(['diff', '--name-only', '--diff-filter=U'], this.worktreePath);
        return output.split(/\r?\n/).filter(Boolean);
    }

    async conflictMarkerPaths(filePaths: string[]): Promise<string[]> {
        const marked: string[] = [];
        for (const filePath of filePaths) {
            try {
                const content = await fs.readFile(path.join(this.worktreePath, filePath), 'utf8');
                if (/^(?:<<<<<<< |>>>>>>> )/m.test(content)) marked.push(filePath);
            } catch { /* deleted and binary conflicts are resolved by Git staging rules */ }
        }
        return marked;
    }

    /**
     * Commits the staged changes to the worktree's branch.
     * @param message The commit message.
     * @param amend Whether to amend the previous commit.
     */
    async commit(message: string, amend?: boolean): Promise<void> {
        // The -m flag can be tricky with special characters. Using a temporary file is safer.
        const tempMsgFile = path.join(this.worktreePath, `.git_commit_msg_${randomBytes(8).toString('hex')}`);
        await fs.writeFile(tempMsgFile, message);
        try {
            const commitArgs = ['commit', '-F', tempMsgFile];
            if (amend) {
                commitArgs.push('--amend');
            }
            await executeGit(commitArgs, this.worktreePath);
            await executeGit(['config', '--unset', `branch.${this.branchName}.ia-graft-sync-source`], this.worktreePath).catch(() => undefined);
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
    async createPullRequest(title: string, body: string, baseBranch: string): Promise<{ url: string; state: 'created' | 'existing' | 'manual'; reason?: string; bodyAppended?: boolean; titleUpdated?: boolean }> {
        const existing = await this.existingPullRequest();
        if (existing) {
            if (existing.baseRefName !== baseBranch) {
                throw new Error(`existing PR #${existing.number} targets ${existing.baseRefName}, but task base is ${baseBranch}`);
            }
            const applied = await this.applyPullRequestUpdate(existing, title, body);
            return { url: existing.url, state: 'existing', ...applied };
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
    private async existingPullRequest(): Promise<ExistingPullRequest | null> {
        try {
            const { stdout } = await execFileAsync(
                'gh',
                ['pr', 'view', this.branchName, '--json', 'number,url,baseRefName,title,body'],
                { cwd: this.worktreePath, env: envWithGhFallbackPath() },
            );
            const result = JSON.parse(stdout) as Partial<ExistingPullRequest>;
            return result.number && result.url && result.baseRefName
                ? {
                    number: result.number,
                    url: result.url,
                    baseRefName: result.baseRefName,
                    title: result.title ?? '',
                    body: result.body ?? '',
                }
                : null;
        } catch {
            return null;
        }
    }

    /**
     * Carries a repeated `task done`'s title and body onto the PR that already exists.
     *
     * Without this the second and later calls discarded both silently: the CLI
     * reported the existing PR's URL and looked successful, while the
     * description a caller had just written never left the machine. A caller
     * has no way to notice, because the only observable difference is on
     * GitHub. Hence `bodyAppended`/`titleUpdated` in the result — the outcome
     * is reported either way rather than inferred.
     *
     * The body is **appended**, not replaced. Each `task done` after the first
     * describes a further round of work on a branch already under review, and
     * replacing would destroy the account of what a reviewer may have already
     * read. Re-running with an unchanged body appends nothing, so the common
     * case of pushing follow-up commits without new prose stays idempotent.
     */
    private async applyPullRequestUpdate(
        existing: ExistingPullRequest,
        title: string,
        body: string,
    ): Promise<{ bodyAppended: boolean; titleUpdated: boolean }> {
        const args: string[] = [];
        const titleUpdated = title.trim() !== existing.title.trim();
        if (titleUpdated) args.push('--title', title);

        const bodyAppended = body.trim().length > 0 && !existing.body.includes(body.trim());
        let bodyFile: string | undefined;
        if (bodyAppended) {
            // A PR body can reach GitHub's 65536-character limit, which is past
            // what a Windows command line accepts as a single argument, so the
            // body goes through a file rather than argv.
            bodyFile = path.join(tmpdir(), `ia-graft-pr-${existing.number}-${randomBytes(6).toString('hex')}.md`);
            await fs.writeFile(bodyFile, appendPullRequestSection(existing.body, body), 'utf8');
            args.push('--body-file', bodyFile);
        }

        if (args.length === 0) return { bodyAppended: false, titleUpdated: false };

        try {
            await execFileAsync('gh', ['pr', 'edit', String(existing.number), ...args], {
                cwd: this.worktreePath,
                env: envWithGhFallbackPath(),
            });
            return { bodyAppended, titleUpdated };
        } catch (error) {
            throw new Error(`gh pr edit failed for PR #${existing.number}: ${commandError(error)}`);
        } finally {
            if (bodyFile) await fs.rm(bodyFile, { force: true });
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
        if (await pathExists(this.worktreePath)) await unlinkTaskDependencies(this.worktreePath);
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
