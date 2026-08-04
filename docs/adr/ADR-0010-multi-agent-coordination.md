# ADR-0010: provider-neutral task coordination

- Status: **Accepted; replaced in place on 2026-08-03 with explicit owner approval.**
- Decision owner: repository-owner
- Records: DEC-031, DEC-048
- Related: ADR-0015

## Decision

A task's canonical operational state is derived from Git and GitHub, not copied
into task or handoff files. `tools/ia-graft` owns the lifecycle:

- task identity: `task/<TASK-ID>`;
- isolated workspace: `.worktrees/<TASK-ID>`;
- durable progress: forward-only commits on that branch;
- review and cross-agent coordination: the pull request, its commits and comments;
- completion: merged PR, followed by verified worktree cleanup.

`task new` creates or resumes the same deterministic task. `task status` derives
state from the worktree and Git. `task done` pushes and creates a PR, or returns
the existing PR after review follow-up commits. No task JSON, ownership ledger,
or immutable handoff record is authoritative. Provider chat remains private and
non-authoritative.

Concurrent tasks use distinct worktrees. Overlap is resolved visibly by Git/PR
review rather than duplicated file-ownership state. Vendor adapters point to
`AGENTS.md` and the protocol and may enforce the Git safety subset.

## Rationale and trade-offs

This removes high-volume state files, repeated handoffs and synchronization
reads. The cost is that agents must leave resumable information in commits or
the PR when context is not evident from the diff. Git conflicts occur later
than pre-emptive path locks, but they are canonical, reviewable and do not need
a second coordination database.

## Invariants

- one deterministic worktree and branch per task ID;
- no agent pushes or commits on `main`/`master`;
- no history rewriting or agent-side PR merge;
- cleanup refuses dirty or unmerged work unless abandonment is explicit;
- CLI stdout is one JSON object; diagnostics belong in returned data or stderr;
- changes to this control plane require explicit owner approval.

## Superseded mechanism

The earlier `.ai/state/tasks` and `.ai/state/handoffs` mechanism, single-owner
records and `affected_paths` enforcement are retired. Historical references are
not live requirements.