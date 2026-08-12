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

## Accepted architecture and implementation gate

`docs/adr/ADR-0023-vtt-application-architecture.md` and DEC-061 define the
accepted application architecture. Its normative, agent-oriented implementation
contract is `docs/architecture/vtt-application-architecture.md`.

The physical implementation is tracked by `docs/architecture/vtt-roadmap.md`
task E2.6. Until E2.6 lands, this directory remains notes-only and
intentionally has no `project.json`. That task must create the Nx project,
scope-local `AGENTS.md`, Graph IR metadata, and first real executable slice
atomically; it must not materialize the complete conceptual tree empty.
