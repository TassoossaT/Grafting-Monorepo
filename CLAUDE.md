# CLAUDE.md — Claude Agent Adapter

Read and follow in precedence order:
1. [`AGENTS.md`](AGENTS.md) — Single canonical source for all agent rules and mandatory constraints.
2. [`GRAFTING_MASTER_SOURCE.md`](GRAFTING_MASTER_SOURCE.md) — Canonical architecture and Section Router (§0.4).
3. [`.ai/coordination/PROTOCOL.md`](.ai/coordination/PROTOCOL.md) — Coordination protocol.
4. Applicable ADRs in `docs/adr/`.

All task creation, execution, commits, dependencies, issues, and PRs MUST execute exclusively via the `ia-graft` MCP server's `graft_*` tools (see `.mcp.json`). Claude reaches `ia-graft` through MCP only; the guard denies the `.\ia-graft.cmd` launcher over Bash and names the tool to call instead. Direct manual git mutations, raw `gh` commands, and raw package installations are forbidden. Full autonomous execution is pre-approved through `graft_task_done`.
