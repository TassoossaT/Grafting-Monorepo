# ADR-0014: composable capability packages and product-owned presentation

- Status: Accepted
- Proposal date: 2026-07-29
- Decision date: 2026-07-29
- Record: DEC-052
- Backlog item: X6-003
- Related gate: None
- Supersedes: None
- Amends: ADR-0011
- Related: ADR-0008, ADR-0013
- Decision owner: repository-owner
- Source task: X6-003-COMPOSABLE-CANVAS

> **Amendment (2026-08-04):** DEC-056 and ADR-0018 preserve this ADR's neutral
> composition and product-owned presentation rules while superseding its
> X6-specific package allocation. The active canvas boundary is now the
> `@grafting/ui` root API with private renderer integrations.
## Summary

Reusable packages provide neutral capabilities that products can freely
combine, customize, and replace. Product-specific visual identity, semantic
roles, effects, and interaction policy belong to application composition, not
to the reusable package.

## Context

DEC-049 established the smallest useful consumer-agnostic boundary and private
ownership of third-party APIs. The first React-node implementation in
`@grafting/x6-canvas` correctly isolated X6 but embedded one Ant Design Card,
fixed roles, colors, ports, edge themes, surface styling, and interaction
choices inside the reusable adapter. That made the package a finished product
component instead of a capability that could render a card, circle, bespoke
diagram element, animated effect, or future product style through composition.

The repository's intended model is combinatorial: packages act as blank,
generic capabilities and applications combine concepts into a product. A
durable rule is required so vendor isolation does not accidentally become
product-policy centralization.

## Scope

### In scope

- Reusable package contracts, defaults, extension points, and dependency direction.
- Ownership of concrete node views, edge presentation, visual effects, surface styling, and interaction policy.
- The X6 canvas, shared React UI, and Architecture Studio composition boundary.

### Out of scope

- Graph structures, queries, layout mathematics, and other Rust-owned computation.
- Selection or layout algorithms beyond the existing DEC-051 boundary.
- Choosing one permanent component library or one permanent visual language.

## Decision drivers

- Products must be able to replace a node, arc, effect, or complete visual treatment without forking an adapter.
- Third-party types must remain private under DEC-049.
- Reusable packages must not acquire product semantics or duplicate graph computation.
- Defaults may improve ergonomics but cannot become fixed policy.
- Public contracts need API baselines and behavioral tests under DEC-051.

## Options considered

### Option A: concrete views owned by the reusable adapter

The adapter registers a fixed catalog of Cards, roles, ports, edge themes, and
canvas styles. This is initially convenient but couples all products to one
presentation, reverses the composition dependency, and requires package edits
for every new visual idea.

### Option B: neutral mechanisms with product-supplied composition

The adapter owns X6 integration and exposes Grafting-owned mount, terminal,
presentation, surface, and interaction contracts. Applications supply concrete
node mounts and edge presenters, commonly by composing a shared UI package.
This introduces an explicit composition file but preserves freedom and vendor
isolation simultaneously.

## Decision

Option B is accepted. A reusable capability package must expose neutral
mechanisms, Grafting-owned composition contracts, extension points, and only
replaceable defaults. It must not hardcode a consuming product's visual
identity, semantic roles, effects, or interaction policy.

`@grafting/x6-canvas` privately owns X6 and React-shape lifecycle adaptation.
It accepts product-supplied node mount definitions, edge presenters, terminals,
surface options, and interaction choices without exposing X6, React, ReactDOM,
or Ant Design types. `@grafting/ui` privately owns its React/Ant Design render
implementation and may expose a Grafting-owned DOM mount lifecycle. The
Architecture Studio owns the concrete composition of those capabilities.

This decision does not prohibit replaceable defaults, technical wrappers with
no visible presentation, or concrete reusable components in a UI package. It
prohibits treating those defaults or components as the only form supported by
an otherwise generic capability.

## Consequences

### Positive

- Products can introduce arbitrary node shapes, arc styles, effects, and UI components through composition.
- X6 and Ant Design remain isolated without coupling the canvas package to the UI package.
- Product presentation has one explicit authored location and reusable packages remain generic.
- New visuals do not require branches in canvas lifecycle code.

### Costs and trade-offs

- Each application must declare its concrete canvas composition.
- Mount and disposal lifecycles become explicit contracts that require tests.
- The initial fixed X6 canvas API requires an atomic breaking migration and API-baseline update.

## Compatibility and migration

X6-003 atomically replaces fixed node/edge roles and the built-in `card` view
with application-supplied view definitions and presentation callbacks. The
Architecture Studio migrates in the same task. `@grafting/x6-canvas` drops its
dependency on `@grafting/ui`; the application consumes both packages directly.
No persisted Graph IR or Rust ABI changes.

## Validation and evidence

- Acceptance criterion: `@grafting/x6-canvas` contains no product color, card, Graph IR role, or fixed edge-theme contract.
- Acceptance criterion: an application can supply multiple node view IDs and arbitrary DOM mount implementations without importing X6 or React types.
- Acceptance criterion: edge shape, terminals, labels, effects, surface, and interaction choices are supplied or replaced by the consumer.
- Evidence: `packages/x6-canvas/tests/composition.test.mjs`.
- Evidence: `apps/architecture-studio/test/canvas-composition.test.mjs`.
- Evidence: generated TypeScript public-API baselines for `@grafting/x6-canvas` and `@grafting/ui`.

## Risks

- A generic contract could mirror X6 too closely; contracts therefore use a deliberately smaller Grafting vocabulary.
- DOM mounts could leak resources; every mount returns an update/dispose handle and disposal is behaviorally tested.
- Presentation code could absorb graph calculations; DEC-051 continues to require significant graph computation in Rust.

## Rollback

Revert the X6-003 code and API-baseline migration as one unit while preserving
this ADR as historical evidence. A rollback must not reintroduce vendor types
into consumers or duplicate graph computation.

## Follow-up work

- X6-003-COMPOSABLE-CANVAS: implement and validate the accepted boundary.
- Future product tasks: add concrete node shapes and effects only when a real consumer needs them.
