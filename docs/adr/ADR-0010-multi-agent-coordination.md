# ADR-0010: provider-neutral task coordination

- Status: **Accepted; replaced in place on 2026-08-03, safety/stack lifecycle amended on 2026-08-04, and dependency isolation/base sync plus controlled materialization amended on 2026-08-05 with explicit owner approval.**
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

Lifecycle recovery is also canonical CLI behavior: an existing local/remote
task branch is reattached when its directory is missing; a reserved orphan
directory is diagnosed and safely repaired; `task doctor` exposes inconsistent
Git/filesystem/PR, dependency-overlay and sync-conflict state; and cleanup detaches
only confirmed dependency links or marked overlays before removing a worktree.
Workspace-aware overlays reuse the main installation but bind workspace packages
to task-local sources. When a task's frozen lockfile contains an external package
absent from that installation, `task deps --install` may materialize it through
the CLI with lifecycle scripts disabled and a per-task, ownership-marked virtual
store under the main checkout. Direct package-manager installation in a worktree
remains forbidden. Agents use `task checkout`/`--restore` for temporary
main-checkout runtime testing rather than manually moving branches or directories.
The pnpm global virtual store is explicitly disabled at workspace level; ia-graft's
per-task store is the single explicit sharing mechanism and cannot drift with pnpm
default changes.

A task may integrate its recorded base only through `task sync`. This operation
is forward-only, refuses dirty state, preserves conflicts for explicit resolution
and records enough local state for `--abort` to undo only its own unfinished
merge. It does not change the human-only pull-request merge boundary.

Review feedback resumes the same task/PR. A distinct task is either independent
from the detected default branch or explicitly dependent through `--parent`,
which creates a normal stacked branch and PR base without rebasing. Parent/base
intent is stored in local Git branch config and validated against the PR; it is
derived operational metadata, not a second committed task registry.

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
- one open PR maps back to the same deterministic task for review follow-up;
- dependent tasks name an explicit parent; independent tasks use the repository's detected default branch;
- filesystem cleanup is limited to a validated `.worktrees/<TASK-ID>` target and never traverses shared dependency links;
- no agent pushes or commits on `main`/`master`;
- no history rewriting or agent-side PR merge; recorded-base integration is allowed only through the forward-only `task sync` flow;
- cleanup refuses dirty or unmerged work unless abandonment is explicit;
- CLI stdout is one JSON object; diagnostics belong in returned data or stderr;
- changes to this control plane require explicit owner approval.

## Superseded mechanism

The earlier `.ai/state/tasks` and `.ai/state/handoffs` mechanism, single-owner
records and `affected_paths` enforcement are retired. Historical references are
not live requirements.
