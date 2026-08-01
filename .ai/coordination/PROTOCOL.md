# Multi-agent coordination protocol

This protocol is the canonical Phase 1 communication mechanism for Claude,
Codex, Gemini, and future providers. It implements `GRAFTING_MASTER_SOURCE.md`
§25.7, §25.8, and §29.11 without an MCP, gateway, or model call. A
project-scoped Claude Code hook now enforces part of this existing protocol at
runtime; it is a vendor adapter, not a second source of policy.

## Authority

The precedence order remains:

1. `GRAFTING_MASTER_SOURCE.md`;
2. accepted ADRs;
3. root and nearest scope-local `AGENTS.md`;
4. implemented code, manifests, schemas, and Graph IR evidence;
5. `CURRENT_PLANNING_STATE.md`;
6. task and handoff records;
7. provider adapters and private chat context.

Task state coordinates work; it never closes an `OPEN` decision or changes an
architectural rule.

## Starting work

1. Read the required sources and inspect the actual tree and Git status.
2. Find the task record in `.ai/state/tasks/` or create one from the schema.
3. Re-read the record immediately before claiming it.
4. Claim only a `planned` or `blocked` task. Set one owner, increment
   `revision`, record `updated_at`, affected paths, validations, and blockers.
5. If another agent owns an `in_progress` task, do not edit that scope. Create
   a handoff if it needs information.
6. Declare the task using the root `AGENTS.md` format before editing.

An owner ID is one of the IDs in `.ai/registry/agents.yaml`. Provider roles are
selected per task; no provider is permanently the planner, implementer, or
reviewer.

## Runtime enforcement adapters

`.claude/settings.json` registers a `PreToolUse` hook for `Write`, `Edit`, and
`Bash`. It calls the provider-neutral `tools/scripts/agent-task-guard.mjs` with
the canonical agent ID `claude`.

Before Claude owns exactly one `in_progress` task, the guard permits only:

- native read tools;
- simple, allowlisted read-only shell inspection such as `git status`,
  `git diff`, and `rg` without command composition;
- creation or repair of a record under `.ai/state/tasks/` so the task can be
  created, re-read, and claimed without a bootstrap deadlock.

After the claim, exact `Write` and `Edit` targets must be covered by that
task's `affected_paths` and must not be covered by another provider's active
task. Existing handoffs cannot be changed or overwritten, and a new handoff
must name the active agent as sender. `Bash` requires a unique active claim,
but arbitrary shell text cannot be mapped perfectly to every path it might
mutate; diff review and completion validation remain mandatory.

The guard does not create, claim, expand, complete, or transfer a task. It only
reads canonical state and blocks a tool call with an actionable reason. Other
providers remain governed by this protocol and may add their own thin runtime
adapter only through a separate owner-approved task.

A `completed` or `cancelled` task record accepts exactly one further kind of
write: a same-status, same-owner correction, where the resulting `status` and
`owner` are byte-identical to what is already on disk. This exists so an agent
that closed a task before finishing its own bookkeeping (for example, setting
`status: "completed"` in one edit and only then trying to fill in
`validations`/`artifacts` in a second edit) can fix that record instead of
leaving it permanently thin. It is not a reopening mechanism: any write that
would change `status` or `owner` on an already-closed record is still denied,
and genuinely new work always requires a new task record. Set the final
`status`, `validations`, `artifacts`, `risks`, and `next_responsible_party`
together in one write whenever possible; the correction path is a safety net,
not the normal flow.

Project hooks can be disabled by a user's higher-precedence local Claude
settings. Verify the active `Project` hook through Claude Code's `/hooks`
screen. Organization-level tamper resistance would require managed settings
and is outside this repository's authority.

## Git write policy

AI agents never create, amend, rewrite, or implicitly produce Git commits.
This prohibition applies on every branch, even when the agent owns an active
task. In particular, agents do not run commit, merge, rebase, cherry-pick,
revert, stash, commit-producing pull, or pull-request merge operations.

Agents may:

- inspect Git state and history;
- stage or unstage changes when useful for review without committing them;
- create or switch to an isolated `ai/<agent>/<task-id>` branch;
- fetch and use `git pull --ff-only` when otherwise authorized;
- prepare or open a pull request whose commits were authored by a human;
- push only an explicit `ai/<agent>/<task-id>` branch containing
  human-authored commits.

Agents never push to `main` or `master`, never force/bulk/mirror/tag/delete
remote refs, and never merge a pull request. Creating an isolated branch or
requesting a PR does not authorize a commit. The repository owner remains the
only party who may decide that a commit or merge is created.

The provider-neutral task guard enforces this policy for every provider that
adopts its runtime adapter. Canonical instructions govern providers without an
adapter. A repository-wide pre-commit hook is deliberately not installed,
because it would also interfere with authorized human commits.

## During work

- Work on one task ID at a time and preserve unrelated changes.
- Re-read a shared file before editing it. Unexpected revision or ownership
  changes are a conflict: stop and reconcile instead of overwriting.
- Record material scope, dependency, ABI, protocol, security, and decision
  discoveries in the task record.
- Do not communicate through generated files, editor settings, ignored files,
  or assumptions about another provider's chat history.
- Do not commit any change. Hand off the uncommitted working tree or a patch to
  the repository owner; ownership transfer never transfers commit authority.

## Handoffs

Create one immutable JSON file per handoff in `.ai/state/handoffs/`, named:

```text
<UTC timestamp>--<task-id>--<sender>-to-<recipient>.json
```

The record must include task ID, sender, recipient, objective, context,
criteria, constraints, uncertainties, artifacts, current owner, return schema,
and next responsible party. The recipient acknowledges it by creating a new
response handoff or by updating the task record after ownership is transferred.
Existing handoff files are never rewritten.

## Completing or blocking work

1. Run the validations declared by the task and the AI-state validator.
2. Set `status` to `completed` only with evidence, or `blocked` with a concrete
   blocker. Increment `revision` and update the timestamp.
3. Record changed artifacts, validations actually run, residual risks, and the
   next responsible party.
4. Apply the completion format in root `AGENTS.md`.
5. Implementation and independent review should have different agents when a
   review is required; a self-review must not be represented as independent.
6. If any `affected_paths` fall under a documented project's `src/`
   (TypeScript: `packages/*`, `apps/*`; Rust: `libs/**`), regenerate that
   project's API-reference evidence in `docs/generated/api/` before setting
   `status: "completed"`, and include the regenerated file(s) in
   `affected_paths`/`artifacts`. Scope the regeneration to only the
   project(s) actually touched, not a full-repo `docs:check` run, so this
   stays cheap as the repository grows. The primary, always-available way
   to do this is calling the generator directly with that project's own
   `project.json` `name` (TypeScript) or Cargo package name (Rust):
   `node tools/scripts/generate-api-docs.mjs <name>` /
   `node tools/scripts/generate-rust-api-docs.mjs <name>`. This needs no
   per-project setup and works immediately for a project created in the
   same task, since target discovery itself is dynamic (reads
   `project.json`/`Cargo.toml`, not a hardcoded list; see
   `tools/scripts/README.md`). Where a matching `nx run
   <project>:docs-generate`/`docs-check` target already exists (every
   project scaffolded by `generate-rust-crate.mjs`, and every project
   documented before this rule was added), prefer that -- but its absence
   on a brand-new project is not a blocker; the direct script call always
   works. The full-repo `docs:api:ts:check`/`docs:api:rust:check` (already
   inside `docs:check` and CI) remains the backstop for anything skipped.
   After regenerating, run the `docs-quality-check` skill
   (`.claude/skills/docs-quality-check/SKILL.md`) against the regenerated
   file before setting `status: "completed"`. It only reads and reports --
   it cannot edit the generated file or the generator itself
   (`disallowed-tools: Write, Edit` in its own frontmatter) -- so a real
   finding becomes a suggested generator fix for the owner to confirm, not
   a silent change.
7. If any `affected_paths` include a `docs/research/*.md` file other than
   `docs/research/RESEARCH-DECISIONS-REGISTRY.md` itself, and the edit
   changed a candidate's status (adopted, discarded, or standby/deferred),
   update that candidate's row in the registry before setting
   `status: "completed"`, and include the registry in
   `affected_paths`/`artifacts`. The registry is a hand-maintained index, not
   generated -- there is no script to run. Claude Code carries a `PostToolUse`
   hook (`tools/scripts/research-registry-reminder.mjs`, wired in
   `.claude/settings.json`) that reminds after such an edit; it only reminds
   and never blocks or edits the registry itself, so providers without an
   equivalent hook remain cooperatively governed by this rule the same way
   the rest of this protocol works.

## Validation

From the repository root:

```powershell
uv run --package automation python -m automation.coordination --root .
```

If `uv` is not available through the current shell, use the repository's
bootstrap instructions first. Never weaken a schema or skip a conflicting
owner merely to make validation pass.

## Rollback

Canonical coordination state remains file-based and has no external service
side effects. Roll back the Claude enforcement adapter by removing its
`PreToolUse` entry from `.claude/settings.json` and reverting the guard task's
tracked files. Never delete another active agent's task or handoff record as
part of rollback.
