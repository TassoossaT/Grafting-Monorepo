# `@grafting/x6-canvas`

Generic AntV X6 adapter shared by canvas-oriented products (DEC-046, DEC-052).
It owns X6 and React-shape integration privately while exposing only immutable
Grafting contracts. The mutable X6 `Graph`, vendor types, and product semantics
never cross its public API.

The package is a blank canvas capability, not a catalog of finished nodes. A
consumer supplies, per canvas instance:

- node view definitions with dimensions, optional ports, and a DOM mount lifecycle;
- edge presenters that choose terminals, curves, markers, labels, CSS effects, and selection treatment;
- optional background, grid, pan, local node movement, zoom,
  activation-selection, and fit policy.

Defaults are neutral and replaceable: transparent surface, no grid, no pan or
node movement, no zoom, no automatic activation selection, and no product
view. Enabling `movableNodes` changes only the private canvas coordinates;
edges, labels, ports, connections, caller-owned input, and graph structure stay
non-editable. A view may mount React, Web Components, SVG-backed DOM, plain
HTML, or another DOM runtime; the contract exposes none of those library types.

The package contains no Card, Graph IR role, VTT semantic, product color,
fixed edge theme, graph structure, query, or layout calculation. Coordinates
and significant graph computation remain Rust-owned under DEC-051.

## Internal organization

```text
src/
|- index.ts                 public neutral contracts and facade
|- contracts/               private controller boundary
|- canvas/                  catalogs, creation, interaction mapping, and handle
|- edges/                   neutral-presentation to X6 mapping and selection
`- nodes/                   generic DOM host, ports, metadata, and selection
```

`nodes/registry.ts` registers one technical React-shape host with no visible
presentation. Concrete node components do not belong in this package. A
consumer adds a format by adding another `CanvasNodeViewDefinition` to its own
composition; canvas lifecycle code does not change.

Targets:

- `x6-canvas:check` - strict TypeScript checking;
- `x6-canvas:build` - JavaScript and declaration output;
- `x6-canvas:test` - composition, mapping, interaction, selection, and disposal contracts;
- `x6-canvas:api-check` - declaration/TSDoc validation, forbidden-vendor scan, and baseline comparison.

The generated public API baseline is tracked at
`tests/snapshots/public-api.md`. To update it after an intentional reviewed
contract change:

```powershell
$env:UPDATE_SNAPSHOTS = "yes"
pnpm --filter @grafting/x6-canvas api-check
Remove-Item Env:UPDATE_SNAPSHOTS
```

Behavioral tests and API snapshots use the single `tests/` root.
