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

`src/app/lab/` is where a new **spike** lives (root `AGENTS.md` Mandatory
rules, `GRAFTING_MASTER_SOURCE.md` "Throwaway spikes", 2026-08-07). A
disposable experiment is declared as a trial page here rather than as a new
top-level `spikes/` directory, so it is runnable and comparable next to the
other trials in the `/lab/trials` gallery instead of being an orphan tree at
the repository root. A trial captures a preview image through
`src/lab-preview-storage.ts`, which the gallery shows as its cover. A trial is
experimental by definition: it carries no stability promise and may be deleted
outright once accepted, rejected, or rewritten as production code.

`src/layout-client.ts` and `src/layout.worker.ts` are a thin app-owned batch
boundary to generated Wasm. Do not reproduce the Rust layout heuristic in
TypeScript.

`src/bench/` owns the dataflow node bench (DEC-057,
`docs/adr/ADR-0019-editable-canvas-and-node-bench.md`) and is deliberately
separate from the explorer's `presentation.ts`/`canvas-composition.ts`/
`canvas-views.ts`. A laboratory element is declared once in
`src/bench/registry.ts` — identity, ports, and a parameter schema — and the
menu, the parameter controls, the port colors, and duplication all derive from
that declaration. Adding an element MUST be a registration, never a change to a
bench UI file; if a new element needs a control the schema cannot express,
extend `BenchParamSpec`, do not special-case the panel.

`src/bench/registry.ts` declares what an element *is*; `src/bench/evaluators.ts`
declares what it *does*, and receives its Wasm entry points by injection so it
stays testable outside a browser. `evaluatorCoverage` asserts the two halves
have not drifted apart — keep that assertion passing rather than deleting it.

Value-kind compatibility (`checkBenchConnection`) is product policy that belongs
here because the generic canvas cannot have it. Evaluation order and cycle
detection remain Rust-owned in `grafting-graph-core` and reach the bench through
`evaluation-order-client.ts` (DEC-051); do not compute either in TypeScript.

The TypeScript filters in `evaluators.ts` are laboratory instruments, not domain
logic. Nothing authoritative may depend on them; a filter that becomes part of
how Grafting actually generates terrain belongs in a Rust crate under
`libs/domains`, like `discretize` already is.

The bench worker is long-lived and owns the result cache keyed by the plan's
content hashes. Intermediate values MUST NOT cross to the main thread — only
the previews the surface asked for. Adding a value kind means teaching
`preview.ts` how to flatten it, not shipping the raw grid to React.

`stories/` is generated: `scripts/generate-stories.mjs` deletes the whole
directory before rewriting it from the UI doc mesh. Hand-written stories go in
`stories-authored/`, which the generator never touches and `.storybook/main.ts`
includes separately. Never place an authored story under `stories/` — it will be
deleted on the next regeneration without warning.

ADR-0016's VTT generation-test surface may render Rust/Wasm output through
`@grafting/ui`'s heightfield element. VTT map/domain logic
must not leak into the Graph IR explorer's `presentation.ts`,
`canvas-composition.ts`, or `canvas-views.ts`.
