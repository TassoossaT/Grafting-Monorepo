# Minimal AI Control Plane spike — 2026-07-29

Status: **accepted; foundational spike 8 complete.**

## Proven scope

- provider-neutral coordination protocol;
- registered Claude, Codex, Gemini, and repository owner identities;
- capabilities and workflows with stable IDs, sources, risk, commands, and
  side-effect declarations;
- closed JSON schemas for tasks, handoffs, and capabilities;
- one owner per active task and immutable handoff convention;
- deterministic validation and audit through the uv-managed automation package;
- short Claude/Gemini adapters checked for canonical references and drift;
- Graph IR candidate freshness included in the audit.

The audit records zero model calls and zero side effects. It reads canonical
files, validates them, optionally executes the read-only Graph IR freshness
check, and emits a deterministic JSON report to stdout.

## Explicitly absent

- no Bifrost or other gateway;
- no semantic or response cache;
- no Langfuse, Promptfoo, LangMem, GEPA, DSPy, or BAML;
- no MCP server or direct provider-to-provider call;
- no hooks, permission changes, credentials, or external state;
- no `evolve` mode and no automatic promotion of policies or skills;
- no prompt registry before Prompt IR has a real implementation.

These omissions are the intended boundary of the spike, not unfinished hidden
features.

## Validation

```powershell
uv run --package automation pytest
uv run --package automation python -m automation.coordination --root .
uv run --package automation python -m automation.control_plane --root .
pnpm graph:check
```

## Result and disposition

File-based Phase 1 communication is sufficient for the current number of
agents. It is cheap, inspectable, versionable, and provider-independent. Carry
it forward. A Context Broker MCP remains a later Phase 2 task and should only
be introduced after concrete contention, query, or automation requirements
justify its security and operational surface.
