# `.ai/` — AI Control Plane (minimal bootstrap)

This directory is the canonical source of the AI Control Plane, per
`GRAFTING_MASTER_SOURCE.md` §16 and §29 (DEC-025). It does not replace
`AGENTS.md` as the project's operational contract — `AGENTS.md` still wins
for agent behavior rules.

## Current state

This is a **minimal operational control plane**, not the full structure
described in §29.1. Only directories with real content exist. Phase 1
multi-agent communication is now active through versioned files:

```text
.ai/
├── README.md
├── coordination/
├── contracts/
├── registry/
├── state/
└── skills/
    └── task-completion/
        ├── SKILL.md
        └── manifest.yaml
```

The remaining directories from the canonical layout (`policies/`, `agents/`,
`prompts/`, `workflows/`, `context/`, `adapters/`, `evals/`, `catalog/`,
`reports/`, `scripts/`) are intentionally not created yet. They are added one
at a time when real work produces content for them.

## Coordination

`.ai/coordination/PROTOCOL.md` is the provider-neutral workflow. Task records
under `.ai/state/tasks/` establish ownership; handoff records under
`.ai/state/handoffs/` transfer discoveries and responsibility without relying
on private chat history. Contracts and registries are JSON-compatible YAML or
JSON so validation needs no model call and no external service.

## Skills

Skills follow the canonical Agent Skills format from §29.3
(`SKILL.md` + `manifest.yaml`, plus `references/`/`scripts/`/etc. only when
there is real content for them). The lifecycle in §29.3
(`discovered → quarantined → inspected → adapted → evaluated → approved →
active → monitored → deprecated → archived`) applies to skills adopted from
outside the project; a skill authored in-repo by the owner, like
`task-completion`, starts directly at `active`.
