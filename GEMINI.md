# GEMINI.md

Read and follow, in order:

1. `AGENTS.md`;
2. `GRAFTING_MASTER_SOURCE.md`;
3. `CURRENT_PLANNING_STATE.md`;
4. applicable ADRs and contracts.

This file is only an adapter for Gemini and does not repeat the architecture.

## Planning state

While the project is still in the planning phase (per `CURRENT_PLANNING_STATE.md`):

-   Work on drafting decisions, ADRs, technology comparisons, and spikes to reduce uncertainty.
-   Do not treat the directory structure planned in `GRAFTING_MASTER_SOURCE.md` as if it were already implemented.
-   Do not close Decision Gates (`OPEN` decisions) silently. Instead, present analysis, evidence, risks, and objective criteria to support a human decision.
-   Keep responses and changes strictly within the requested scope.

## Implementation state

Once there is an implemented codebase:

-   Use the native toolchains defined in `GRAFTING_MASTER_SOURCE.md` (Cargo, pnpm, uv, dotnet) to build, test, and package the software.
-   Strictly follow the working format and completion criteria defined in `AGENTS.md` for each task.
-   Do not duplicate Rust core logic in the TypeScript or C# hosts.
-   Respect the defined ABI boundaries and data contracts.
