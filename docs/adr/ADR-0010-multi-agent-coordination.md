# ADR-0010: provider-neutral multi-agent coordination

- Status: **Accepted.** Recorded from the repository owner's explicit request
  on 2026-07-28 to keep simultaneous Claude, Codex, and occasional Gemini work
  aligned and resistant to provider-specific drift.
- Decision date: 2026-07-28
- Related: DEC-025, DEC-028, master source §16, §25.7, §25.8, and §29.11.

## Context

The same repository is used concurrently through multiple AI providers. Their
private conversations are not shared, and vendor-specific instruction files
can drift if they each restate the operational contract. Concurrent edits also
need a visible owner and a complete handoff that does not depend on chat
history.

## Decision

Phase 1 communication uses versioned repository files under `.ai/state/`:

- one task record and one active owner per task;
- immutable structured handoffs between providers;
- provider-neutral contracts and agent IDs;
- deterministic validation with no model call;
- short vendor adapters that point to `AGENTS.md` and the coordination
  protocol instead of copying rules.

The current mechanism is cooperative, not a distributed lock. A task revision
must be re-read before writing, and conflicting ownership is a stop condition.
An MCP broker is deferred until file coordination demonstrates a concrete need.

## Consequences

- Claude, Codex, and Gemini can resume work using repository evidence alone.
- Provider roles remain task-specific; no provider permanently owns planning,
  implementation, or review.
- Protocol, registry, policy, permission, hook, skill, or MCP changes require a
  separate task and explicit owner approval.
- Chat transcripts and editor-local settings are not authoritative state.

## Alternatives rejected

- Duplicating full rules in every vendor adapter: creates drift.
- Treating chat history as the bus: other providers cannot inspect it.
- Introducing an MCP immediately: adds service, security, and operational
  surface before file-based coordination has been evaluated.

## Validation and rollback

The automation package validates registries, schemas, tasks, and handoffs.
Rollback is a normal Git revert of this task's tracked files; it has no
external state or credential impact.
