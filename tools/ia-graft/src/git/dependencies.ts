/**
 * Making a task worktree's dependencies usable without a raw package-manager
 * run inside it.
 *
 * A worktree gets directory overlays mirrored from the main checkout, which
 * is what keeps the lockfile from drifting per task. Adding a package edits
 * the workspace manifest and re-materializes the overlay.
 */

import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { capSummary, execFileAsync } from "./exec.ts";
import { assertSafeDependencyCachePath, commandError, DEPENDENCY_CACHE_DIR, DEPENDENCY_OVERLAY_MARKER, dependencyCachePath, pathExists, removeLinkTree, removeWithRetry, samePath, unlinkTaskDependencies, workspaceRelativeTarget } from "./naming.ts";



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

export interface DependencyOverlayMarker {
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

export async function findNodeModulesDirs(dir: string, relBase = ''): Promise<string[]> {
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
/**
 * Canonical on both sides, for the same reason {@link samePath} is: the
 * child here is typically a `realpath` of a link and therefore already in
 * long form, while the parent is whatever name the caller reached the
 * repository by. Comparing those two lexically read every workspace link as
 * external, so a task worktree silently rebound its own packages back to the
 * main checkout.
 */

export async function mirrorDependencyEntry(
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

export async function readMaterializedPreparation(repoPath: string, worktreePath: string): Promise<DependencyPreparation | undefined> {
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

export async function dependencyMode(worktreePath: string): Promise<DependencyMode> {
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

export async function prepareDependencyOverlays(
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

export const GENERATED_WORKSPACE_ARTIFACT_DIRS = [
    // FlatBuffers generated contracts
    'libs/engine/domain-core/src/generated',
    'packages/isekai-web-client/src/generated',
    'dotnet/Grafting.Isekai.Protocol/Generated',
    // Wasm packages
    'libs/domains/procgen/construction-wasm/pkg',
    'libs/domains/procgen/discretize/pkg',
    'libs/domains/procgen/generation-wasm/pkg',
    'libs/domains/procgen/terrain-quantization/pkg',
    'libs/domains/procgen/tileset-wfc/pkg',
    'libs/isekai/wasm-bridge/pkg',
    // Package dist builds needed by sibling workspace packages
    'packages/render-3d/dist',
    'packages/ui/dist',
    'packages/x6-canvas/dist',
];

/**
 * Ensures gitignored generated artifacts from the main checkout are mirrored
 * into the task worktree so build tools and doc generators do not fail on missing
 * contracts, Wasm packages, or sibling package dist directories.
 */

export async function mirrorGeneratedArtifacts(repoPath: string, worktreePath: string): Promise<void> {
    for (const rel of GENERATED_WORKSPACE_ARTIFACT_DIRS) {
        const source = path.join(repoPath, rel);
        const target = path.join(worktreePath, rel);
        if (!await pathExists(source) || await pathExists(target)) continue;
        await fs.mkdir(path.dirname(target), { recursive: true });
        try {
            const stat = await fs.stat(source);
            await fs.symlink(source, target, stat.isDirectory() ? 'junction' : 'file');
        } catch {
            try {
                await fs.cp(source, target, { recursive: true });
            } catch { /* best-effort fallback */ }
        }
    }
}

/**
 * Retries a recursive removal a few times with backoff before giving up.
 * Windows can hold a directory handle open briefly after a process that ran
 * inside it (tsc, a test runner) exits, surfacing as a transient EBUSY/EPERM
 * on the very next `fs.rm` rather than a real, permanent failure.
 */

export async function countDependencyEntry(
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

export async function executePnpm(args: string[], cwd: string): Promise<void> {
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

export async function findWorkspacePackageJson(worktreePath: string, workspace?: string): Promise<string> {
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

export async function addDependencyToPackageJson(
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

export async function materializeTaskDependencies(
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

export async function removeTaskDependencyCache(repoPath: string, taskId: string): Promise<boolean> {
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

