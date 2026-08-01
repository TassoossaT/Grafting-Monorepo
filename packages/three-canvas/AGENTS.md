# AGENTS.md -- `@grafting/three-canvas`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

This package is the sole owner of the `three` dependency, mirroring
`@grafting/x6-canvas`'s ownership of `@antv/x6` and `@grafting/ui`'s
ownership of `antd` (`DEC-049`/`ADR-0011`, `DEC-052`/`ADR-0014`). No other
package or app may depend on `three` directly; consume this package's
neutral, Grafting-owned surface instead. `three` is a `forbiddenModule` in
this package's own public API (`project.json`'s `publicApi.forbiddenModules`)
-- no `THREE.*` type may cross `src/index.ts`.

Add a new export only for a demonstrated consumer need (same rule as
`packages/ui/AGENTS.md`); this package started with exactly one real
capability (`createHeightfieldCanvas`, for the VTT generation-test surface)
and must not grow speculative surface ahead of an actual consumer.

Real GPU/WebGL-context-dependent code (`src/canvas/create-heightfield-canvas.ts`)
is not unit-tested directly -- there is no WebGL context in Node. Pure logic
(`src/canvas/resolve-options.ts`) is extracted specifically so it stays
testable; keep that split when adding new capabilities, and rely on manual
browser verification for the real rendering path, the same compromise
`@grafting/x6-canvas`'s own real X6-instantiating adapter already accepts.
