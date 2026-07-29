# `@grafting/x6-canvas`

Generic AntV X6 wrapper shared by graph-oriented products (DEC-046). Its first
real production consumer is Architecture Studio. The public API does not expose
the mutable X6 `Graph`; it returns only immutable counts, centering, selection,
activation, and disposal operations.

The package contains no Graph IR or VTT domain logic.

Consumers may supply vendor-neutral visual roles (`group`/`item`/`note` and
`hierarchy`/`dependency`/`reference`). The private adapter maps those roles to
reusable SVG cards, connection ports, label capsules, vertical hierarchy curves,
horizontal dependency curves, markers, and a responsive dotted canvas. Connector
names and all other X6 configuration remain internal. Coordinates and any
future graph-aware edge waypoints remain Rust-owned.

Targets:

- `x6-canvas:check` — strict TypeScript checking;
- `x6-canvas:build` — JavaScript and declaration output;
- `x6-canvas:test` — behavioral contract for the immutable public handle;
- `x6-canvas:api-check` — in-memory declaration emit, TSDoc enforcement,
  forbidden-vendor-type scan, and comparison with the tracked baseline.

The public API baseline is generated from the package's pinned TypeScript
compiler and tracked at `tests/snapshots/public-api.md`. It contains the
consumer-facing declaration entry point and its TSDoc. Internal modules and
the private `@antv/x6` implementation are deliberately excluded.

To intentionally update the baseline after changing the API or documentation:

```powershell
$env:UPDATE_SNAPSHOTS = "yes"
pnpm --filter @grafting/x6-canvas api-check
Remove-Item Env:UPDATE_SNAPSHOTS
```

Review the generated diff together with affected consumers and behavioral
tests. A normal `api-check` never changes the baseline.
