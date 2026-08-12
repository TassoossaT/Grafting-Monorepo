# AGENTS.md — Grafting Monorepo operational contract

This file defines how agents must work in this repository.

Tasks are created, isolated, and finished exclusively through `tools/ia-graft`
(see `.ai/coordination/PROTOCOL.md`). There is no task JSON, no ADR-per-task,
and no manual status tracking — see `Task-based work` below.

## Required reading

Before structural work, read the sources in the precedence order defined once
in `.ai/coordination/PROTOCOL.md`'s `Authority` section (do not restate that
order here — it is the single source and the two must never drift apart). A
genuinely small, direct edit (see `Task-based work` below) does not need this
full pass.

"Read `GRAFTING_MASTER_SOURCE.md`" means read its section 0 — the normative
layer and the precedence rule — and then use its S0.4 router table to fetch
only the sections the task actually needs. Most section bodies now live in
`docs/architecture/`; the router says which file holds which. Reading the
whole chain end to end was never the intent and is now avoidable.

## Initial state

While `docs/decisions/GATES.md` still has open Decision Gates and the
monorepo's native toolchains are not yet fully scaffolded:

- do not treat planned directories as real files;
- do not assume Git, CI, Nx, Cargo, pnpm, uv, or .NET are already configured;
- do not invent command output;
- do not declare an implementation complete;
- produce plans, ADRs, spikes, and verifiable criteria.

## Mandatory rules

The agent MUST NOT:

- silently close an `OPEN` decision;
- replace a `LOCKED` technology choice;
- duplicate Rust logic in TypeScript, C#, or Python;
- implement reusable graph structures, semantic validation, algorithms,
  ordering, queries, diffs, layout mathematics, or other significant graph
  calculations outside `grafting-graph-core`; callers may own presentation
  enrichment but must use explicit Rust contracts for computation (DEC-051,
  `docs/adr/ADR-0013-rust-graph-core-and-api-contracts.md`);
- duplicate authoritative behavior across packages, applications, languages,
  or adapters; independent tests, generated bindings, frozen fixtures, thin
  boundary translations, and derived evidence must remain traceable to one
  canonical source (DEC-049);
- import a third-party runtime/library API outside its designated smallest
  owning boundary (internal module tree, package, or host app), or expose
  vendor-owned types through a Grafting public API; consumers use Grafting
  contracts/facades instead, without requiring one package per dependency
  (DEC-049,
  `docs/adr/ADR-0011-package-autonomy-and-external-isolation.md`);
- hardcode a consuming product's visual identity, semantic roles, effects, or
  interaction policy inside a reusable capability package; packages expose
  neutral mechanisms, Grafting-owned composition contracts, and replaceable
  defaults, while applications compose concrete presentation and policy
  (DEC-052, `docs/adr/ADR-0014-composable-capability-packages.md`);
- expose Rust types directly through the ABI;
- promise zero-copy between distinct domains;
- call authoritative replication "Event Sourcing";
- create a second workspace root or lockfile without an ADR;
- merge a pull request; only a human merges one (DEC-053,
  `docs/adr/ADR-0015-agent-git-write-policy.md`);
- commit or push directly to `main`/`master` any change that touches a
  non-Markdown file; those commit and push within their own task
  branch/worktree (created by `ia-graft task new`). Documentation-only
  commits are the single exception — see "Task-based work" below (DEC-053,
  `docs/adr/ADR-0015-agent-git-write-policy.md`);
- create an experimental spike as a top-level `spikes/` directory; new
  disposable experiments are declared as laboratory items inside
  `apps/architecture-studio` (its `/lab` trials surface) so an experiment is
  visible, runnable, and comparable next to the others instead of being an
  orphan tree at the repository root. The existing `spikes/` entries stay
  where they are as historical record;
- use Nx to replace native toolchains;
- create the entire future tree empty;
- introduce a tool, agent, skill, or MCP without need and evaluation;
- modify security controls or its own maintenance without approval;
- treat summary documents as superior to the master source;
- change a consumed package's public names, required inputs, outputs, or
  documented obligations without updating its public-API baseline, running its
  `api-check`, and preserving its behavioral contract tests (DEC-051);
- inspect `cfg(target_os)`, `navigator.gpu`, `process.platform`, or RID
  directly outside `polymath` (Rust), `@grafting/polymath` (TypeScript), or
  `Grafting.Polymath` (C#) — all platform/runtime inspection is centralized
  there (DEC-042, `docs/adr/ADR-0006-polymath-platform-abstraction.md`).

## Task-based work

Claude, Codex, Gemini, and any future provider use the same repository state
and the same coordination mechanism: `tools/ia-graft`. Vendor adapters
(`CLAUDE.md`, `GEMINI.md`, and equivalent files) may only point to canonical
instructions; they must not restate or override them.

- **Documentation-only edits commit directly on `master`/`main`, with no task
  and no pull request.** A change qualifies only when *every* touched file is
  Markdown prose — research documents, registries, ADRs, READMEs, planning
  logs, this file, `.ai/coordination/PROTOCOL.md`. No source file, no
  contract (`.fbs`, JSON schema), no config (`project.json`, `package.json`,
  `Cargo.toml`, `nx.json`, …), no script, no test, and no generated Markdown
  under `docs/generated/` (that tree is produced by its generator and
  validated by `docs:check`, never hand-edited). Task ceremony was pure
  overhead for prose; tasks are for heavy work. Changing the
  protocol/registries/policies/hooks/permissions/skills/MCPs still requires
  explicit owner approval before the commit — the relaxed path removes the
  branch and PR, not the approval.
- **Never commit on `master`/`main` for anything else.** The moment a change
  touches one non-Markdown file, it is not documentation-only: the whole
  change goes to a task branch and a pull request, however small it is.
- **Direct/simple edits** (a typo in code, a comment, a small non-structural
  change that doesn't touch a contract/config/policy file): skip the
  required-reading chain, but still go through
  `ia-graft task new`/`commit`/`done` below — just with a terser title/body,
  not a full task declaration.
- **Any task**: run `ia-graft task new --id <TASK-ID>`. This creates or resumes an
  isolated Git worktree and branch, and prepares workspace-aware `node_modules`
  overlays: external packages reuse the main checkout's installed store while
  workspace-package links point into the task worktree. Work only inside that
  worktree. Isolation between agents comes from separate worktrees/branches,
  not from a file-ownership ledger. It also sweeps any already-merged worktree
  out of `.worktrees/` first, silently — nothing to invoke or remember, it's
  just what `task new` does. Run `task deps --id <TASK-ID>` to rebuild the
  overlays after the main installation changes. If the task lockfile introduces
  packages absent from the main installation, run `task deps --id <TASK-ID>
  --install`: the CLI performs the only permitted task-scoped materialization,
  with a frozen lockfile, lifecycle scripts disabled, a marked virtual store
  under the main checkout, and only managed links in the worktree. Never run a
  package-manager install or mutation directly inside a task worktree.
- **Review feedback is the same task**: use `ia-graft task resume --pr <number>`
  or `task new` with the exact same ID; never create a second task for requested
  changes on an open PR. For genuinely dependent new work, use
  `task new --id <TASK-ID> --parent <PARENT-TASK-ID>`; independent work omits
  `--parent` and starts from the detected default branch.
- Use `task status`/`task doctor` before manual recovery. `task new` safely
  reattaches an existing branch and repairs an orphan reserved task directory.
  When the recorded base advances, use `task sync --id <TASK-ID> [--fetch]`;
  it refuses a dirty worktree and performs only forward integration from that
  base. If it reports conflicts, resolve them and use `task commit`, or use
  `task sync --id <TASK-ID> --abort` to undo only that unfinished CLI sync.
  Raw `git merge`/`rebase` commands remain forbidden.
  Use `task checkout --id <TASK-ID>` and `task checkout --restore [--force]`
  for temporary testing in the clean main checkout; never commit there and
  only use restore force to explicitly discard task-generated changes. Use
  `task cleanup --id <TASK-ID> --force` for explicit abandonment instead of
  manual worktree/filesystem deletion.
- Commit as you go with `ia-graft task commit --id <TASK-ID> --message
  <msg>` (stages and commits inside the worktree) — not raw `git add`/`git
  commit`, and never in the main checkout.
- Before opening the PR, run `ia-graft task test --id <TASK-ID> --command
  <cmd>`. Repeat `--command` for a batch of at most 12 and add `--keep-going` only when
  later checks remain useful after a failure. Summaries cap individual lines
  and total characters instead of returning raw transcripts, so generated or
  minified output cannot consume the task context.
- When the task is ready for review, run `ia-graft task done --id <TASK-ID> --title
  <title> --body <body>` to push the branch and open a pull request via
  `gh`. If `gh` can't open one (missing/unauthenticated), it still pushes
  and returns a manual compare URL instead of failing — open that URL
  yourself. For requested changes, run `task resume --pr <number>` (or `task new`
  with the same ID), commit/test, and run `task done` again; it returns the
  existing PR. After the PR merges, run `ia-graft task cleanup --id <TASK-ID>`
  to remove the worktree, local branch, and the remote task branch when its SHA
  still matches the merged PR and no open stacked PR uses it as a base.
- **Standing owner authorization for the canonical remote:** agents may run
  the normal `tools/ia-graft` lifecycle without asking for an additional
  confirmation, including task creation/resume, dependency overlay management,
  sync, tests, commits, branch pushes, and pull-request creation or updates
  against `https://github.com/TassoossaT/Grafting-Monorepo.git`. This standing
  authorization applies only to actions mediated by `tools/ia-graft`; it does
  not authorize bypassing platform safeguards, raw Git lifecycle mutations,
  publishing packages/releases, accessing production, or merging a pull
  request. Human-only merge remains mandatory under DEC-053.
- Changing the protocol, registries, policies, hooks, permissions, skills, or
  MCPs still requires explicit owner approval. When the change reaches beyond
  Markdown, open the PR and wait for review, do not merge your own. When it
  is documentation-only, the approval must be explicit *before* the commit —
  the direct-to-`master` path removes the review gate, so the owner's
  go-ahead is the only gate left.
- Provider chat history is never treated as shared state or evidence.

## Agent Efficiency and Token Economy

Minimize tokens read and produced; do not fetch more than a task needs.

- **Discovery:** never list a full directory tree; use pattern/keyword search
  (`glob`, `grep`) instead, and rely on tools that already respect
  `.gitignore` to skip build artifacts and dependencies.
- **File content:** avoid reading whole files — search for the relevant
  lines, or read a bounded line range around the edit target.
- **Commands:** prefer quiet/silent flags; redirect known-verbose commands to
  a file and inspect that instead of the raw stream.
- **Re-reads:** read a foundational document (ADRs, master source) once per
  session, not once per action; if a constraint needs to persist across
  sessions, add a short line to the relevant file or a compact canonical repository source instead of
  re-deriving it each time.
- **Verbatim relocation:** to move or archive content unchanged (e.g. an
  entire file, or a section into its own file), prefer a filesystem/Git
  operation (`git mv`, `cp`, or a shell copy) over `Read` then `Write` — the
  latter pays the full content's token cost twice (once in, once out) for
  zero actual editing. Reserve `Read`+`Write`/`Edit` for when the content
  itself changes.

## What counts as a direct/simple edit

This section is about changes that touch at least one non-Markdown file.
Documentation-only edits are covered by the first bullet of "Task-based
work" above and need no task, no branch, and no PR at all. Everything else
goes through `ia-graft task new`/`commit`/`done` and a PR — the criteria
below only decide whether the *required-reading* chain and a full
title/body can be skipped. A change qualifies only if it meets every
criterion:

- **Limited scope:** touches at most two files. Documentation that rides
  along with a code change counts toward that cap like any other file.
  A change to the protocol/registry/policy/hook/permission/skill/MCP files
  named in Mandatory rules above never qualifies — it always gets the full
  required-reading pass, regardless of file count.
- **No contract changes:** no public API, data contract (`.fbs`, JSON
  schema), or critical config (`project.json`, `nx.json`, `package.json`,
  `Cargo.toml`, etc.).
- **Non-structural:** no new dependency, no architectural change.

Examples: fixing a typo, adding a comment, refactoring one function's
internals without changing its signature. If a change turns out not to
qualify once you start, stop and do the full required-reading pass before
continuing — you're already on a task branch either way.

## Before editing

Declare:

```text
Task:
Objective:
Applicable decisions:
Open decisions:
Affected files:
Dependencies:
Inputs and outputs:
Validations:
Risks:
```

## Completion criteria

A task can only be declared complete with applicable evidence:

- format;
- lint;
- typecheck;
- tests;
- build;
- codegen;
- schema validation;
- diff review;
- acceptance criteria;
- documentation — see `.ai/coordination/PROTOCOL.md`'s "Before opening the
  pull request" section for the concrete steps (API-reference regeneration,
  research registry updates, third-party attribution) and when each applies;
- Graph IR;
- risks and limitations.

## Completion format

```text
Task:
Result:
Files created:
Files changed:
Commands run:
Validations:
Decisions:
Dependencies and licenses:
Context used:
Graph IR:
Risks:
Rollback:
Next task:
```

## Stop conditions

Stop and request a decision when:

- an open gate would change the structure;
- a major ABI change is involved;
- a persisted protocol would be broken;
- GPU sharing between runtimes is required;
- a new workspace or lockfile is required;
- credentials, publishing, or production access are required;
- a `LOCKED` decision appears unviable;
- the scope grows materially.
