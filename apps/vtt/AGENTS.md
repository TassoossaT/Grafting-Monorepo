# AGENTS.md — `apps/vtt`

This file extends the repository root `AGENTS.md` for work under `apps/vtt/**`.

## Required context

Before structural work, read:

1. `docs/adr/ADR-0023-vtt-application-architecture.md`;
2. `docs/architecture/vtt-application-architecture.md`;
3. only the `notes/` or roadmap items governing the feature being changed.

The architecture specification is normative for module placement, dependency
direction, runtime ownership, state partitioning, gesture behavior, and tests.

## Scope rules

- Keep VTT vocabulary, workflows, presentation, and interaction policy in this
  app. Never add a `vtt` namespace or app-exclusive method to a reusable
  package.
- Do not reproduce reusable algorithms or authoritative behavior in
  TypeScript. Consume the canonical generic capability through an app-owned
  port and adapter.
- Create a directory only with its first real implementation or test. The
  conceptual tree in the architecture specification is not a scaffold list.
- Cross-slice imports use the target slice's `index.ts`. Feature-to-feature and
  entity-to-entity imports are forbidden.
- React components do not instantiate Workers, renderers, network clients, or
  persistence implementations. The tabletop composition root owns their
  lifecycle through app-owned contracts.
- Keep the Server/Client Component boundary narrow. Browser APIs begin inside
  the tabletop client entry, never during server rendering.
- Do not treat proposed DEC-057, DEC-058, or DEC-059 as accepted.

## Required validation

For every implementation change, run the applicable Nx targets:

```text
pnpm nx run vtt:check
pnpm nx run vtt:test
pnpm nx run vtt:build
pnpm nx run vtt:docs-generate
pnpm nx run vtt:docs-check
```

Also run repository Graph IR generation/checks when project metadata,
dependencies, targets, or source topology changes.
