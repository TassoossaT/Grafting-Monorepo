/**
 * Running child processes for the git layer, and compacting what they print.
 *
 * Test output is summarized rather than forwarded: a task command should
 * spend the caller's tokens on the result, not on the transcript.
 */

import { exec, execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

export const execFileAsync = promisify(execFile);

export const execAsync = promisify(exec);

/** A pull request that already exists for a task branch, as `gh pr view` reports it. */

export function envWithGhFallbackPath(): NodeJS.ProcessEnv {
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

export const TAP_SUMMARY_LINE = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/;

export const TAP_FAILURE_LINE = /^not ok\b/;

export const MAX_SUMMARY_CHARS = 6_000;

export const MAX_SUMMARY_LINE_CHARS = 1_000;

export function capSummary(lines: string[]): string {
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

export function summarizeTestOutput(output: string): string {
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

export async function executeGit(args: string[], cwd: string): Promise<string> {
    try {
        const { stdout, stderr } = await execFileAsync('git', args, { cwd });
        return stdout.trim();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`git ${args[0]} failed: ${detail}`);
    }
}
