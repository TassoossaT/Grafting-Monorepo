import { exec, execFile } from 'child_process';
import { createHash, randomBytes } from 'crypto';
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

/** A pull request that already exists for a task branch, as `gh pr view` reports it. */
interface ExistingPullRequest {
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
export function appendPullRequestSection(existingBody: string, addition: string): string {
    const current = existingBody.trimEnd();
    const next = addition.trim();
    if (current.length === 0) return next;
    return `${current}\n\n---\n\n## Update\n\n${next}`;
}
const DEPENDENCY_OVERLAY_MARKER = '.ia-graft-overlay.json';
const DEPENDENCY_CACHE_DIR = '.ia-graft-task-deps';

export type DependencyMode = 'none' | 'legacy-shared' | 'workspace-aware' | 'unmanaged';

export interface DependencyPreparation {
    linked: boolean;
    mode: DependencyMode;
    overlays: number;
    workspaceLinks: number;
    externalLinks: number;
    copiedFiles: number;
    materialized?: boolean;
    lockfileHash?: string;
    workspaceConfigHash?: string;
    virtualStore?: string;
    updatedLockfile?: boolean;
    addedDependency?: { targetFile: string; name: string; version: string; dev: boolean };
    reason?: string;
}

export interface PrepareTaskDependenciesOptions {
    install?: boolean;
    updateLockfile?: boolean;
    add?: string;
    workspace?: string;
    dev?: boolean;
}

interface DependencyOverlayMarker {
    version: 1 | 2 | 3;
    source: string;
    materialized?: boolean;
    lockfileHash?: string;
    workspaceConfigHash?: string;
    virtualStore?: string;
    workspaceLinks?: number;
    externalLinks?: number;
    copiedFiles?: number;
}

export interface MergedBranchProof {
    number: number;
    headRefName: string;
    headRefOid: string;
}

export type RemoteBranchDeletionPlan =
    | { remove: true; state: 'delete'; expectedHead: string; mergedPr: number }
    | { remove: false; state: 'already-absent' | 'preserved-open-dependent-pr' | 'preserved-verification-unavailable'; reason: string };

export function remoteBranchDeletionPlan(
    branch: string,
    remoteHead: string | undefined,
    mergedProof: MergedBranchProof,
    openDependentPrNumbers: number[] | undefined,
): RemoteBranchDeletionPlan {
    if (!branch.startsWith('task/')) throw new Error(`refusing remote deletion outside task/*: ${branch}`);
    if (!remoteHead) return { remove: false, state: 'already-absent', reason: 'remote branch is already absent' };
    if (mergedProof.headRefName !== branch) {
        throw new Error(`merged PR #${mergedProof.number} head is ${mergedProof.headRefName}, expected ${branch}`);
    }
    if (mergedProof.headRefOid.toLowerCase() !== remoteHead.toLowerCase()) {
        throw new Error(`remote head ${remoteHead} does not match merged PR #${mergedProof.number} head ${mergedProof.headRefOid}`);
    }
    if (!openDependentPrNumbers) {
        return {
            remove: false,
            state: 'preserved-verification-unavailable',
            reason: 'could not verify whether open PRs still use the branch as their base',
        };
    }
    if (openDependentPrNumbers.length > 0) {
        return {
            remove: false,
            state: 'preserved-open-dependent-pr',
            reason: `open PRs still use the branch as their base: ${openDependentPrNumbers.map((number) => `#${number}`).join(', ')}`,
        };
    }
    return { remove: true, state: 'delete', expectedHead: remoteHead, mergedPr: mergedProof.number };
}

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
 * Finds the installation roots that need task-owned overlays. A plain Git
 * worktree has no ignored dependencies; reusing each main node_modules as one
 * junction fixes external resolution but makes workspace links resolve back
 * to main. The overlay below keeps external store targets while rebinding
 * workspace packages to task-local sources. No main installation is a valid
 * `linked: false` result; installation remains a main-checkout responsibility.
 */
function relativeInside(parent: string, child: string): string | undefined {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    return relative;
}

function workspaceRelativeTarget(repoPath: string, resolvedTarget: string): string | undefined {
    const relative = relativeInside(repoPath, resolvedTarget);
    if (!relative) return undefined;
    const segments = relative.split(path.sep);
    if (segments.includes('node_modules') || segments[0] === '.git' || segments[0] === '.worktrees') return undefined;
    return relative;
}

async function removeLinkTree(target: string): Promise<void> {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
        await fs.unlink(target);
        return;
    }
    if (!stat.isDirectory()) {
        await fs.unlink(target);
        return;
    }
    for (const entry of await fs.readdir(target, { withFileTypes: true })) {
        await removeLinkTree(path.join(target, entry.name));
    }
    await fs.rmdir(target);
}

async function mirrorDependencyEntry(
    repoPath: string,
    worktreePath: string,
    source: string,
    target: string,
    counts: Omit<DependencyPreparation, 'linked' | 'mode' | 'overlays' | 'reason'>,
): Promise<void> {
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) {
        const resolved = await fs.realpath(source);
        const workspaceRelative = workspaceRelativeTarget(repoPath, resolved);
        const linkTarget = workspaceRelative ? path.join(worktreePath, workspaceRelative) : resolved;
        const targetStat = await fs.stat(resolved);
        await fs.symlink(linkTarget, target, targetStat.isDirectory() ? 'junction' : 'file');
        if (workspaceRelative) counts.workspaceLinks += 1;
        else counts.externalLinks += 1;
        return;
    }
    if (stat.isDirectory()) {
        const name = path.basename(source);
        if (name.startsWith('@') || name === '.bin') {
            await fs.mkdir(target, { recursive: true });
            for (const entry of await fs.readdir(source)) {
                await mirrorDependencyEntry(repoPath, worktreePath, path.join(source, entry), path.join(target, entry), counts);
            }
            return;
        }
        await fs.symlink(source, target, 'junction');
        counts.externalLinks += 1;
        return;
    }
    await fs.copyFile(source, target);
    counts.copiedFiles += 1;
}

async function readMaterializedPreparation(repoPath: string, worktreePath: string): Promise<DependencyPreparation | undefined> {
    const markerPath = path.join(worktreePath, 'node_modules', DEPENDENCY_OVERLAY_MARKER);
    if (!await pathExists(markerPath)) return undefined;
    try {
        const marker = JSON.parse(await fs.readFile(markerPath, 'utf8')) as DependencyOverlayMarker;
        if (marker.version !== 3 || !marker.materialized || !samePath(marker.source, repoPath)
            || !marker.lockfileHash || !marker.workspaceConfigHash || !marker.virtualStore) return undefined;
        const lockfilePath = path.join(worktreePath, 'pnpm-lock.yaml');
        const workspaceConfigPath = path.join(worktreePath, 'pnpm-workspace.yaml');
        if (!await pathExists(lockfilePath) || !await pathExists(workspaceConfigPath)) return undefined;
        const currentLockfileHash = createHash('sha256').update(await fs.readFile(lockfilePath)).digest('hex');
        const currentWorkspaceConfigHash = createHash('sha256').update(await fs.readFile(workspaceConfigPath)).digest('hex');
        if (currentLockfileHash !== marker.lockfileHash || currentWorkspaceConfigHash !== marker.workspaceConfigHash) return undefined;
        return {
            linked: true,
            mode: 'workspace-aware',
            overlays: (await findNodeModulesDirs(worktreePath)).length,
            workspaceLinks: marker.workspaceLinks ?? 0,
            externalLinks: marker.externalLinks ?? 0,
            copiedFiles: marker.copiedFiles ?? 0,
            materialized: true,
            lockfileHash: marker.lockfileHash,
            workspaceConfigHash: marker.workspaceConfigHash,
            virtualStore: marker.virtualStore,
        };
    } catch {
        return undefined;
    }
}

async function dependencyMode(worktreePath: string): Promise<DependencyMode> {
    const rootNodeModules = path.join(worktreePath, 'node_modules');
    if (!await pathExists(rootNodeModules)) return 'none';
    if ((await fs.lstat(rootNodeModules)).isSymbolicLink()) return 'legacy-shared';
    if (await pathExists(path.join(rootNodeModules, DEPENDENCY_OVERLAY_MARKER))) return 'workspace-aware';
    return 'unmanaged';
}

/**
 * Builds small task-owned node_modules overlays. External dependencies still
 * point at the main checkout's installed store, while pnpm workspace links
 * are rebound to the corresponding package inside this task worktree.
 */
async function prepareDependencyOverlays(
    repoPath: string,
    worktreePath: string,
    preserveMaterialized = true,
): Promise<DependencyPreparation> {
    if (preserveMaterialized) {
        const materialized = await readMaterializedPreparation(repoPath, worktreePath);
        if (materialized) return materialized;
    }
    const rootNodeModules = path.join(repoPath, 'node_modules');
    try {
        await fs.access(rootNodeModules);
    } catch {
        return {
            linked: false, mode: 'none', overlays: 0, workspaceLinks: 0, externalLinks: 0, copiedFiles: 0,
            reason: 'main checkout has no node_modules; run pnpm install there first',
        };
    }
    const relativeDirs = await findNodeModulesDirs(repoPath);
    const counts = { workspaceLinks: 0, externalLinks: 0, copiedFiles: 0 };
    for (const rel of relativeDirs) {
        const source = path.join(repoPath, rel);
        const target = path.join(worktreePath, rel);
        if (await pathExists(target)) {
            const stat = await fs.lstat(target);
            const mode = stat.isSymbolicLink() ? 'legacy-shared'
                : await pathExists(path.join(target, DEPENDENCY_OVERLAY_MARKER)) ? 'workspace-aware'
                : 'unmanaged';
            if (mode === 'unmanaged') throw new Error(`refusing to replace unmanaged dependency directory: ${target}`);
            await removeLinkTree(target);
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.mkdir(target, { recursive: true });
        // Write the ownership proof first so a partially built overlay remains
        // safely recoverable by task deps/cleanup after an interrupted run.
        await fs.writeFile(path.join(target, DEPENDENCY_OVERLAY_MARKER), JSON.stringify({ version: 1, source }));
        for (const entry of await fs.readdir(source)) {
            if (rel === 'node_modules' && entry === DEPENDENCY_CACHE_DIR) continue;
            await mirrorDependencyEntry(repoPath, worktreePath, path.join(source, entry), path.join(target, entry), counts);
        }
    }
    return { linked: true, mode: 'workspace-aware', overlays: relativeDirs.length, ...counts };
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

function dependencyCachePath(repoPath: string, taskId: string): string {
    return path.join(repoPath, 'node_modules', DEPENDENCY_CACHE_DIR, taskId);
}

function assertSafeDependencyCachePath(repoPath: string, target: string): void {
    const root = path.resolve(repoPath, 'node_modules', DEPENDENCY_CACHE_DIR);
    const resolved = path.resolve(target);
    if (!samePath(path.dirname(resolved), root)) {
        throw new Error(`refusing dependency-cache mutation outside one deterministic task path: ${resolved}`);
    }
}

async function countDependencyEntry(
    worktreePath: string,
    target: string,
    counts: { workspaceLinks: number; externalLinks: number; copiedFiles: number },
): Promise<void> {
    const name = path.basename(target);
    if (name === DEPENDENCY_OVERLAY_MARKER || name === '.modules.yaml' || name.startsWith('.pnpm')) return;
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
        const resolved = await fs.realpath(target);
        if (workspaceRelativeTarget(worktreePath, resolved)) counts.workspaceLinks += 1;
        else counts.externalLinks += 1;
        return;
    }
    if (stat.isDirectory() && (name.startsWith('@') || name === '.bin')) {
        for (const entry of await fs.readdir(target)) {
            await countDependencyEntry(worktreePath, path.join(target, entry), counts);
        }
        return;
    }
    if (stat.isDirectory()) counts.externalLinks += 1;
    else counts.copiedFiles += 1;
}

async function executePnpm(args: string[], cwd: string): Promise<void> {
    const options = {
        cwd,
        env: { ...process.env, CI: 'true' },
        maxBuffer: 4 * 1024 * 1024,
    };
    if (process.platform === 'win32') {
        await execFileAsync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd', ...args], options);
        return;
    }
    await execFileAsync('pnpm', args, options);
}

export function parseDependencySpec(dep: string): { name: string; version: string } {
    let trimmed = dep.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        trimmed = trimmed.slice(1, -1).trim();
    }
    // Handle key-value format e.g. '"@scope/pkg": "1.0.0"' or '@scope/pkg: workspace:*'
    if (trimmed.includes(':') && (trimmed.includes('":') || trimmed.includes("':") || trimmed.includes(': '))) {
        const colonIndex = trimmed.indexOf(':');
        const namePart = trimmed.slice(0, colonIndex).replace(/['"]/g, '').trim();
        const versionPart = trimmed.slice(colonIndex + 1).replace(/['"]/g, '').trim();
        if (namePart && !namePart.includes(' ')) {
            if (namePart.startsWith('@') && !namePart.includes('/')) {
                throw new Error(`invalid scoped package dependency: ${namePart}`);
            }
            return { name: namePart, version: versionPart || '*' };
        }
    }
    if (trimmed.startsWith('@')) {
        const slashIndex = trimmed.indexOf('/');
        if (slashIndex === -1) throw new Error(`invalid scoped package dependency: ${trimmed}`);
        const atIndex = trimmed.indexOf('@', slashIndex);
        if (atIndex === -1) {
            return { name: trimmed, version: '*' };
        }
        return { name: trimmed.slice(0, atIndex), version: trimmed.slice(atIndex + 1) };
    }
    const atIndex = trimmed.indexOf('@');
    if (atIndex === -1) {
        return { name: trimmed, version: '*' };
    }
    return { name: trimmed.slice(0, atIndex), version: trimmed.slice(atIndex + 1) };
}

async function findWorkspacePackageJson(worktreePath: string, workspace?: string): Promise<string> {
    if (!workspace) {
        const rootPkg = path.join(worktreePath, 'package.json');
        if (await pathExists(rootPkg)) return rootPkg;
        throw new Error('no root package.json found in worktree');
    }
    const directPath = path.join(worktreePath, workspace, 'package.json');
    if (await pathExists(directPath)) return directPath;
    const directFile = path.join(worktreePath, workspace);
    if (workspace.endsWith('package.json') && await pathExists(directFile)) return directFile;

    const matches: string[] = [];
    async function scanDir(currentDir: string, depth: number): Promise<void> {
        if (depth > 4) return;
        let entries: string[];
        try {
            entries = await fs.readdir(currentDir);
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'target' || entry === '.worktrees') continue;
            const fullPath = path.join(currentDir, entry);
            try {
                const stat = await fs.lstat(fullPath);
                if (stat.isDirectory()) {
                    const pkgPath = path.join(fullPath, 'package.json');
                    if (await pathExists(pkgPath)) {
                        try {
                            const content = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
                            if (content.name === workspace) {
                                matches.push(pkgPath);
                            }
                        } catch {}
                    }
                    await scanDir(fullPath, depth + 1);
                }
            } catch {
                continue;
            }
        }
    }
    await scanDir(worktreePath, 0);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) throw new Error(`multiple packages matched workspace name '${workspace}': ${matches.join(', ')}`);
    throw new Error(`workspace package not found for '${workspace}' in worktree`);
}

async function addDependencyToPackageJson(
    worktreePath: string,
    dependency: string,
    workspace?: string,
    dev?: boolean,
): Promise<{ targetFile: string; name: string; version: string; dev: boolean }> {
    const parsed = parseDependencySpec(dependency);
    const targetFile = await findWorkspacePackageJson(worktreePath, workspace);
    const content = JSON.parse(await fs.readFile(targetFile, 'utf8'));
    const section = dev ? 'devDependencies' : 'dependencies';
    if (!content[section] || typeof content[section] !== 'object') {
        content[section] = {};
    }
    content[section][parsed.name] = parsed.version;
    await fs.writeFile(targetFile, JSON.stringify(content, null, 2) + '\n', 'utf8');
    return { targetFile: path.relative(worktreePath, targetFile).replaceAll('\\', '/'), name: parsed.name, version: parsed.version, dev: Boolean(dev) };
}

async function materializeTaskDependencies(
    repoPath: string,
    worktreePath: string,
    taskId: string,
    options: PrepareTaskDependenciesOptions = {},
): Promise<DependencyPreparation> {
    let addedDependency: { targetFile: string; name: string; version: string; dev: boolean } | undefined;
    if (options.add) {
        addedDependency = await addDependencyToPackageJson(worktreePath, options.add, options.workspace, options.dev);
    }
    const updateLockfile = Boolean(options.updateLockfile || options.add);
    const lockfilePath = path.join(worktreePath, 'pnpm-lock.yaml');
    const workspaceConfigPath = path.join(worktreePath, 'pnpm-workspace.yaml');
    if (!await pathExists(lockfilePath) || !await pathExists(workspaceConfigPath)) {
        throw new Error('task requires pnpm-lock.yaml and pnpm-workspace.yaml to materialize');
    }
    const initialLockfileHash = createHash('sha256').update(await fs.readFile(lockfilePath)).digest('hex');
    const workspaceConfigHash = createHash('sha256').update(await fs.readFile(workspaceConfigPath)).digest('hex');
    const cacheRoot = dependencyCachePath(repoPath, taskId);
    assertSafeDependencyCachePath(repoPath, cacheRoot);
    const cacheMarker = path.join(cacheRoot, '.ia-graft-task-cache.json');
    if (await pathExists(cacheRoot) && !await pathExists(cacheMarker)) {
        throw new Error(`refusing to use unmanaged dependency cache: ${cacheRoot}`);
    }
    await fs.mkdir(cacheRoot, { recursive: true });
    await fs.writeFile(cacheMarker, JSON.stringify({ version: 1, taskId, source: repoPath }));
    const virtualStorePath = path.join(cacheRoot, initialLockfileHash, '.pnpm');

    await unlinkTaskDependencies(worktreePath);
    try {
        const pnpmArgs = [
            'install', '--dir', worktreePath,
            updateLockfile ? '--no-frozen-lockfile' : '--frozen-lockfile',
            '--ignore-scripts', '--prefer-offline',
            '--virtual-store-dir', virtualStorePath, '--reporter', 'append-only',
        ];
        await executePnpm(pnpmArgs, repoPath);
    } catch (error) {
        // A failed pnpm run may leave a partial node_modules. Mark only the
        // directories created by this invocation, remove them through the
        // guarded cleanup, and restore the reusable main-checkout overlay.
        for (const rel of await findNodeModulesDirs(worktreePath)) {
            await fs.writeFile(
                path.join(worktreePath, rel, DEPENDENCY_OVERLAY_MARKER),
                JSON.stringify({ version: 3, source: repoPath }),
            );
        }
        await unlinkTaskDependencies(worktreePath).catch(() => undefined);
        await prepareDependencyOverlays(repoPath, worktreePath, false).catch(() => undefined);
        const summary = capSummary(commandError(error).split(/\r?\n/).slice(-40));
        throw new Error(`pnpm dependency materialization failed: ${summary}`);
    }

    const finalLockfileHash = createHash('sha256').update(await fs.readFile(lockfilePath)).digest('hex');
    const finalWorkspaceConfigHash = createHash('sha256').update(await fs.readFile(workspaceConfigPath)).digest('hex');
    let finalVirtualStorePath = virtualStorePath;
    if (finalLockfileHash !== initialLockfileHash) {
        const newVirtualStoreDir = path.join(cacheRoot, finalLockfileHash);
        const oldVirtualStoreDir = path.join(cacheRoot, initialLockfileHash);
        if (await pathExists(oldVirtualStoreDir) && !await pathExists(newVirtualStoreDir)) {
            try {
                await fs.rename(oldVirtualStoreDir, newVirtualStoreDir);
                finalVirtualStorePath = path.join(newVirtualStoreDir, '.pnpm');
            } catch {
                // If rename fails (e.g. busy on Windows), keep original path
            }
        }
    }

    const relativeDirs = await findNodeModulesDirs(worktreePath);
    const counts = { workspaceLinks: 0, externalLinks: 0, copiedFiles: 0 };
    for (const rel of relativeDirs) {
        const nodeModules = path.join(worktreePath, rel);
        for (const entry of await fs.readdir(nodeModules)) {
            await countDependencyEntry(worktreePath, path.join(nodeModules, entry), counts);
        }
    }
    const virtualStore = path.relative(repoPath, finalVirtualStorePath);
    const marker: DependencyOverlayMarker = {
        version: 3,
        source: repoPath,
        materialized: true,
        lockfileHash: finalLockfileHash,
        workspaceConfigHash: finalWorkspaceConfigHash,
        virtualStore,
        ...counts,
    };
    for (const rel of relativeDirs) {
        await fs.writeFile(path.join(worktreePath, rel, DEPENDENCY_OVERLAY_MARKER), JSON.stringify(marker));
    }
    return {
        linked: true,
        mode: 'workspace-aware',
        overlays: relativeDirs.length,
        ...counts,
        materialized: true,
        lockfileHash: finalLockfileHash,
        workspaceConfigHash: finalWorkspaceConfigHash,
        virtualStore,
        updatedLockfile: finalLockfileHash !== initialLockfileHash,
        ...(addedDependency ? { addedDependency } : {}),
    };
}

async function removeTaskDependencyCache(repoPath: string, taskId: string): Promise<boolean> {
    const target = dependencyCachePath(repoPath, taskId);
    assertSafeDependencyCachePath(repoPath, target);
    if (!await pathExists(target)) return false;
    const markerPath = path.join(target, '.ia-graft-task-cache.json');
    if (!await pathExists(markerPath)) throw new Error(`refusing to remove unmanaged dependency cache: ${target}`);
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8')) as { version?: number; taskId?: string; source?: string };
    if (marker.version !== 1 || marker.taskId !== taskId || !marker.source || !samePath(marker.source, repoPath)) {
        throw new Error(`refusing to remove dependency cache with invalid ownership marker: ${target}`);
    }
    await removeWithRetry(target);
    return true;
}

/** Removes only ia-graft-created node_modules links; it never traverses them. */
async function unlinkTaskDependencies(dir: string): Promise<string[]> {
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
            } else if (await pathExists(path.join(target, DEPENDENCY_OVERLAY_MARKER))) {
                await removeLinkTree(target);
                removed.push(target);
            } else {
                throw new Error(`refusing cleanup of unmanaged dependency directory: ${target}`);
            }
            continue;
        }
        if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== '.git' && entry.name !== '.worktrees') {
            removed.push(...await unlinkTaskDependencies(target));
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
    await unlinkTaskDependencies(target);
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
const MAX_SUMMARY_CHARS = 6_000;
const MAX_SUMMARY_LINE_CHARS = 1_000;

function capSummary(lines: string[]): string {
    const bounded = lines.map((line) => line.length <= MAX_SUMMARY_LINE_CHARS
        ? line
        : `${line.slice(0, MAX_SUMMARY_LINE_CHARS)}...[line truncated]`);
    const joined = bounded.join('\n');
    if (joined.length <= MAX_SUMMARY_CHARS) return joined;
    const marker = '\n...[output truncated]...\n';
    const side = Math.floor((MAX_SUMMARY_CHARS - marker.length) / 2);
    return `${joined.slice(0, side)}${marker}${joined.slice(-side)}`;
}

/**
 * Reduces test-runner output to what actually matters: for node:test's TAP
 * output, the failing test lines plus the summary counters; for anything
 * else (no recognizable TAP summary present), the last 40 lines. Both lines
 * and the final summary are bounded so generated/minified output cannot
 * consume the caller's context budget.
 */
function summarizeTestOutput(output: string): string {
    const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
    const summary = lines.filter((line) => TAP_SUMMARY_LINE.test(line));
    if (summary.length > 0) {
        const failures = lines.filter((line) => TAP_FAILURE_LINE.test(line));
        return capSummary([...failures, ...summary]);
    }
    return capSummary(lines.slice(-40));
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

export async function deleteRemoteBranchWithLease(
    repoPath: string,
    branch: string,
    expectedHead: string,
): Promise<void> {
    if (!branch.startsWith('task/')) throw new Error(`refusing remote deletion outside task/*: ${branch}`);
    if (!/^[a-f0-9]{40}$/i.test(expectedHead)) throw new Error(`invalid expected remote SHA: ${expectedHead}`);
    const remoteRef = `refs/heads/${branch}`;
    await executeGit([
        'push',
        `--force-with-lease=${remoteRef}:${expectedHead}`,
        'origin',
        `:${remoteRef}`,
    ], repoPath);
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
        return shouldInstall
            ? materializeTaskDependencies(this.repoPath, status.worktreePath, taskId, options)
            : prepareDependencyOverlays(this.repoPath, status.worktreePath, false);
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
