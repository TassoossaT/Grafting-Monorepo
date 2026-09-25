# Note 0009 — The graph node overlay is debug-only; edit handles are their own concept

- Recorded: 2026-09-23
- Status: **decision recorded, refactor NOT done**. Current code violates rule 1 (see "Today").
- Issues: #332 (this refactor), #318 (shared edit components), #303 (edit contract), #311 (roof)

## Rules (owner decisions)

1. **The dots drawn on every graph node are a provisional, generic visualization of the graph's structure.**
   They must be decoupled and easy to disable, and must have **no function**: no editing, no business rule
   may depend on a dot being drawn or clicked.
2. **Acceptance test:** turning the graph overlay off must not change any tool's behaviour.
3. **Edit handles are a separate concept.** Each structure type declares its own handles (what they grab,
   where they sit, how they move); a dedicated layer draws them, with visuals swappable for assets. Never a
   floating "balloon" icon on a leader line.
4. **Tools identify a node by geometry** (the graph node nearest the hit point, pixel tolerance on screen),
   never by which sprite the ray hit.
5. **Fixes are additive.** Create-vs-edit confusion is solved by distinct helpers for editing and for creating
   (or layers, e.g. rings around a structure) — never by hiding or removing existing handles. A commit that
   made handles contextual (a772ca0c) was reverted for exactly that reason.

## Today (the coupling to remove)

The `nodeId` returned by picking a node sprite is overloaded as:

- the graph visualization itself;
- edit handles: vertex drag, and bezier controls / wall height widgets that masquerade as nodes through
  encoded ids (`panel-height-widget:...`);
- business rules: roof inherits a clicked node's height (`tools/roof/roof-tool.ts`), slope control points
  take a node's height (`tools/slope/slope-commit.ts`). (Openings no longer detect corners by node --
  fixed 2026-09-24; they grab by geometry.)

The runtime also owns handle presentation (`#syncBezierHandles`, `#syncPanelHeightWidgets` in
`composition/tabletop/tabletop-runtime.ts`), and the render adapter knows handle kinds and textures.

## Refactor (tracked in #332)

1. Graph overlay: nodes/edges as a toggleable debug layer with no functional consumers.
2. Edit handles: per-type declarations, one drawing layer, runtime only syncs them.
3. Node identity by geometry in the pointer dispatcher; roof, slope and openings switch to it.
4. One gesture layer (grab, drag, release, click-vs-drag); candidate library `@pmndrs/handle`.
