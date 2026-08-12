# VTT

The Next.js host for the virtual tabletop product. The interactive tabletop is
a client-only route inside this app; reusable packages remain unaware of VTT
concepts.

The accepted architecture is recorded in
`docs/adr/ADR-0023-vtt-application-architecture.md`. Implementation agents must
follow `docs/architecture/vtt-application-architecture.md` and this directory's
`AGENTS.md`.

## Current executable slice

- `/` is a server-rendered product entry page.
- `/table/[tableId]` is a Server Component route with a narrow client entry.
- `src/composition/tabletop/` owns one app-local runtime for the open table.
- `test/` verifies runtime lifecycle and source dependency boundaries.
- `notes/` retains unresolved product decisions; a note is not an accepted
  contract until its roadmap task or ADR closes it.

No renderer, Worker, network transport, persistence implementation, game rule,
or authoritative host is selected by this slice.

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
