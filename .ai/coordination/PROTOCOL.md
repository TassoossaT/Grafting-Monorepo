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

`tools/ia-graft` is the only
coordination mechanism. There is no task JSON, no handoff record, and no
ADR-per-task.

- `guard-check` — ask "would `<tool>` on `<path>`/`<command>` be allowed"
  before attempting it; returns `{ok, allowed, reason}`.
- `task new --id <TASK-ID> [--base <branch> | --parent <PARENT-TASK-ID>]` — resolves
  the repository's real default branch when no base is supplied, first sweeps `.worktrees/` for
  already-merged tasks and cleans them up silently (see `task sweep` below;
  a sweep failure never blocks creating the task actually being asked for),
  then creates or resumes an isolated Git worktree (`.worktrees/<TASK-ID>`) and branch
  (`task/<TASK-ID>`). It reattaches an existing local/remote task branch when its
  worktree is missing, safely repairs a reserved orphan directory left by an incomplete
  Windows removal, and records the task's intended base in local Git branch config.
  It refuses to resume an ID whose PR is already closed or merged; subsequent work
  gets a new ID from the current default branch instead of extending stale/squashed history.
  `--parent` creates a dependent branch from the parent's current local HEAD and records
  the parent branch as the child's PR base; omit it for independent work. It links every `node_modules` in
  the tree (root and each nested package, pnpm-workspace style) from the
  main checkout into it — a plain `git worktree add` never brings gitignored
  dependency trees, which breaks `tsc`/most tests otherwise. Only reports
  success once linked (or once confirmed the main checkout itself has no
  `node_modules` to give).
  Shared dependency junctions are read-only operationally: never run `pnpm/npm/yarn/bun install/add/remove/update` inside a task worktree; install only in the main checkout. `task test` rejects these commands.
- `task resume --id <TASK-ID>` / `task resume --pr <number>` — explicitly resumes
  an existing task. PR-based resume derives the canonical task ID, head and base from
  GitHub and refuses closed/merged PRs, so requested changes stay on the same PR.
- `task commit --id <TASK-ID> --message <msg> [--file <path>]...` — stages
  (all changed files, or a given subset) and commits inside that worktree.
- `task test --id <TASK-ID> --command <cmd>` — runs a test/check command
  inside the worktree and returns a compact pass/fail summary (node:test's
  TAP summary + failures, or the last 40 lines for any other runner)
  instead of the raw transcript — spend tokens on the result, not the log.
- `task done --id <TASK-ID> --title <title> --body <body> [--base <branch>]` —
  pushes the branch and opens a pull request via `gh pr create`. If `gh` is
  missing or unauthenticated, it still pushes and returns
  `{prState: "manual", prUrl: <manual compare URL>}` instead of failing. Leaves
  the worktree in place for any follow-up review commits. Any other `gh pr create`
  failure is explicit with its stderr; it is never mislabeled as a manual fallback.
  The recorded base is validated, and the first push sets the task branch's own upstream.
- `task status --id <TASK-ID>` / `task doctor --id <TASK-ID>` — derives local and
  remote branch existence, registered worktree, on-disk directory, orphan/mismatch,
  dirty state, HEAD, parent/base and PR from Git/GitHub. `doctor` adds health and a
  recommended recovery action; no committed task/status file is written.
- `task checkout --id <TASK-ID>` / `task checkout --restore [--force]` — temporarily moves a
  clean task branch from its linked worktree into a clean main checkout for local
  runtime testing, then restores the prior branch and recreates the linked worktree.
  Commits remain forbidden from the main checkout. Restore refuses generated or
  edited task files unless `--force` explicitly discards them before switching back.
- `task graph` — reports the default branch and local `task/*` branches with their
  recorded parent/base, HEAD and worktree location for Source Control/agent discovery.
- `task cleanup --id <TASK-ID> [--force]` — after the PR has merged, removes the
  worktree directory (retrying briefly on a transient Windows file-lock) and
  prunes Git metadata. Cleanup validates the exact reserved target and removes only
  confirmed shared `node_modules` links/junctions before recursive deletion, with a
  long-path Windows fallback that cannot traverse those links. Without `--force`,
  dirty or unmerged tasks are refused. Force means explicit abandonment and is the
  supported way to discard an unmerged task. The remote branch is left intact deliberately.
- `task sweep` — checks every worktree under `.worktrees/` against `gh` and
  cleans up (worktree + local branch) whichever ones already have a merged
  PR. `task new` already calls this itself before creating anything, so
  nobody needs to invoke it directly — it's exposed as its own subcommand
  only for manual/debugging use. Anything `gh` can't confirm as merged is
  left alone and reported as skipped — it never guesses from local branch
  topology alone (a brand-new, not-yet-committed-to branch is trivially "an
  ancestor" of anything the base branch merges later too, so that check
  can't tell "merged" apart from "never touched").

## Starting work

1. Decide whether the change is a direct/simple edit (see `AGENTS.md`'s "What
   counts as a direct/simple edit") or a full task — either way, it goes
   through a task branch and a PR; only the ceremony differs (a direct/simple
   edit skips required-reading and gets a terser title/body). Never commit
   on `master`/`main` directly, with no exception.
2. Classify the request before creating anything: requested changes on an open
   PR use `task resume --pr <number>` (or the same task ID); independent work
   uses `task new --id <TASK-ID>`; work that truly depends on an unmerged task
   uses `task new --id <TASK-ID> --parent <PARENT-TASK-ID>`. Never create a new
   task merely because review feedback arrived.
3. Then work only inside the printed
   worktree path. Pick `<TASK-ID>` so it doesn't collide with another
   agent's in-flight worktree (check `git worktree list` / open branches
   named `task/*` first).
4. `ia-graft task commit --id <TASK-ID> --message <msg>` as you make
   progress — there is no "declare then batch-commit at the end" step;
   commit early and often, never with raw `git commit` in the main checkout.
5. Before opening the PR, run the change's own tests via
   `ia-graft task test --id <TASK-ID> --command <cmd>` — it returns a
   compact pass/fail summary, not the raw transcript.
6. When the task is ready for review, `ia-graft task done --id <TASK-ID> --title
   <title> --body <body>` pushes the branch and opens the pull request (via
   `gh`, when available — otherwise it still pushes and returns a manual
   compare URL). During review, run `task resume --pr <number>` (or `task new --id <TASK-ID>`) to resume, commit requested changes, test, and run `task done` again; it returns the existing PR. A human merges it; once merged,
   `ia-graft task cleanup --id <TASK-ID>` removes the
   worktree.

Isolation between agents comes entirely from separate worktrees/branches. If
two agents need to touch the same area, that surfaces as a normal Git merge
conflict on the PR, not as a pre-emptive file-ownership check.

Dependent tasks use ordinary stacked branches/PR bases while retaining one
worktree per agent. The official GitHub Stacked PR preview is not part of this
contract: its cascading rebase and force-with-lease behavior conflicts with the
forward-only policy below. Adopting it requires a separate owner-approved policy
change; `--parent` itself never rebases or force-pushes.

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
changes. Rolling back a task means abandoning its worktree/branch with
`ia-graft task cleanup --id <TASK-ID> --force` — never use an ad-hoc filesystem
or Git deletion path, and never delete another
agent's in-flight worktree or branch.
