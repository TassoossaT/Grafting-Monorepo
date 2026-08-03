# ADR-0010: provider-neutral multi-agent coordination

- Status: **Accepted.** Recorded from the repository owner's explicit request
  on 2026-07-28 to keep simultaneous Claude, Codex, and occasional Gemini work
  aligned and resistant to provider-specific drift.
- Decision date: 2026-07-28
- Runtime enforcement amendment: **Accepted by the repository owner on
  2026-07-29** after an assigned Claude task was not claimed in canonical
  state; implemented by task `COORDINATION-CLAUDE-RUNTIME-GUARD`.
- Related: DEC-025, DEC-028, `docs/architecture/ai-control-plane.md` §16 and
  §29.11 (formerly master source §16, §25.7, §25.8, and §29.11 — §25.7/§25.8
  were removed as duplicative when the master source was split, see
  `docs/adr/ADR-0016-architecture-studio-scope-expansion.md`'s note in §29.11
  for the ADR-0016 vs. Context Broker MCP distinction).

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

### Runtime enforcement amendment

The canonical mechanism remains the task and handoff state under `.ai/`.
Claude Code now has a thin project adapter in `.claude/settings.json`: a
`PreToolUse` command hook calls the provider-neutral
`tools/scripts/agent-task-guard.mjs` before `Write`, `Edit`, or `Bash`.

The adapter blocks mutating calls until Claude owns exactly one active task,
checks exact Write/Edit paths against `affected_paths`, rejects overlap with
another active owner, and protects immutable handoffs. It permits read-only
inspection and task-record creation before a claim so enforcement does not
prevent the protocol's own startup sequence.

This is not a distributed lock and does not move authority into Claude
settings. Arbitrary Bash commands cannot be mapped perfectly to every path
they may change, project hooks can be disabled by higher-precedence local
settings, and providers without an equivalent adapter remain cooperatively
governed. Diff review, validation, and structured handoff remain mandatory.

## Consequences

- Claude, Codex, and Gemini can resume work using repository evidence alone.
- Provider roles remain task-specific; no provider permanently owns planning,
  implementation, or review.
- Protocol, registry, policy, permission, hook, skill, or MCP changes require a
  separate task and explicit owner approval.
- Claude Code refuses routine mutating tools when no canonical task is claimed,
  reducing dependence on prompt compliance alone.
- Chat transcripts and editor-local settings are not authoritative state.

## Alternatives rejected

- Duplicating full rules in every vendor adapter: creates drift.
- Treating chat history as the bus: other providers cannot inspect it.
- Introducing an MCP immediately: adds service, security, and operational
  surface before file-based coordination has been evaluated.
- Relying only on `CLAUDE.md`: retained for instruction, but insufficient as
  enforcement after a real assigned task was not recorded.
- Checking only at commit or CI time: detects collisions after files have
  already been edited and is too late for parallel ownership protection.

## Validation and rollback

The automation package validates registries, schemas, tasks, and handoffs.
The guard has deterministic positive and negative tests and no dependency or
model call. Rollback removes the project hook and guard files; canonical task
and handoff records remain valid and no credential or external service is
affected.
