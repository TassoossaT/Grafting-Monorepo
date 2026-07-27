# `.ai/` — AI Control Plane (minimal bootstrap)

This directory is the canonical source of the AI Control Plane, per
`GRAFTING_MASTER_SOURCE.md` §16 and §29 (DEC-025). It does not replace
`AGENTS.md` as the project's operational contract — `AGENTS.md` still wins
for agent behavior rules.

## Current state

This is a **minimal** bootstrap, not the full structure described in §29.1.
Only what has real content today exists on disk:

```text
.ai/
├── README.md
└── skills/
    └── task-completion/
        ├── SKILL.md
        └── manifest.yaml
```

The remaining directories from the canonical layout (`registry/`,
`policies/`, `agents/`, `prompts/`, `workflows/`, `context/`, `contracts/`,
`adapters/`, `evals/`, `catalog/`, `state/`, `reports/`, `scripts/`) are
intentionally not created yet — per §4.3, directories are not scaffolded
empty ahead of a real need. They are added one at a time as Fase 0/1 work
actually produces content for them.

## Skills

Skills follow the canonical Agent Skills format from §29.3
(`SKILL.md` + `manifest.yaml`, plus `references/`/`scripts/`/etc. only when
there is real content for them). The lifecycle in §29.3
(`discovered → quarantined → inspected → adapted → evaluated → approved →
active → monitored → deprecated → archived`) applies to skills adopted from
outside the project; a skill authored in-repo by the owner, like
`task-completion`, starts directly at `active`.
