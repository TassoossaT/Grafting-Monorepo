# ADR-0015: agent Git write policy

- Status: **Accepted; superseded in place on 2026-08-03, safe checkout/stack lifecycle amended on 2026-08-04, controlled base sync amended on 2026-08-05, and a documentation-only direct-commit exception amended on 2026-08-07, each with explicit owner approval.**
- Decision owner: repository-owner
- Record: DEC-053
- Amends: ADR-0010

## Decision

Agents may create forward-only commits and push only inside the deterministic
`task/<TASK-ID>` branch/worktree created or resumed by `tools/ia-graft`.
`ia-graft task commit` is the canonical commit path because it fixes the target
worktree and makes the mutation auditable.

One exception, added 2026-08-07: a **documentation-only** change commits and
pushes directly on `main`/`master`, with no task, branch, or pull request. It
qualifies only when every touched file is Markdown prose and none lives under
`docs/generated/`. A single non-Markdown file disqualifies the whole change.
Protocol, registry, and policy documents are included, but their standing
requirement of explicit owner approval moves *ahead* of the commit, since
this path has no review gate behind it.

Agents must never:

- commit or push on `main`/`master`, except for the documentation-only
  change defined above;
- force, mirror, bulk, tag or delete remote refs;
- invoke raw merge, rebase, cherry-pick, revert, amend, reset/discard history or merge a PR;
- commit from the shared main checkout;
- clean another task or abandon dirty/unmerged work without explicit force.

A human remains the only party that merges a PR. Agent commits are proposals
made durable for review; PR merge is the human approval boundary.

`ia-graft task sync` is the sole exception for integrating a task's recorded
base. It may fast-forward the task branch or create a forward merge commit,
but it refuses dirty state, never rewrites commits, never targets another
source, and records unfinished conflict state. Its `--abort` form is allowed
only while that recorded CLI merge is unfinished. Direct `git merge` and all
other history-integration commands remain forbidden to agents.

`ia-graft task checkout` may temporarily place a clean task branch in a clean
main checkout solely for local runtime testing. The CLI records the previous
branch and recreates the linked task worktree on `--restore`; task commit and
other Git mutations remain forbidden there. A dirty restore is refused unless
`--force` explicitly discards only that task checkout's uncommitted files.
Explicit `task cleanup --force` is
the supported abandonment path and must apply the same validated, link-safe
filesystem removal as post-merge cleanup.

Dependent `--parent` tasks are forward-only branches whose PR base is their
parent branch. This does not authorize cascading rebase, force-with-lease or
agent-side stack merge. GitHub's Stacked PR preview may only be adopted through
a later explicit policy decision because its synchronization workflow rewrites
branch history.

## Rationale

The former absolute ban on agent-authored commits forced progress to remain in
uncommitted shared state and prevented an automated PR lifecycle. Worktree
isolation removes the mixed-tree risk that motivated that ban while preserving
a human merge boundary.

The documentation-only exception exists because the ceremony's cost had grown
larger than its benefit for prose. A worktree, a branch, a PR, and a merge for
a paragraph in a research document bought no isolation worth having: Markdown
prose builds nothing, breaks no contract, fails no test, and conflicts
textually rather than semantically. The mixed-tree risk the task flow protects
against comes from source and configuration, so the exception is drawn exactly
there — at the file-type boundary, not at a subjective size threshold that
each agent would interpret differently. Tasks are reserved for heavy work.

## Enforcement and evidence

`AGENTS.md`, `.ai/coordination/PROTOCOL.md`, the provider-neutral guard and its
tests must agree. The guard
(`tools/scripts/agent-task-guard.mjs`) still denies every push to
`main`/`master` and therefore does not yet implement the documentation-only
exception; until it does, the canonical instructions above are ahead of the
enforcement, and a documentation-only push is expected to be refused by the
guard. Closing that gap is tracked as its own task, since it changes a script
and its tests. The CLI validates task IDs, derives the worktree path, returns
strict JSON, and protects cleanup. A policy change requires explicit owner
approval and matching updates to the decision log, protocol and tests.
