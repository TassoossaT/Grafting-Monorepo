# ADR-0015: agent Git write policy

- Status: **Accepted; superseded in place on 2026-08-03 with explicit owner approval.**
- Decision owner: repository-owner
- Record: DEC-053
- Amends: ADR-0010

## Decision

Agents may create forward-only commits and push only inside the deterministic
`task/<TASK-ID>` branch/worktree created or resumed by `tools/ia-graft`.
`ia-graft task commit` is the canonical commit path because it fixes the target
worktree and makes the mutation auditable.

Agents must never:

- commit or push on `main`/`master`;
- force, mirror, bulk, tag or delete remote refs;
- merge, rebase, cherry-pick, revert, amend, reset/discard history or merge a PR;
- commit from the shared main checkout;
- clean another task or abandon dirty/unmerged work without explicit force.

A human remains the only party that merges a PR. Agent commits are proposals
made durable for review; merge is the human approval boundary.

## Rationale

The former absolute ban on agent-authored commits forced progress to remain in
uncommitted shared state and prevented an automated PR lifecycle. Worktree
isolation removes the mixed-tree risk that motivated that ban while preserving
a human merge boundary.

## Enforcement and evidence

`AGENTS.md`, `.ai/coordination/PROTOCOL.md`, the provider-neutral guard and its
tests must agree. The CLI validates task IDs, derives the worktree path, returns
strict JSON, and protects cleanup. A policy change requires explicit owner
approval and matching updates to the decision log, protocol and tests.