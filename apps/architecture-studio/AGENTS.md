# AGENTS.md - Architecture Studio

Scope-local addendum to the root `AGENTS.md`.

Derived Graph IR remains read-only. This app MUST NOT edit generated facts or
bypass schema, policy, plan, and approval review for authored workflows. It
maps Graph IR plus application-owned presentation enrichment to the generic
canvas surface exported by `@grafting/ui`; it MUST NOT import renderer
libraries directly.

The app only composes and presents capabilities. Reusable repository,
documentation, test-evidence, and graph logic belongs in Grafting packages.
External visualization APIs remain behind their smallest owning boundary,
currently the internal canvas module tree in `@grafting/ui` (DEC-049,
DEC-056).

Reusable graph structures and calculations belong to
`grafting-graph-core`. The app may own labels, colors, icons, viewport state,
and other presentation metadata, but calculation-affecting data crosses an
explicit Rust contract (DEC-051).

`src/presentation.ts` owns Graph IR-to-canvas projection and the single
Rust-layout request configuration. `src/canvas-views.ts` owns application
view IDs and data contracts. `src/canvas-composition.ts` is the single
concrete composition and owns UI mounts, colors, ports, connection
presentation, effects, surface, and interaction policy (DEC-052). Do not move
those product choices into the generic UI canvas implementation or duplicate
them across UI files.

`src/layout-client.ts` and `src/layout.worker.ts` are a thin app-owned batch
boundary to generated Wasm. Do not reproduce the Rust layout heuristic in
TypeScript.

ADR-0016's VTT generation-test surface may render Rust/Wasm output through
`@grafting/ui`'s heightfield element. VTT map/domain logic
must not leak into the Graph IR explorer's `presentation.ts`,
`canvas-composition.ts`, or `canvas-views.ts`.
