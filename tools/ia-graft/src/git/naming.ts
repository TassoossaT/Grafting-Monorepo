/**
 * Where a task's worktree and branch live, and the guards that keep an
 * operation from escaping them.
 *
 * Every path a task command touches is derived here and validated here:
 * nothing else in the git layer builds a `.worktrees/<ID>` path by hand, so
 * a delete can only ever land inside a directory this module vouched for.
 */

import { realpathSync } from 'fs';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { execFileAsync } from "./exec.ts";

export function worktreePathForTask(repoPath: string, taskId: string): string {
    return path.join(repoPath, '.worktrees', taskId);
}

export function branchNameForTask(taskId: string): string {
    return `task/${taskId}`;
}

export function appendPullRequestSection(existingBody: string, addition: string): string {
    const current = existingBody.trimEnd();
    const next = addition.trim();
    if (current.length === 0) return next;
    return `${current}\n\n---\n\n## Update\n\n${next}`;
}

export function relativeInside(parent: string, child: string): string | undefined {
    const relative = path.relative(canonicalPath(parent), canonicalPath(child));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    return relative;
}

export function workspaceRelativeTarget(repoPath: string, resolvedTarget: string): string | undefined {
    const relative = relativeInside(repoPath, resolvedTarget);
    if (!relative) return undefined;
    const segments = relative.split(path.sep);
    if (segments.includes('node_modules') || segments[0] === '.git' || segments[0] === '.worktrees') return undefined;
    return relative;
}

export async function removeLinkTree(target: string): Promise<void> {
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

export async function removeWithRetry(target: string, attempts = 5, delayMs = 300): Promise<void> {
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

/**
 * One path's canonical on-disk identity, for comparison.
 *
 * `path.resolve` alone is not enough. It normalises separators and case but
 * expands no Windows 8.3 short name, follows no junction and no symlink --
 * so two names for one directory compare as different:
 *
 * ```
 * os.tmpdir()               C:\Users\TASSO~1.PIM\AppData\Local\Temp
 * fs.realpathSync.native()  C:\Users\tasso.pimenta\AppData\Local\Temp
 * ```
 *
 * `git worktree list` always answers with the long form, so a caller that
 * reached the repository by the short one was told its own registered
 * worktree was "an orphan directory" whose branch was "checked out in an
 * unexpected worktree" -- naming the very path it had just asked about.
 *
 * A path is routinely compared before it exists (a worktree about to be
 * created), and an absent path has no real form, so the deepest ancestor
 * that does exist is canonicalised and the remaining segments re-appended.
 * That is what lets a to-be-created child of a short-named parent still
 * match.
 */

export function canonicalPath(target: string): string {
    const resolved = path.resolve(target);
    let current = resolved;
    const trailing: string[] = [];
    for (;;) {
        try {
            return path.join(realpathSync.native(current), ...trailing);
        } catch {
            const parent = path.dirname(current);
            // A root that cannot be realpath'd leaves nothing further to
            // try; the lexical form is then the best identity available.
            if (parent === current) return resolved;
            trailing.unshift(path.basename(current));
            current = parent;
        }
    }
}

export function samePath(left: string, right: string): boolean {
    return path.relative(canonicalPath(left), canonicalPath(right)) === '';
}

export function assertSafeTaskPath(repoPath: string, target: string): void {
    const root = path.resolve(repoPath, '.worktrees');
    const resolved = path.resolve(target);
    if (samePath(resolved, repoPath) || samePath(resolved, root) || !samePath(path.dirname(resolved), root)) {
        throw new Error(`refusing filesystem mutation outside one deterministic task path: ${resolved}`);
    }
}

export async function pathExists(target: string): Promise<boolean> {
    try { await fs.lstat(target); return true; }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

/** The overlay marker file, and the cache directory a task's mirrored dependencies live in. */
export const DEPENDENCY_OVERLAY_MARKER = '.ia-graft-overlay.json';
export const DEPENDENCY_CACHE_DIR = '.ia-graft-task-deps';

/**
 * Tears down every dependency link inside a task worktree, so the worktree
 * itself can then be removed. Refuses a node_modules directory that carries
 * no overlay marker: an unmanaged one is somebody's real install.
 */
export async function unlinkTaskDependencies(dir: string): Promise<string[]> {
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

export function dependencyCachePath(repoPath: string, taskId: string): string {
    return path.join(repoPath, 'node_modules', DEPENDENCY_CACHE_DIR, taskId);
}

export function assertSafeDependencyCachePath(repoPath: string, target: string): void {
    const root = path.resolve(repoPath, 'node_modules', DEPENDENCY_CACHE_DIR);
    const resolved = path.resolve(target);
    if (!samePath(path.dirname(resolved), root)) {
        throw new Error(`refusing dependency-cache mutation outside one deterministic task path: ${resolved}`);
    }
}

export async function windowsMirrorEmpty(target: string): Promise<void> {
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

export async function safeRemoveTaskDirectory(repoPath: string, target: string): Promise<void> {
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

export interface WorktreeRecord { path: string; branch?: string; head?: string }

export function parseWorktrees(output: string): WorktreeRecord[] {
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

export function commandError(error: unknown): string {
    const value = error as { stderr?: string; stdout?: string; message?: string; code?: string };
    return value.stderr?.trim() || value.stdout?.trim() || value.message || (value.code === 'ENOENT' ? 'command not found' : String(error));
}
