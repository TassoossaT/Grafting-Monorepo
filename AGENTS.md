# AGENTS.md — Grafting Monorepo operational contract

This file defines how agents must work in this repository.

## Required reading

Before proposing or executing structural work, read in this order:

1. `GRAFTING_MASTER_SOURCE.md`;
2. `CURRENT_PLANNING_STATE.md`;
3. related ADRs;
4. the nearest `AGENTS.md` to the scope, when one exists;
5. applicable code, manifests, schemas, and Graph IR.

## Initial state

While `CURRENT_PLANNING_STATE.md` states that the monorepo does not yet exist:

- do not treat planned directories as real files;
- do not assume Git, CI, Nx, Cargo, pnpm, uv, or .NET are already configured;
- do not invent command output;
- do not declare an implementation complete;
- produce plans, ADRs, spikes, and verifiable criteria.

## Mandatory rules

The agent MUST NOT:

- silently close an `OPEN` decision;
- replace a `LOCKED` technology choice;
- duplicate Rust logic in TypeScript, C#, or Python;
- expose Rust types directly through the ABI;
- promise zero-copy between distinct domains;
- call authoritative replication "Event Sourcing";
- create a second workspace root or lockfile without an ADR;
- use Nx to replace native toolchains;
- create the entire future tree empty;
- introduce a tool, agent, skill, or MCP without need and evaluation;
- modify security controls or its own maintenance without approval;
- treat summary documents as superior to the master source;
- inspect `cfg(target_os)`, `navigator.gpu`, `process.platform`, or RID
  directly outside `polymath` (Rust), `@grafting/polymath` (TypeScript), or
  `Grafting.Polymath` (C#) — all platform/runtime inspection is centralized
  there (DEC-042, `docs/adr/ADR-0006-polymath-platform-abstraction.md`).

## Task-based work

Once there is an implemented backlog:

- work on one task at a time;
- keep a single owner per task;
- use a worktree for parallel execution;
- separate implementation from independent review;
- preserve unrelated changes.

## Multi-agent coordination

Claude, Codex, Gemini, and any future provider use the same repository state.
Vendor adapters (`CLAUDE.md`, `GEMINI.md`, and equivalent files) may only
point to canonical instructions; they must not restate or override them.

Before starting implementation, every agent MUST read
`.ai/coordination/PROTOCOL.md` and inspect `.ai/state/tasks/` and
`.ai/state/handoffs/`. The protocol is mandatory whenever more than one agent
or session can touch the repository.

- one task has exactly one active owner;
- an agent must claim or receive a task before editing its scope;
- an agent must not edit files owned by another active task;
- discoveries that affect another task are sent through a structured handoff;
- task and handoff records are repository state, not architectural authority;
- changing the protocol, registries, policies, hooks, permissions, skills, or
  MCPs requires a separate task and explicit owner approval;
- provider chat history is never treated as shared state or evidence;
- before writing a task record, re-read it and refuse the write if ownership or
  revision changed unexpectedly;
- run the repository's AI-state validation before reporting completion.

## Before editing

Declare:

```text
Task:
Objective:
Applicable decisions:
Open decisions:
Affected files:
Dependencies:
Inputs and outputs:
Validations:
Risks:
```

## Completion criteria

A task can only be declared complete with applicable evidence:

- format;
- lint;
- typecheck;
- tests;
- build;
- codegen;
- schema validation;
- diff review;
- acceptance criteria;
- documentation;
- Graph IR;
- risks and limitations.

## Completion format

```text
Task:
Result:
Files created:
Files changed:
Commands run:
Validations:
Decisions:
Dependencies and licenses:
Context used:
Graph IR:
Risks:
Rollback:
Next task:
```

## Stop conditions

Stop and request a decision when:

- an open gate would change the structure;
- a major ABI change is involved;
- a persisted protocol would be broken;
- GPU sharing between runtimes is required;
- a new workspace or lockfile is required;
- credentials, publishing, or production access are required;
- a `LOCKED` decision appears unviable;
- the scope grows materially.
