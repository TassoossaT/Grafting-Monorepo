# CLAUDE.md

Read and follow, in order:

1. `AGENTS.md`;
2. `GRAFTING_MASTER_SOURCE.md`;
3. `.ai/coordination/PROTOCOL.md`;
4. applicable ADRs and contracts.

This file is only an adapter for Claude and does not repeat the architecture.
Task coordination goes through `tools/ia-graft` (worktree + branch per task,
PR to finish) — see `AGENTS.md`'s "Task-based work" section. Chat context is
not a substitute for repository state.

For a genuinely small, direct edit, check `AGENTS.md`'s "What counts as a
direct/simple edit" first — it skips the required-reading chain and the
worktree/PR ceremony.

While the project is still in the planning phase:

- work on decisions, ADRs, comparisons, and spikes;
- do not treat the planned monorepo as already implemented;
- do not close Decision Gates silently;
- present evidence, risks, and objective criteria;
- keep responses and changes limited to the requested scope.

Once implementation begins, use the native toolchains defined in the master
source and follow the working format in `AGENTS.md`.
