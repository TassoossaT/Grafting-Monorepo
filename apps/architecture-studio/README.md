# Architecture Studio

Read-only repository explorer backed by the real Graph IR v1 artifact. A Web
Worker calls the Rust/Wasm graph core for deterministic grouped positions; the
TypeScript app enriches that immutable result for presentation only.

The current slice provides a keyboard-accessible entity list, synchronized
canvas selection, locally movable nodes, and provenance/evidence inspection.
Dragging a node changes only its position in the current canvas instance; a
reload restores the Rust-produced layout and no Graph IR fact is edited. The
app never imports X6 or Ant Design directly.

## Dynamic projection and canvas composition

Repository structure is dynamic. `pnpm graph:extract` regenerates
`docs/generated/grafting.graph.json`; new projects, targets, and relations do
not require a matching hardcoded list in the app.

The responsibilities are deliberately separate:

- `src/presentation.ts` maps Graph IR and Rust layout snapshots into immutable
  canvas nodes/edges; it is the single authored Rust layout-request configuration;
- `src/canvas-views.ts` owns stable application view IDs and opaque view-data contracts;
- `src/canvas-composition.ts` combines `@grafting/x6-canvas` with
  `@grafting/ui` and owns the current Card, ports, palette, curves, arrows,
  labels, effects, grid, pan, node movement, zoom, selection, and fit policy.

Every current canvas node is the complete `@grafting/ui` `EntitySummary`
component. That component is privately implemented by an Ant Design `Card`;
the X6 host adds no second visible rectangle or competing node geometry.

`@grafting/x6-canvas` remains a neutral mechanism. To add a circle, image,
custom HTML node, another React component, or another arc treatment, add an
application view/presenter to the composition. Do not edit the generic canvas
package unless a genuinely reusable mechanism is missing. Graph-aware
calculation still belongs in `grafting-graph-core`.

Run locally:

```powershell
nx run architecture-studio:dev
```

Then open `http://127.0.0.1:4511/` in a supported browser.
