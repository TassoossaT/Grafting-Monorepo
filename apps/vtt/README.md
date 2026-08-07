# VTT

The virtual tabletop product. **No implementation yet** — this directory
currently holds the decisions and known problems that must be settled before it
gets one.

It exists ahead of its code deliberately, and narrowly: findings from
`apps/architecture-studio`'s node bench need somewhere durable to live, and
scattering them across ADRs that are about other things would lose them. The
root `AGENTS.md` forbids creating the future tree empty; this is one directory
with real content, not a scaffold.

## What is here

- `notes/` — problems found elsewhere that this product must not inherit, each
  written to be actionable rather than a reminder that something was wrong.

## What is deliberately not here

No `project.json`. Nx discovers projects by their manifest, so this directory
is invisible to the task graph, the repo map, and the Graph IR extractor until
there is something to build. Adding one now would put an app with no targets
into every listing and every report.

## When this becomes a real app

It needs an ADR first: `docs/adr/ADR-0016` scoped Architecture Studio's three
surfaces, and DEC-045 fixed how products are distributed. A VTT app is a
product decision, not a directory decision. At that point it gains a
`project.json`, a scope-local `AGENTS.md` with its own rules, and the notes here
become either resolved decisions or explicit accepted risks.
