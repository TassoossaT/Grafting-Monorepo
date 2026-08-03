---
name: task-completion
description: Use when a task is finished or a work session is wrapping up in the Grafting Monorepo. Produces the structured completion report defined in AGENTS.md and, for a full task, opens its pull request via ia-graft so the next session starts from a clean entry point.
---

# Task Completion

This skill formalizes what already exists as plain instructions in
`AGENTS.md` and `.ai/coordination/PROTOCOL.md`, but never existed as an
invocable artifact: closing out a task or a session in a way that leaves the
repository easy to pick back up.

## When to apply

- A task tracked during the session reaches "done".
- The owner signals the session is ending ("vou finalizar por hoje", "bora
  fechar por aqui", etc.).
- Before a commit that closes out a batch of planning/architecture work.

## Steps

1. **Produce the completion report.**
   Fill in the exact template from `AGENTS.md` → "Completion format".
   Do not skip fields — if a field is genuinely empty (e.g. no dependencies
   were touched), say so explicitly rather than omitting the line:

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

   `Validations` must reflect what was *actually* run (format/lint/typecheck/
   tests/build/codegen/schema validation/diff review/acceptance criteria/
   docs/Graph IR/risks — per AGENTS.md → "Completion criteria"), not what
   would ideally have been run. In the current planning-only phase this is
   usually "manual consistency review", not automated checks — say that
   plainly instead of implying CI ran.

2. **Open the pull request, if this was a full task.**
   A direct/simple edit (see `AGENTS.md`) just needs its commit; nothing else
   to open. Otherwise, inside the task's worktree:
   `ia-graft task done --id <TASK-ID> --title <title> --body <body>` — the
   body should be the completion report from step 1, not a repeat of the
   task's original description. This pushes the branch and opens the PR via
   `gh`; the worktree stays until a human merges it and runs
   `ia-graft task cleanup --id <TASK-ID>`.

3. **Confirm everything is committed.**
   The working tree inside the task's worktree should be clean before
   `task done` runs — commit as you go, not in one batch at the end (see
   `.ai/coordination/PROTOCOL.md` → "Starting work"). If anything is still
   uncommitted when the session is ending, say so plainly rather than
   leaving it implicit.

## Non-goals

- This skill does not decide architecture. If closing out the task surfaces
  an open question, that becomes a `docs/adr/` entry — never a silent
  decision folded into the completion report.
- This skill does not replace the per-task "Antes de editar" declaration in
  `AGENTS.md` — that happens at the start of a task, this happens at the end.
