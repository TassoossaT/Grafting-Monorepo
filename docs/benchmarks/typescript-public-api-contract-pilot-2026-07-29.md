# TypeScript public API contract pilot — 2026-07-29

## Scope

I-003B applies DEC-051 to the real `@grafting/x6-canvas` consumer boundary.
It establishes the TypeScript convention without creating another package,
adding another lockfile, changing graph authority, or touching the C# standby.

## Evaluated approaches

| Approach | Result | Reason |
| --- | --- | --- |
| Hand-written interface catalog | Rejected | It would duplicate the authoritative TypeScript declarations and TSDoc. |
| Commit `dist/index.d.ts` as the contract | Rejected | `dist` is a build artifact and would mix runtime output with reviewed compatibility evidence. |
| Add API Extractor | Deferred | Its API report and declaration rollup are appropriate for complex re-export trees, but this package currently has one deliberate public entry point and does not justify another dependency. |
| Pinned TypeScript declaration emit in memory | Selected | TypeScript already produces the declaration consumed through `package.json#types`; capturing that exact entry point avoids internal modules and adds no dependency. |

The official TypeScript documentation defines `.d.ts` output as the description
of a module's external API and supports declaration-only emission. API
Extractor remains a compatible future escalation when a package needs export
tracing or declaration rollups.

Primary references:

- <https://www.typescriptlang.org/tsconfig/declaration.html>;
- <https://www.typescriptlang.org/tsconfig/emitDeclarationOnly.html>;
- <https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html#isolated-declarations>;
- <https://api-extractor.com/pages/overview/intro/>.

## Contract convention

`project.json#metadata.publicApi` declares only project-specific facts:

- the authoritative source entry point;
- the tracked baseline path;
- external modules forbidden in the public declaration.

The reusable `tools/scripts/check-typescript-public-api.mjs` then:

1. loads the project's own pinned TypeScript;
2. reads its normal `tsconfig.json`;
3. typechecks and emits declarations entirely in memory;
4. selects only the declaration named by `package.json#types`;
5. requires TSDoc on each directly exported declaration and public member;
6. parses declaration imports and rejects forbidden modules or subpaths;
7. compares one deterministic Markdown baseline without mutation.

An intentional update requires `UPDATE_SNAPSHOTS=yes`. Normal Nx and CI runs
never write the baseline, install tools, or contact an external service.

## X6 boundary result

The generated `tests/snapshots/public-api.md` records `CanvasNode`,
`CanvasEdge`, `ReadOnlyCanvas`, and `createReadOnlyCanvas`, including required
inputs, outputs, optional fields, operations, and TSDoc. It contains no
`@antv/x6` import or type.

The returned handle behavior now has one private implementation seam under
`src/internal/read-only-canvas.ts`. The public X6 adapter delegates to it, and
the behavioral test verifies that the handle is frozen, exposes only the four
Grafting-owned members, preserves counts, and delegates center/dispose. This
does not move layout or graph computation into TypeScript.

## Validation evidence

- the generic checker's five tests passed, including negative baseline drift,
  missing or empty documentation, forbidden-module, and project-path
  containment cases;
- TypeScript check, build, behavioral test, and public API comparison passed;
- a normal API check preserved both the baseline SHA-256 and its modification
  timestamp, proving that review mode is non-mutating;
- Nx ran `x6-canvas:check`, `x6-canvas:test`, and `x6-canvas:api-check` without
  cache and all passed;
- the direct `@grafting/graph-x6` consumer passed check and test;
- Architecture Studio passed check and a Vite 7.3.6 production build with 980
  modules;
- workflow YAML and project JSON are validated during closure.

## Dependencies and limits

No dependency or lockfile changed. TypeScript 5.9.3 was already pinned and is
Apache-2.0. `@antv/x6` remains the package's existing private runtime
dependency and does not enter the public declaration.

The direct-source TSDoc policy intentionally covers direct exports and their
members. A future package with a complex public re-export tree must either
extend the checker with type-checker-based export tracing or adopt a pinned API
Extractor evaluation; it must not pretend this pilot already proves that case.
Python remains a later I-003 expansion, and C# remains in indefinite standby.
