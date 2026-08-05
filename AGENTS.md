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
- merge a pull request or push directly to `main`/`master`; agents commit and
  push within their own task branch/worktree (created by `ia-graft task new`)
  and may open a pull request, but only a human merges it (DEC-053,
  `docs/adr/ADR-0015-agent-git-write-policy.md`);
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

- **Never commit on `master`/`main` directly, no exception for small edits.**
  Every commit, however small, happens on a task branch and goes through a
  pull request.
- **Direct/simple edits** (a typo, a comment, a small non-structural change
  that doesn't touch a contract/config/policy file): still skip the
  required-reading chain, but still go through
  `ia-graft task new`/`commit`/`done` below — just with a terser title/body,
  not a full task declaration.
- **Any task**: run `ia-graft task new --id <TASK-ID>`. This creates or resumes an
  isolated Git worktree and branch, and links every `node_modules` in the
  tree from the main checkout into it — work only inside that worktree.
  Isolation between agents comes from separate worktrees/branches, not from
  a file-ownership ledger. It also sweeps any already-merged worktree out of
  `.worktrees/` first, silently — nothing to invoke or remember, it's just
  what `task new` does.
  Treat linked `node_modules` as read-only; dependency installation or mutation runs only in the main checkout, never inside a task worktree.
- **Review feedback is the same task**: use `ia-graft task resume --pr <number>`
  or `task new` with the exact same ID; never create a second task for requested
  changes on an open PR. For genuinely dependent new work, use
  `task new --id <TASK-ID> --parent <PARENT-TASK-ID>`; independent work omits
  `--parent` and starts from the detected default branch.
- Use `task status`/`task doctor` before manual recovery. `task new` safely
  reattaches an existing branch and repairs an orphan reserved task directory.
  Use `task checkout --id <TASK-ID>` and `task checkout --restore [--force]`
  for temporary testing in the clean main checkout; never commit there and
  only use restore force to explicitly discard task-generated changes. Use
  `task cleanup --id <TASK-ID> --force` for explicit abandonment instead of
  manual worktree/filesystem deletion.
- Commit as you go with `ia-graft task commit --id <TASK-ID> --message
  <msg>` (stages and commits inside the worktree) — not raw `git add`/`git
  commit`, and never in the main checkout.
- Before opening the PR, run `ia-graft task test --id <TASK-ID> --command
  <cmd>` — it returns a compact pass/fail summary instead of the raw
  transcript, so validating a change doesn't cost more tokens than the
  change itself.
- When the task is ready for review, run `ia-graft task done --id <TASK-ID> --title
  <title> --body <body>` to push the branch and open a pull request via
  `gh`. If `gh` can't open one (missing/unauthenticated), it still pushes
  and returns a manual compare URL instead of failing — open that URL
  yourself. For requested changes, run `task resume --pr <number>` (or `task new`
  with the same ID), commit/test, and run `task done` again; it returns the
  existing PR. After the PR merges, run `ia-graft task cleanup --id <TASK-ID>`
  to remove the worktree.
- Changing the protocol, registries, policies, hooks, permissions, skills, or
  MCPs still requires explicit owner approval — open the PR and wait for
  review, do not merge your own.
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

Both paths above go through `ia-graft task new`/`commit`/`done` and a PR —
this only decides whether the *required-reading* chain and a full
title/body can be skipped. A change qualifies only if it meets every
criterion:

- **Limited scope:** touches at most two files, or up to four when every
  touched file is Markdown documentation. This raised cap never applies to
  the protocol/registry/policy/hook/permission/skill/MCP files named in
  Mandatory rules above — a change to any of those always gets the full
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
