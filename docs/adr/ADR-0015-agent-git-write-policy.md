# ADR-0015: agent Git write policy

- Status: Accepted
- Proposal date: 2026-07-29
- Decision date: 2026-07-29
- Record: DEC-053
- Backlog item: AI-GIT-SAFETY-001
- Related gate: None
- Supersedes: None
- Amends: ADR-0010
- Related: None
- Decision owner: repository-owner
- Source task: AI-GIT-SAFETY-001

## Summary

AI agents may inspect Git, prepare uncommitted changes, create isolated
branches, and assist with pull requests, but they never create or merge a Git
commit. Only humans commit, and the default branch is never an agent push
target.

## Context

Claude, Codex, Gemini, and future providers share one working repository. Task
ownership prevents overlapping edits, but it does not prevent an agent from
creating a commit that mixes unrelated human or agent changes, obscures review,
or writes directly to the protected branch. The repository owner explicitly
requires human control over every commit while retaining read-only Git tools,
isolated branches, and pull-request assistance.

The first instruction was intentionally interpreted strictly: agents are
prohibited from committing on every branch, not merely on `main`. The owner's
permission to use isolated branches and pull requests applies to preparation,
review, and transport of commits already authored by a human; it is not an
exception that lets an agent manufacture a commit.

## Scope

### In scope

- Git commands executed by AI agents in this repository.
- Agent branches, remote pushes, and pull-request creation/merge behavior.
- Canonical instructions and provider runtime enforcement adapters.

### Out of scope

- Human Git commands and human-authored commits.
- Repository-host branch-protection configuration outside this repository.
- Publishing, release, or production credentials.

## Decision drivers

- The repository owner must review and author every durable Git history entry.
- Multiple agents share a dirty working tree and must not capture unrelated work in commits.
- Read-only Git diagnostics must remain available.
- Isolated branches and pull-request workflows must remain usable around human-authored commits.
- Enforcement must not block ordinary human Git clients.

## Options considered

### Option A: prohibit only direct commits to the default branch

Agents could commit freely on feature branches and open pull requests. This is
convenient but contradicts the owner's broad prohibition and still lets an
agent make unreviewed history from a mixed working tree.

### Option B: prohibit every agent-authored commit

Agents prepare uncommitted changes or patches. They may use an isolated branch
and assist with a PR only when its commits were authored by a human. This keeps
all durable history under human control and is the accepted interpretation.

### Option C: install a repository-wide pre-commit hook

A Git hook could reject commits mechanically, but it cannot reliably
distinguish an agent from the repository owner and would obstruct authorized
human commits. It is rejected.

## Decision

Option B is accepted. AI agents never run operations that create, amend,
rewrite, merge, or implicitly produce Git commits. This includes `git commit`,
non-fast-forward merge/pull behavior, merge, rebase, cherry-pick, revert,
stash, commit-producing plumbing, and pull-request merge operations.

Agents may inspect and stage Git state, create or switch to an isolated
`ai/<agent>/<task-id>` branch, fetch, use `git pull --ff-only` when otherwise
authorized, and prepare or open a pull request containing human-authored
commits. An agent may push only an explicit isolated `ai/...` branch and never
push to `main` or `master`, force/mirror/bulk/tag/delete remote refs, or merge a
pull request.

This rule is canonical for every provider. The existing provider-neutral task
guard enforces it for Claude's configured runtime adapter. Other providers must
obey the canonical files and may add equivalent thin adapters only through an
owner-approved task.

## Consequences

### Positive

- Every durable Git history entry remains human-authored and human-reviewed.
- An agent cannot accidentally commit unrelated dirty-worktree changes.
- Default-branch writes and agent-side PR merges are explicitly prohibited.
- Git inspection, branch isolation, and PR assistance remain available.

### Costs and trade-offs

- A human must create commits before a PR can contain new work.
- Providers without a runtime guard rely on canonical instruction compliance.
- Some normally recoverable Git workflows, such as stash or cherry-pick, are unavailable to agents.

## Compatibility and migration

No source code, persisted product data, public package API, or ABI changes.
The operational contract, coordination protocol, policy registry, and Claude
runtime guard are updated atomically. Existing commits and branches are not
rewritten.

## Validation and evidence

- Acceptance criterion: the guard rejects direct and implicit commit operations even with an active task.
- Acceptance criterion: pushes to `main`/`master`, implicit pushes, forced pushes, and PR merges are rejected.
- Acceptance criterion: read-only Git commands and isolated branch creation remain allowed under normal task ownership.
- Evidence: `tools/scripts/agent-task-guard.test.mjs`.
- Evidence: `.ai/coordination/PROTOCOL.md` and root `AGENTS.md`.

## Risks

- Textual shell inspection cannot cover an intentionally obfuscated command; canonical agent compliance remains mandatory.
- A provider without an installed adapter has procedural rather than mechanical enforcement.
- External repository-host settings may still permit writes; agents are prohibited regardless of remote permissions.

## Rollback

The repository owner may supersede this ADR with another explicit decision.
Rollback must remove or amend the matching canonical instructions, policy
registry entry, runtime tests, and guard logic together; agents may not weaken
their own Git restrictions.

## Follow-up work

- Add equivalent provider runtime adapters only when the provider exposes a reliable project-level hook.
- Keep repository-host branch protection as an independent human-administered safeguard.
