/**
 * Deciding whether a task's remote branch is safe to delete, and deleting it.
 *
 * Deletion is planned before it is performed, and the plan has to carry proof
 * that the branch actually merged -- a cleanup must never be the thing that
 * loses work.
 */

import { executeGit } from "./exec.ts";



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
