# GEMINI.md

Read and follow, in order:

1. `AGENTS.md`;
2. `GRAFTING_MASTER_SOURCE.md`;
3. `.ai/coordination/PROTOCOL.md`;
4. applicable ADRs and contracts.

This file is only an adapter for Gemini and does not repeat the architecture.
Task coordination goes through `tools/ia-graft` (worktree + branch per task,
PR to finish) — see `AGENTS.md`'s "Task-based work" section. Chat context is
not a substitute for repository state.

A documentation-only change (every touched file Markdown prose, nothing under
`docs/generated/`) commits straight to `master`/`main` with no task, branch,
or PR — see `AGENTS.md`'s "Task-based work". For a small change that touches
any non-Markdown file, check `AGENTS.md`'s "What counts as a direct/simple
edit" — it skips the required-reading chain, but still goes through a task
branch and a PR.

New disposable experiments are declared as laboratory items inside
`apps/architecture-studio`, not as a new top-level `spikes/` directory.

While the project is still in the planning phase:

- work on decisions, ADRs, comparisons, and spikes;
- do not treat the planned monorepo as already implemented;
- do not close Decision Gates silently;
- present evidence, risks, and objective criteria;
- keep responses and changes limited to the requested scope.

Once implementation begins, use the native toolchains defined in the master
source and follow the working format in `AGENTS.md`.
