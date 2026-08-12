# VTT

The Next.js host for the virtual tabletop product. The interactive tabletop is
a client-only route inside this app; reusable packages remain unaware of VTT
concepts.

The accepted architecture is recorded in
`docs/adr/ADR-0023-vtt-application-architecture.md`. Implementation agents must
follow `docs/architecture/vtt-application-architecture.md`,
`docs/architecture/vtt-product-model.md`, and this directory's `AGENTS.md`.

## Current executable slice

- `/` is a server-rendered product entry page.
- `/table/[tableId]` is a Server Component route with a narrow client entry.
- `src/composition/tabletop/` owns one app-local runtime and one renderer for
  the open table.
- tokens are immutable scene placements with stable identity and an optional,
  separate rules/content subject reference.
- placement and subject binding are closed, versioned app operations.
- the VTT adapter owns the token visual while `@grafting/render-3d` receives
  only a generic camera-facing sprite descriptor.
- `test/` verifies identity separation, operation shape, render invalidation,
  runtime lifecycle, and source dependency boundaries.
- `notes/` retains unresolved product decisions; a note is not an accepted
  contract until its roadmap task or ADR closes it.

Collision, snapping, vision/light inputs, rules payloads, Worker use, network
transport, persistence, and the authoritative host remain outside this slice.

## Commands

Run through Nx from the repository root:

```text
pnpm nx run vtt:check
pnpm nx run vtt:test
pnpm nx run vtt:build
pnpm nx run vtt:docs-check
```

Development runs on <http://127.0.0.1:4512> with `pnpm nx run vtt:dev`.

## Growth rule

Create only the directory required by the current executable slice. New VTT
product concepts stay inside this app. Generic calculation or authoritative
reusable behavior must enter through its canonical package contract and an
app-owned adapter; it must not be reimplemented here.
