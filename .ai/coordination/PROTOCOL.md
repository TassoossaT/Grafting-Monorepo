# Multi-agent coordination protocol

This protocol is the canonical Phase 1 communication mechanism for Claude,
Codex, Gemini, and future providers. Coordination is a Git worktree + branch
per task, managed by `tools/ia-graft`, not a JSON record. A project-scoped
Claude Code hook enforces the Git-safety half of this protocol at runtime; it
is a vendor adapter, not a second source of policy.

## Authority

This is the single source for the required-reading precedence order; root
`AGENTS.md`'s "Required reading" section points here instead of restating it.
The precedence order remains:

1. `GRAFTING_MASTER_SOURCE.md`;
2. accepted ADRs;
3. root and nearest scope-local `AGENTS.md`;
4. implemented code, manifests, schemas, and Graph IR evidence;
5. provider adapters and private chat context.

Historical build-log/journal content (what was done, when, and why) lives in
`docs/history/PLANNING_LOG.md` — an archive, not part of this precedence
order.

## ia-graft: the task-lifecycle CLI

`tools/ia-graft` (strict JSON in/out, `node --experimental-strip-types
tools/ia-graft/src/bin.ts <command> --input '<json>'`) is the only
coordination mechanism. There is no task JSON, no handoff record, and no
ADR-per-task.

- `guard-check` — ask "would `<tool>` on `<path>`/`<command>` be allowed"
  before attempting it; returns `{ok, allowed, reason}`.
- `task new --id <TASK-ID> --title <title> [--base main]` — creates an
  isolated Git worktree (`.worktrees/<TASK-ID>`) and branch
  (`task/<TASK-ID>`) off `origin/<base>`.
- `task done --id <TASK-ID> --title <title> --body <body> [--base main]` —
  pushes the branch and opens a pull request via `gh pr create`. Leaves the
  worktree in place for any follow-up review commits.
- `task cleanup --id <TASK-ID>` — after the PR has merged, removes the
  worktree directory and prunes Git metadata. The remote branch is left
  intact deliberately.

## Starting work

1. Decide whether the change is a direct/simple edit (see `AGENTS.md`'s "What
   counts as a direct/simple edit") or a full task.
2. Direct/simple edit: edit the main checkout, commit directly.
3. Otherwise: `ia-graft task new --id <TASK-ID> --title <title>`, then work
   only inside the printed worktree path. Pick `<TASK-ID>` so it doesn't
   collide with another agent's in-flight worktree (check
   `git worktree list` / open branches named `task/*` first).
4. Commit inside the worktree as you make progress — there is no
   "declare then batch-commit at the end" step; commit early and often.
5. When the task is complete, `ia-graft task done --id <TASK-ID> --title
   <title> --body <body>` opens the pull request. A human reviews and merges
   it; once merged, `ia-graft task cleanup --id <TASK-ID>` removes the
   worktree.

Isolation between agents comes entirely from separate worktrees/branches. If
two agents need to touch the same area, that surfaces as a normal Git merge
conflict on the PR, not as a pre-emptive file-ownership check.

## Runtime enforcement adapter

`.claude/settings.json` registers a `PreToolUse` hook for `Write`, `Edit`, and
`Bash`, calling the provider-neutral `tools/scripts/agent-task-guard.mjs` with
the canonical agent ID `claude`. The guard enforces only Git-safety rules — it
has no concept of tasks, ownership, or file scope:

- `Write`/`Edit` is allowed anywhere inside the repository (plus the
  harness's own memory/plan directories under `.claude/`, which live outside
  any repository).
- `Bash` is allowed except for the Git write policy below, which the guard
  checks regardless of current directory.

Project hooks can be disabled by a user's higher-precedence local Claude
settings. Verify the active `Project` hook through Claude Code's `/hooks`
screen.

## Git write policy

Agents commit forward on their own task branch as they work — that is the
whole point of the worktree-per-task model. Agents never rewrite or discard
history and never merge.

Agents may:

- inspect Git state and history;
- commit on their own task branch (created by `ia-graft task new`);
- fetch and use `git pull --ff-only` when otherwise authorized;
- push their own task branch;
- prepare or open a pull request (`ia-graft task done` does this via `gh`).

Agents never push to `main` or `master`, never force/bulk/mirror/tag/delete
remote refs, never run `merge`/`rebase`/`cherry-pick`/`revert`/history-editing
commands, and never merge a pull request (`gh pr merge`). The repository
owner remains the only party who may merge a task's pull request.

The provider-neutral task guard enforces this policy for every provider that
adopts its runtime adapter. Canonical instructions govern providers without
an adapter.

## Before opening the pull request

Whether the change was a direct/simple edit or a full task, before running
`ia-graft task done` (or, for a direct edit, before considering it finished):

1. Run the validations the change actually calls for (format, lint,
   typecheck, tests, build — whatever applies).
2. If the change touches a documented project's `src/` (TypeScript:
   `packages/*`, `apps/*`; Rust: `libs/**`), regenerate that project's
   API-reference evidence in `docs/generated/api/` and run the
   `docs-quality-check` skill against it. Scope the regeneration to the
   project(s) actually touched:
   `node tools/scripts/generate-api-docs.mjs <name>` /
   `node tools/scripts/generate-rust-api-docs.mjs <name>`, or the matching
   `nx run <project>:docs-generate` target where one already exists.
3. If the change touches a `docs/research/*.md` file other than
   `docs/research/RESEARCH-DECISIONS-REGISTRY.md` itself, and it changed a
   candidate's status (adopted, discarded, standby/deferred), update that
   candidate's row in the registry — it is hand-maintained, no script runs
   it.
4. If the change includes code copied or adapted from an external
   open-source project, add the header marker `Adapted from <Project Name>
   (<source URL>). Original license: <SPDX-License-Identifier>. See
   THIRD_PARTY_NOTICES.md.` to the top of that file, add a matching entry to
   `THIRD_PARTY_NOTICES.md`, and run
   `node tools/scripts/check-third-party-notices.mjs`.

Steps 2-4 have `PostToolUse` reminder hooks in `.claude/settings.json`
(`research-registry-reminder.mjs`, `third-party-attribution-reminder.mjs`)
that nudge inline right after a relevant edit; they only remind and never
block or edit anything themselves.

## Documentation size

`node tools/scripts/check-doc-organization.mjs` reports every authored
Markdown document that has grown "large" or "colossal"
(`tools/scripts/doc-size.mjs`'s thresholds) — run it occasionally to decide
whether a document needs splitting into a router plus linked sub-documents.
A `PostToolUse` hook (`tools/scripts/doc-size-reminder.mjs`) gives the same
reminder inline right after an edit crosses a threshold.

## Rollback

Roll back the Claude enforcement adapter by removing its `PreToolUse` entry
from `.claude/settings.json` and reverting the guard script's tracked
changes. Rolling back a task means abandoning its worktree/branch (`ia-graft
task cleanup`, or a manual `git worktree remove`) — never delete another
agent's in-flight worktree or branch.
