# Architecture Studio

Read-only repository explorer backed by the real Graph IR v1 artifact. The
application owns its Graph IR presentation mapping, composes directly with
`@grafting/x6-canvas`, and never imports X6 or edits generated facts. A Web
Worker calls the Rust/Wasm graph core to calculate deterministic grouped
positions without blocking the UI thread.

The current slice provides a keyboard-accessible entity list, synchronized
canvas selection, and complete provenance/evidence inspection. Freshness is
reported as unknown until a runtime-consumable deterministic proof exists.
Graph-aware filters, neighborhoods, ordering, and relation summaries remain a
later Rust/Wasm query-boundary checkpoint; they are intentionally not
reimplemented in TypeScript.

## Dynamic projection

The repository structure is dynamic: `pnpm graph:extract` regenerates
`docs/generated/grafting.graph.json`, and the app consumes every project,
target, and relation in that artifact. Adding a project or target does not
require editing the app.

The one authored projection configuration is `src/presentation.ts`:
`PROJECTION` controls node dimensions, colors, spacing, column counts, and
which Graph IR kinds map to generic visual roles or grouping relations. The current
heuristic treats `contains` as project membership, places each project as a
group root, and places its targets below it. The calculation itself remains in
`grafting-graph-core`; TypeScript only translates Graph IR and presentation
metadata across the explicit batch contract.

`@grafting/x6-canvas` renders those generic roles as reusable cards and paths:
hierarchy relations are intentionally quiet vertical curves, while dependencies
use smooth curves, arrow markers, and compact label capsules. X6 styling stays
private to that adapter and no Graph IR kind is interpreted there.

Run locally:

```powershell
pnpm nx run architecture-studio:dev
```

Then open `http://127.0.0.1:4511/` in a supported browser.
