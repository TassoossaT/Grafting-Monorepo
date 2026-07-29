# AGENTS.md — Architecture Studio

Scope-local addendum to the root `AGENTS.md`.

Derived Graph IR is read-only. This app MUST NOT edit generated facts or bypass
schema/policy/plan review for authored workflows. It maps Graph IR and
application-owned presentation enrichment directly to `@grafting/x6-canvas`;
the transitional `graph-x6` boundary was removed by the Graph IR v1 cutover.
It does not import raw X6 or VTT map semantics.

The app only composes and presents capabilities. Reusable repository,
documentation, test-evidence, and graph logic belongs in Grafting packages.
External visualization APIs must remain behind their designated smallest
owning boundary. This does not require a separate package for every library or
layer (DEC-049).

Reusable graph structures and calculations belong to `grafting-graph-core`.
The app may own labels, colors, icons, viewport state, and other presentation
metadata, but calculation-affecting data crosses an explicit Rust contract
(DEC-051).

`src/presentation.ts` owns Graph IR-to-canvas projection and the single
Rust-layout request configuration. `src/canvas-views.ts` owns application view
IDs/data contracts. `src/canvas-composition.ts` is the single concrete canvas
composition and owns UI mounts, colors, ports, edge presentation, effects,
surface, and interaction policy (DEC-052). Do not move those product choices
back into `@grafting/x6-canvas` or duplicate them across UI files.

`src/layout-client.ts`
and `src/layout.worker.ts` are a thin app-owned batch boundary to the generated
`@grafting/isekai-wasm` package; do not reproduce the Rust layout heuristic in
TypeScript.
