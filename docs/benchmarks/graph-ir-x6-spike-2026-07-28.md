# Minimal Graph IR + read-only X6 spike — 2026-07-28

Status: **implementation/build complete; real-browser acceptance blocked because
the in-app browser was unavailable in this session.** The spike is not marked
accepted until the built viewer is inspected in a real browser.

## What exists

- deterministic Nx project graph at `docs/generated/project-graph.json`;
- experimental schema at `docs/graph-ir/graph-ir-candidate.schema.json`;
- deterministic extractor/checker at `tools/scripts/generate-graph-ir.mjs`;
- candidate output at `docs/generated/grafting.graph.spike.json`;
- generic, read-only `@grafting/x6-canvas` wrapper;
- Graph IR-specific `@grafting/graph-x6` adapter;
- minimal Architecture Studio host.

The output is deliberately named `0.1-spike` and `grafting.graph.spike.json`.
It does not close I-002 or claim to be the accepted Graph IR v1.

## Result

At the final integrated checkpoint, the candidate contained 21 nodes and 16 edges
covering Nx projects, registered agents, task records, project dependencies,
and task ownership. Input content is SHA-256 hashed and arrays are sorted, so
`graph:check` detects drift byte for byte.

The X6 layers enforce the intended boundary:

```text
Architecture Studio
→ graph-x6 (Graph IR semantics/layout)
→ x6-canvas (generic X6 adapter)
→ @antv/x6
```

The generic wrapper does not expose the mutable X6 `Graph`; its public result
only supports counts, centering, and disposal. `interacting: false` disables
canvas editing. Graph IR evidence remains derived and read-only.

## Validations completed

- Graph generation and byte-for-byte freshness check passed.
- TypeScript checks passed for all three new projects.
- `graph-x6` unit test passed, preserving every node/edge identifier.
- Nx dependency-ordered build passed.
- Vite production build passed: 979 modules, 592.14 KiB JS / 170.14 KiB gzip.
- Nx cache and declared cross-project dependencies were exercised.

The current bundle is intentionally unoptimized spike output; its size is not a
production budget.

## Browser validation still required

Run:

```powershell
pnpm --filter @grafting/architecture-studio dev
```

Then open `http://127.0.0.1:4511/` and verify:

- the status reports the node/edge counts and input hash;
- projects, tasks, and agents render in separate columns;
- nodes and edges cannot be moved, connected, deleted, or edited;
- panning, Ctrl/Command+wheel zoom, and “Center graph” work;
- no console/runtime error occurs.

## Dependencies and supply chain

New direct dependencies are pinned exactly:

- `@antv/x6` 3.1.7 — MIT;
- Vite 7.2.2 — MIT;
- TypeScript 5.9.3 — Apache-2.0.

Observed transitive runtime licenses: `dom-align` MIT, `lodash-es` MIT,
`mousetrap` Apache-2.0 with LLVM exception as declared by its package,
`utility-types` MIT, and `esbuild` MIT.

pnpm's build-script policy blocked `esbuild`'s install script. The viewer still
builds using the platform binary package, so `esbuild` remains explicitly set
to `false` in `pnpm-workspace.yaml`; no security exception was granted.

## Disposition

The schema/extractor and package boundary are suitable evidence for I-002/I-004
planning. Formal acceptance waits only on the real-browser check and a later
owner decision about promoting the candidate schema to Graph IR v1.
