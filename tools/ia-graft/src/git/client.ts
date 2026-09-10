/**
 * The git layer's entry point: everything a task command asks of the
 * repository that is not scoped to one already-open worktree.
 *
 * Creating, listing, diagnosing and sweeping task worktrees lives here;
 * working inside one is `GitWorktreeSession`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { type DependencyMode, dependencyMode, type DependencyPreparation, materializeTaskDependencies, mirrorGeneratedArtifacts, prepareDependencyOverlays, type PrepareTaskDependenciesOptions, removeTaskDependencyCache } from "./dependencies.ts";
import { envWithGhFallbackPath, execFileAsync, executeGit } from "./exec.ts";
import { branchNameForTask, commandError, parseWorktrees, pathExists, safeRemoveTaskDirectory, samePath, worktreePathForTask, type WorktreeRecord } from "./naming.ts";
import { deleteRemoteBranchWithLease, type MergedBranchProof, type RemoteBranchDeletionPlan, remoteBranchDeletionPlan } from "./remote-branches.ts";
import { GitWorktreeSession } from "./session.ts";

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

    private async remoteBranchHead(branch: string): Promise<string | undefined> {
        const output = await executeGit(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], this.repoPath);
        const match = output.match(/^([a-f0-9]{40})\s+refs\/heads\/(.+)$/i);
        return match?.[2] === branch ? match[1]!.toLowerCase() : undefined;
    }

    private async openPullRequestsBasedOn(branch: string): Promise<number[] | undefined> {
        try {
            const { stdout } = await execFileAsync(
                'gh',
                ['pr', 'list', '--base', branch, '--state', 'open', '--json', 'number'],
                { cwd: this.repoPath, env: envWithGhFallbackPath() },
            );
            const rows = JSON.parse(stdout) as Array<{ number?: number }>;
            return rows.flatMap((row) => Number.isInteger(row.number) ? [row.number!] : []);
        } catch {
            return undefined;
        }
    }

    private async branchConfig(branch: string, key: 'base' | 'parent' | 'sync-source'): Promise<string | undefined> {
        try { return await executeGit(['config', '--get', `branch.${branch}.ia-graft-${key}`], this.repoPath); }
        catch { return undefined; }
    }

    private async setBranchConfig(branch: string, key: 'base' | 'parent' | 'sync-source', value: string): Promise<void> {
        await executeGit(['config', `branch.${branch}.ia-graft-${key}`, value], this.repoPath);
    }

    private async unsetBranchConfig(branch: string, key: 'base' | 'parent' | 'sync-source'): Promise<void> {
        await executeGit(['config', '--unset', `branch.${branch}.ia-graft-${key}`], this.repoPath).catch(() => undefined);
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
    ): Promise<{ session: GitWorktreeSession; resumed: boolean; repaired: boolean; base: string; parent?: string; dependencies: DependencyPreparation }> {
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
            const dependencies = await prepareDependencyOverlays(this.repoPath, worktree);
            return {
                session: GitWorktreeSession.open(this.repoPath, taskId, dependencies.linked), resumed: true, repaired: false,
                base,
                parent: options.parentTaskId ?? status.parent,
                dependencies,
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
        const dependencies = await prepareDependencyOverlays(this.repoPath, worktree);
        if (!dependencies.linked && dependencies.reason !== 'main checkout has no node_modules; run pnpm install there first') {
            throw new Error(`worktree created but failed to prepare node_modules: ${dependencies.reason}`);
        }
        await mirrorGeneratedArtifacts(this.repoPath, worktree);
        return {
            session: GitWorktreeSession.open(this.repoPath, taskId, dependencies.linked),
            resumed: status.branchLocal || status.branchRemote,
            repaired,
            base,
            parent: options.parentTaskId ?? status.parent,
            dependencies,
        };
    }

    async taskStatus(taskId: string): Promise<{
        taskId: string; exists: boolean; branch: string; worktreePath: string; branchLocal: boolean; branchRemote: boolean;
        worktreeRegistered: boolean; directoryExists: boolean; orphanDirectory: boolean; checkoutMode: 'worktree' | 'main' | 'missing' | 'unexpected';
        location?: string; dirty?: boolean; head?: string; base?: string; parent?: string; syncSource?: string; pr?: unknown; issues: string[];
        mergeInProgress: boolean; conflicts: string[]; dependencyMode: DependencyMode;
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
        let mergeInProgress = false;
        let conflicts: string[] = [];
        if (location) {
            dirty = (await executeGit(['status', '--porcelain'], location)).length > 0;
            head = await executeGit(['rev-parse', '--short', 'HEAD'], location);
            try {
                await executeGit(['rev-parse', '--verify', '-q', 'MERGE_HEAD'], location);
                mergeInProgress = true;
                conflicts = (await executeGit(['diff', '--name-only', '--diff-filter=U'], location)).split(/\r?\n/).filter(Boolean);
            } catch { /* no merge in progress */ }
        } else if (branchLocal) head = await executeGit(['rev-parse', '--short', branch], this.repoPath);
        return {
            taskId, branch, worktreePath,
            exists: branchLocal || branchRemote || Boolean(expected) || directoryExists,
            branchLocal, branchRemote, worktreeRegistered: Boolean(expected), directoryExists,
            orphanDirectory: directoryExists && !expected, checkoutMode, location, dirty, head,
            base: await this.branchConfig(branch, 'base'), parent: await this.branchConfig(branch, 'parent'),
            syncSource: await this.branchConfig(branch, 'sync-source'),
            pr: await this.pullRequestForBranch(branch), issues,
            mergeInProgress,
            conflicts,
            dependencyMode: checkoutMode === 'worktree' ? await dependencyMode(worktreePath) : 'none',
        };
    }

    async cleanupTask(taskId: string, force: boolean): Promise<{
        discarded: boolean; removedOrphan: boolean; dependencyCacheRemoved: boolean;
        remoteBranchRemoved: boolean; remoteBranchState: string; remoteBranchReason?: string;
    }> {
        const status = await this.taskStatus(taskId);
        if (!status.exists) {
            return {
                discarded: force,
                removedOrphan: false,
                dependencyCacheRemoved: await removeTaskDependencyCache(this.repoPath, taskId),
                remoteBranchRemoved: false,
                remoteBranchState: 'already-absent',
            };
        }
        if (status.checkoutMode === 'main') throw new Error('refusing cleanup while task is checked out in main; run task checkout --restore first');
        if (status.dirty && !force) throw new Error('refusing cleanup: task worktree has uncommitted changes (use --force only to abandon them)');
        let deletionPlan: RemoteBranchDeletionPlan | undefined;
        if (!force) {
            const remoteHead = await this.remoteBranchHead(status.branch);
            const merge = await this.branchMergeStatus(status.branch, remoteHead);
            if (!merge.merged) throw new Error(`refusing cleanup: ${merge.reason}`);
            deletionPlan = remoteBranchDeletionPlan(
                status.branch,
                remoteHead,
                merge.proof!,
                remoteHead ? await this.openPullRequestsBasedOn(status.branch) : [],
            );
        }
        if (status.worktreeRegistered) await GitWorktreeSession.open(this.repoPath, taskId).cleanup();
        else if (status.directoryExists) await safeRemoveTaskDirectory(this.repoPath, status.worktreePath);
        if (status.branchLocal) await executeGit(['branch', '-D', status.branch], this.repoPath);
        let remoteBranchRemoved = false;
        if (deletionPlan?.remove) {
            await deleteRemoteBranchWithLease(this.repoPath, status.branch, deletionPlan.expectedHead);
            remoteBranchRemoved = true;
        }
        if (remoteBranchRemoved || deletionPlan?.state === 'already-absent') {
            await executeGit(['update-ref', '-d', `refs/remotes/origin/${status.branch}`], this.repoPath);
        }
        const remoteBranchState = force ? 'preserved-force' : deletionPlan?.state ?? 'already-absent';
        return {
            discarded: force,
            removedOrphan: status.orphanDirectory,
            dependencyCacheRemoved: await removeTaskDependencyCache(this.repoPath, taskId),
            remoteBranchRemoved,
            remoteBranchState,
            remoteBranchReason: force
                ? 'force cleanup never deletes remote branches'
                : deletionPlan && !deletionPlan.remove ? deletionPlan.reason : undefined,
        };
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
        const fallback = (await this.resolveDefaultBranch()).branch;
        let expected = recorded ?? pr?.baseRefName ?? fallback;
        // A stacked task whose parent has already landed must target the
        // default branch instead, the way GitHub retargets a stack when its
        // parent merges. Without this the child's PR merges into a branch that
        // is no longer going anywhere, and the work silently never reaches the
        // default branch even though the PR reads as merged.
        if (expected.startsWith('task/')) {
            // Two signals, because neither covers the other. A merged parent PR
            // catches the case where the parent branch has drifted ahead of what
            // was merged -- the graph still shows unmerged commits there, but its
            // pull request is closed and nothing more will ever land from it.
            const parentPr = await this.pullRequestForBranch(expected);
            if (parentPr?.state === 'MERGED') expected = parentPr.baseRefName;
            // The graph check needs no `gh`, and catches a parent merged by any
            // other route.
            else if (await this.branchIsContainedIn(expected, fallback)) expected = fallback;
        }
        if (requested && requested !== expected) throw new Error(`task base mismatch: recorded ${expected}, requested ${requested}`);
        const resolved = requested ?? expected;
        if (resolved.startsWith('task/') && !await this.remoteBranchExists(resolved)) {
            throw new Error(`parent task branch ${resolved} is not published; run task done for the parent before the child`);
        }
        return resolved;
    }

    /**
     * Whether `branch` has already landed in `target`, judged from the commit
     * graph rather than from a pull request's state -- a branch can be merged
     * by any route, and this stays correct without `gh` being reachable.
     */
    private async branchIsContainedIn(branch: string, target: string): Promise<boolean> {
        try {
            const ahead = await executeGit(
                ['rev-list', '--count', `refs/remotes/origin/${target}..refs/remotes/origin/${branch}`],
                this.repoPath,
            );
            return ahead.trim() === '0';
        } catch { return false; }
    }

    async prepareTaskDependencies(taskId: string, options: PrepareTaskDependenciesOptions = {}): Promise<DependencyPreparation> {
        const status = await this.taskStatus(taskId);
        if (status.checkoutMode !== 'worktree' || status.issues.length > 0) {
            throw new Error(`task worktree is not healthy: ${status.issues.join('; ') || status.checkoutMode}`);
        }
        const shouldInstall = options.install || Boolean(options.updateLockfile) || Boolean(options.add);
        const result = shouldInstall
            ? await materializeTaskDependencies(this.repoPath, status.worktreePath, taskId, options)
            : await prepareDependencyOverlays(this.repoPath, status.worktreePath, false);
        await mirrorGeneratedArtifacts(this.repoPath, status.worktreePath);
        return result;
    }

    async syncTask(taskId: string, options: { fetch?: boolean; abort?: boolean } = {}) {
        const status = await this.taskStatus(taskId);
        if (status.checkoutMode !== 'worktree' || status.issues.length > 0 || !status.location) {
            throw new Error(`task worktree is not healthy: ${status.issues.join('; ') || status.checkoutMode}`);
        }
        if (options.abort) {
            if (!status.mergeInProgress) throw new Error('no task sync merge is in progress');
            if (!status.syncSource) throw new Error('refusing abort: the merge was not started by task sync');
            await executeGit(['merge', '--abort'], status.location);
            await this.unsetBranchConfig(status.branch, 'sync-source');
            return {
                aborted: true,
                completed: false,
                mergeInProgress: false,
                conflicts: [] as string[],
                head: await executeGit(['rev-parse', '--short', 'HEAD'], status.location),
            };
        }
        if (status.mergeInProgress) {
            return {
                aborted: false,
                completed: false,
                mergeInProgress: true,
                conflicts: status.conflicts,
                head: status.head,
                recommendedAction: status.syncSource ? 'resolve conflicts, then task commit; or task sync --abort' : 'resolve conflicts, then task commit',
            };
        }
        if (status.syncSource) await this.unsetBranchConfig(status.branch, 'sync-source');
        if (status.dirty) throw new Error('refusing sync: task worktree has uncommitted changes');

        const base = await this.resolveTaskBase(taskId);
        let source: string;
        if (base.startsWith('task/') && await this.localBranchExists(base)) {
            source = base;
        } else if (options.fetch) {
            await executeGit(['fetch', 'origin', `${base}:refs/remotes/origin/${base}`], status.location);
            source = `origin/${base}`;
        } else if (await this.localBranchExists(base)) {
            source = base;
        } else if (await this.remoteBranchExists(base)) {
            source = `origin/${base}`;
        } else {
            throw new Error(`recorded task base does not exist locally or remotely: ${base}`);
        }

        const before = await executeGit(['rev-parse', '--short', 'HEAD'], status.location);
        const divergence = await executeGit(['rev-list', '--left-right', '--count', `HEAD...${source}`], status.location);
        const [ahead = 0, behind = 0] = divergence.split(/\s+/).map(Number);
        if (behind === 0) {
            return {
                aborted: false, completed: true, updated: false, mergeInProgress: false,
                base, source, before, after: before, ahead, behind, conflicts: [] as string[],
            };
        }

        await this.setBranchConfig(status.branch, 'sync-source', source);
        try {
            await execFileAsync('git', ['merge', '--no-edit', source], { cwd: status.location });
        } catch (error) {
            const refreshed = await this.taskStatus(taskId);
            if (refreshed.mergeInProgress) {
                return {
                    aborted: false, completed: false, updated: false, mergeInProgress: true,
                    base, source, before, after: before, ahead, behind, conflicts: refreshed.conflicts,
                    recommendedAction: refreshed.syncSource ? 'resolve conflicts, then task commit; or task sync --abort' : 'resolve conflicts, then task commit',
                };
            }
            await this.unsetBranchConfig(status.branch, 'sync-source');
            throw new Error(`could not sync ${source}: ${commandError(error)}`);
        }
        await this.unsetBranchConfig(status.branch, 'sync-source');
        const after = await executeGit(['rev-parse', '--short', 'HEAD'], status.location);
        const parentLine = await executeGit(['rev-list', '--parents', '-n', '1', 'HEAD'], status.location);
        return {
            aborted: false, completed: true, updated: after !== before, mergeInProgress: false,
            base, source, before, after, ahead, behind, conflicts: [] as string[],
            mergeCommit: parentLine.split(/\s+/).length > 2,
        };
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
     * merge status, and cleans up (worktree + local branch + verified remote
     * branch when unused) the ones that
     * are already merged -- so worktrees stop accumulating and nobody has
     * to remember to run `task cleanup` by hand after every merge.
     * Anything not merged, or whose merge status can't be determined, is
     * left untouched and reported as skipped rather than guessed at.
     */
    async sweepMergedWorktrees(): Promise<{
        cleaned: string[];
        skipped: Array<{ id: string; reason: string }>;
        remoteBranches: Array<{ id: string; removed: boolean; state: string; reason?: string }>;
    }> {
        const worktreesDir = path.join(this.repoPath, '.worktrees');
        let entries;
        try {
            entries = await fs.readdir(worktreesDir, { withFileTypes: true });
        } catch {
            return { cleaned: [], skipped: [], remoteBranches: [] };
        }

        const cleaned: string[] = [];
        const skipped: Array<{ id: string; reason: string }> = [];
        const remoteBranches: Array<{ id: string; removed: boolean; state: string; reason?: string }> = [];
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
                const cleanup = await this.cleanupTask(id, false);
                cleaned.push(id);
                remoteBranches.push({
                    id,
                    removed: cleanup.remoteBranchRemoved,
                    state: cleanup.remoteBranchState,
                    reason: cleanup.remoteBranchReason,
                });
            } catch (error) {
                skipped.push({
                    id,
                    reason: error instanceof Error ? `cleanup failed: ${error.message}` : `cleanup failed: ${String(error)}`,
                });
            }
        }
        return { cleaned, skipped, remoteBranches };
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
    private async branchMergeStatus(
        branch: string,
        expectedHead?: string,
    ): Promise<{ merged: boolean; reason: string; proof?: MergedBranchProof }> {
        try {
            const { stdout } = await execFileAsync(
                'gh',
                ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number,headRefName,headRefOid'],
                { cwd: this.repoPath, env: envWithGhFallbackPath() },
            );
            const rows = JSON.parse(stdout) as Array<Partial<MergedBranchProof>>;
            const proofs = rows.filter((row): row is MergedBranchProof =>
                Number.isInteger(row.number) && row.headRefName === branch && typeof row.headRefOid === 'string'
                && /^[a-f0-9]{40}$/i.test(row.headRefOid));
            const proof = expectedHead
                ? proofs.find((candidate) => candidate.headRefOid.toLowerCase() === expectedHead.toLowerCase())
                : proofs[0];
            if (proof) return { merged: true, reason: `merged via PR #${proof.number}`, proof };
            return {
                merged: false,
                reason: expectedHead && proofs.length > 0
                    ? `remote head ${expectedHead} does not match any merged PR for this branch`
                    : 'no merged PR found for this branch',
            };
        } catch {
            return { merged: false, reason: 'could not reach gh to check merge status' };
        }
    }
}
