# CLAUDE.md

Read and follow, in order:

1. `AGENTS.md`;
2. `GRAFTING_MASTER_SOURCE.md`;
3. `CURRENT_PLANNING_STATE.md`;
4. `.ai/coordination/PROTOCOL.md` and current task/handoff state;
5. applicable ADRs and contracts.

This file is only an adapter for Claude and does not repeat the architecture.
Claude must claim or receive a task through the canonical coordination
protocol before editing. Chat context is not a substitute for repository
state.

For a genuinely small change, check `AGENTS.md`'s Fast-Track criteria first —
a qualifying Simple Task skips the required-reading chain and the full task
record.

While the project is still in the planning phase:

- work on decisions, ADRs, comparisons, and spikes;
- do not treat the planned monorepo as already implemented;
- do not close Decision Gates silently;
- present evidence, risks, and objective criteria;
- keep responses and changes limited to the requested scope.

Once implementation begins, use the native toolchains defined in the master
source and follow the working format in `AGENTS.md`.
