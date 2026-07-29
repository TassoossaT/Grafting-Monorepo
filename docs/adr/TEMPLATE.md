<!--
Copy this file to docs/adr/ADR-NNNN-kebab-case-title.md.

Keep the metadata labels and their order unchanged. Use one line per value so
the repository extractor can index the ADR deterministically. Replace every
placeholder before review. Use "None" when an optional relationship does not
exist.

An agent may author a proposal, but only the repository owner may change its
status from Proposed or fill the final Decision section. An accepted deferral
uses Status: Accepted while the Decision text explicitly says which gate or
choice remains open.
-->

# ADR-NNNN: concise decision title

- Status: Proposed
- Proposal date: YYYY-MM-DD
- Decision date: None
- Record: None
- Backlog item: TASK-ID
- Related gate: None
- Supersedes: None
- Amends: None
- Related: None
- Decision owner: repository-owner
- Source task: TASK-ID

## Summary

State the proposed architectural outcome and why it matters in one to three
sentences. This text is suitable for a review list, but the complete ADR remains
the authoritative authored document.

## Context

Describe the problem, current constraints, relevant evidence, and why a durable
decision is needed now. Link to repository-relative authoritative sources.

## Scope

### In scope

- List what this decision governs.

### Out of scope

- List adjacent concerns this decision deliberately leaves unchanged.

## Decision drivers

- List the objective criteria used to compare the options.
- Include locked decisions, compatibility obligations, and operational limits.

## Options considered

### Option A: descriptive name

Describe the option, its evidence, benefits, costs, and failure modes.

### Option B: descriptive name

Describe the option, its evidence, benefits, costs, and failure modes.

## Decision

Pending repository-owner decision.

When accepted, replace the pending sentence with the exact decision, its
boundary, and any explicit non-decisions. Do not use this section to silently
close another gate or replace a locked choice.

## Consequences

### Positive

- List the capabilities or guarantees created by the decision.

### Costs and trade-offs

- List complexity, maintenance, migration, and operational costs.

## Compatibility and migration

Explain affected public contracts, persisted formats, consumers, migration
order, and compatibility expectations. Use `None` when no migration exists.

## Validation and evidence

- Acceptance criterion: state a falsifiable condition.
- Evidence: link to a repository-relative test, benchmark, schema, fixture, or
  generated report; do not paste transient command output as authority.

## Risks

- Describe each material risk and its mitigation or stop condition.

## Rollback

Describe how the decision and implementation can be reversed without deleting
unrelated work or rewriting historical evidence.

## Follow-up work

- Reference concrete backlog or task IDs and their dependency order.
