---
name: task-completion
description: Use when a task is finished or a work session is wrapping up in the Grafting Monorepo. Produces the structured completion report defined in AGENTS.md and refreshes CURRENT_PLANNING_STATE.md so the next session starts from a clean, non-redundant entry point.
---

# Task Completion

This skill formalizes two things that already existed as plain instructions
in `AGENTS.md` and `CURRENT_PLANNING_STATE.md`, but never existed as an
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

2. **Refresh `CURRENT_PLANNING_STATE.md`.**
   This file's only job is to be the next session's entry point. On every
   completion pass:
   - Fold new facts into the existing sections instead of appending new ones
     — this file should never grow by accretion.
   - Remove anything that duplicates what a linked ADR or the master source
     already says in full; point to it instead of repeating it.
   - Collapse lists of individually-resolved items (e.g. gates closed one at
     a time across a session) into one consolidated table or list, not one
     bullet per historical decision moment.
   - Update "Recommended next action" to the *actual* next concrete step,
     not a restatement of what was just finished.

3. **Flag uncommitted state.**
   If the working tree has uncommitted changes when the session is ending,
   say so plainly and ask whether to commit — do not commit automatically
   (see `AGENTS.md` git/safety rules) and do not let a session end silently
   leaving work unsaved without the owner knowing.

## Non-goals

- This skill does not decide architecture. If closing out the task surfaces
  an open question, that becomes a `docs/adr/` entry or a `CURRENT_PLANNING_STATE.md`
  pending item — never a silent decision folded into the completion report.
- This skill does not replace the per-task "Antes de editar" declaration in
  `AGENTS.md` — that happens at the start of a task, this happens at the end.
