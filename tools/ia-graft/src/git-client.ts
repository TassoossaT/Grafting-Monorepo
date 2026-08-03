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

const execFileAsync = promisify(execFile);

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
        if (stderr) {
            // Log stderr for debugging, but don't throw unless the command fails
            console.warn(`Git warning: ${stderr}`);
        }
        return stdout.trim();
    } catch (error) {
        console.error(`Error executing git ${args.join(' ')}\n${error}`);
        throw error;
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

    private constructor(repoPath: string, worktreePath: string, branchName: string) {
        this.repoPath = repoPath;
        this.worktreePath = worktreePath;
        this.branchName = branchName;
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
     * Falls back to a manual compare-URL instead of throwing when `gh` is missing or not
     * authenticated, so a caller without `gh` set up still gets a usable next step rather
     * than a stack trace.
     * @param title The PR title.
     * @param body The PR body/description.
     * @param baseBranch The branch to open the PR against.
     * @returns The PR URL (or manual compare URL) and whether it was actually opened.
     */
    async createPullRequest(title: string, body: string, baseBranch: string): Promise<{ url: string; opened: boolean }> {
        try {
            const { stdout } = await execFileAsync(
                'gh',
                ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch, '--head', this.branchName],
                { cwd: this.worktreePath, env: envWithGhFallbackPath() },
            );
            return { url: stdout.trim(), opened: true };
        } catch {
            return { url: await this.compareUrl(baseBranch), opened: false };
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
     * Cleans up the worktree by removing the directory and pruning the git metadata.
     */
    async cleanup(): Promise<void> {
        // First, remove the worktree directory itself
        await fs.rm(this.worktreePath, { recursive: true, force: true });

        // Then, tell git to prune the worktree metadata using the original repoPath
        await executeGit(['worktree', 'prune'], this.repoPath);

        // Deleting the remote branch is a separate, conscious decision -- not done here.
        console.log(`Cleaned up worktree for branch ${this.branchName} at ${this.worktreePath}`);
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

        console.log(`Created worktree for branch ${branchName} at ${worktreePath}`);
        return new GitWorktreeSession(repoPath, worktreePath, branchName);
    }

    /**
     * Reopens the session for an already-existing task worktree, without
     * running any git command -- used by `task done`/`task cleanup`, which
     * are separate CLI invocations from the `task new` that created it.
     * @param repoPath The absolute path to the main repository.
     * @param taskId The task identifier the worktree and branch are derived from.
     */
    static open(repoPath: string, taskId: string): GitWorktreeSession {
        return new GitWorktreeSession(repoPath, worktreePathForTask(repoPath, taskId), branchNameForTask(taskId));
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

    /**
     * Reopens the session for an already-existing task worktree created by a
     * prior `createSession` call (in a separate CLI invocation).
     * @param taskId The task identifier the worktree and branch are derived from.
     */
    openSession(taskId: string): GitWorktreeSession {
        return GitWorktreeSession.open(this.repoPath, taskId);
    }
}