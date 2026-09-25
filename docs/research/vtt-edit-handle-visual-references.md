# VTT edit-mode handle visual references

- Status: **provisional research capture; not a decision, not an
  implementation plan.**
- Date: 2026-09-18
- Scope: visual/tactile reference material for the four handle types in
  #318 (vertex, edge/segment, surface/region, diagonal/corner). Written so
  this research survives outside chat/memory while the owner does their own
  Tiny Glade dissection and reviews these links.
- Related: `docs/architecture/vtt-node-and-wall-handle-design-notes.md`,
  `docs/research/vtt-reactive-construction-and-tiny-glade-ui-model.md`,
  `docs/research/vtt-tiny-glade-open-source-ecosystem.md`, issue #318, #309,
  #303.

## Direction settled by the owner before this research

- The player must **never** be exposed to the underlying topology concepts
  (vertex, edge). Those are implementation-side abstractions only. Every
  handle a player sees must be named/shaped by what it *does*
  (height, curve, corner-resize), not by what it *is* in the graph.
- Interaction model: tactile, direct-manipulation, contextual (handles
  appear on hover/selection, not permanently on screen) — closer to a game
  than a CAD tool.
- Visual target: **Tiny Glade's aesthetic** — soft, painterly, minimal
  chrome — not a technical/CAD look.
- Rejected direction: CAD/3D-modeling-tool precedents (Blender control
  points, Godot Path3D handles, Figma corner dots, SketchUp push/pull) were
  the first pass of research and were explicitly rejected by the owner —
  they all expose vertex/edge as a concept to the end user, which
  contradicts the product's premise. Kept below only as a discarded
  comparison point, not as a candidate.
- Closer but not visually right: **The Sims 4** build/roof tools use
  exactly the right *interaction* shape — every handle is named/shaped by
  function (a height arrow, a pitch arrow, an overhang icon, a curve ball),
  never by topology — but the visual style (flat game-UI icons) is not the
  target look.

## Tiny Glade — primary visual/interaction reference

- Wall height: hovering the top part of a wall reveals arrow modifiers;
  dragging up/down changes height in real time.
- Resize/rotate: hovering a building or tower reveals a single draggable
  arrow for resize/rotate — one handle, contextual, appears only on hover.
- Shape reminder: hovering a wall spawns a soft white line tracing its full
  shape even where partly hidden — a ghost/guide line, not a persistent
  outline.
- Cutting/moving: right-click reveals a scissors cursor (cut/isolate a wall
  segment) or a crosshair cursor (move it) — the tool communicates the
  available action through a **cursor state change**, not a fixed docked
  icon.
- Focus mode: gizmos that would obscure the object being placed fade away
  automatically for precision — visibility is context-sensitive, not
  all-handles-always-on.
- Aesthetic: pastel colors, rounded edges, hand-illustrated/storybook look,
  soft glow and painterly lighting/shading, warm medieval materials (stone,
  wood). Nothing reads as "engineering tool" — everything reads as
  "sketching."
- Sources: [Steam guide — Tiny Glade tricks](https://steamcommunity.com/sharedfiles/filedetails/?id=3337755936),
  [PC Gamer — castle-doodling demo](https://www.pcgamer.com/games/sim/tiny-glades-castle-doodling-demo-is-packed-with-delightful-little-reactive-surprises/),
  [Steam discussion — wall adjustment](https://steamcommunity.com/app/2198150/discussions/0/4697909023285288307/),
  [Game UI Database — Tiny Glade](https://www.gameuidatabase.com/gameData.php?id=2052).

## Townscaper — philosophical north star, not a handle source

Interaction is reduced to add/remove a block + choose a color; all
architecture (roof, stairs, walls) resolves procedurally with **zero**
drag handles. Useful only as the extreme end of "player never sees
geometry" — Tiny Glade already sits closer to what #318 needs (it does
have fine-grained drag handles, just contextual/minimal ones).
Source: [How Townscaper Works](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making).

## The Sims 4 — interaction-shape reference (visual style rejected)

- Roof pitch: a single up/down arrow at the roof's top.
- Roof overhang (eaves): small icons at the edge, pull in/out.
- Roof curve: a ball handle — pulling up gives a convex curve, pulling
  down gives a concave curve, degree proportional to pull distance. This
  is the closest existing precedent to #318's "diagonal/corner handle
  that moves multiple vertices while keeping a shape" requirement, even
  though it is curve-specific rather than corner-specific.
- Wall height: a small popup with three different-sized bars (short /
  medium / tall) — a discrete preset control, not a continuous drag.
- Source: [Ultimate Guide to Building Roofs in The Sims 4](https://simscommunity.info/2022/03/04/ultimate-guide-to-building-roofs-in-the-sims-4/).

## Dreams (Media Molecule) — design-philosophy reference

No specific handle geometry found worth copying, but the stated design
goal matches #318's premise closely: a tactile toolset powerful enough for
real creation work that never requires the user to learn technical
vocabulary to get started.
Source: [How Media Molecule designed a fun and robust toolset for Dreams](https://www.gamedeveloper.com/design/how-media-molecule-designed-a-fun-and-robust-toolset-for-i-dreams-i-).

## Discarded comparison set (CAD/modeling-tool precedents, rejected direction)

Kept only so this research isn't silently re-run — the owner already ruled
these out as the wrong reference class, since all of them make vertex/edge
a first-class concept the user directly manipulates:

- Blender Bézier control points (`docs.blender.org` control-points manual).
- Godot `Path3D` curve handle gizmos (`godotengine/godot-proposals`
  discussions #13937, issue #1246).
- Figma corner/edge resize handles (`help.figma.com` shape-tools article).
- SketchUp Push/Pull tool (`sites.google.com/site/sketchupsage`).
- Ink & Switch "Gizmo Design" notes — general affordance reasoning is
  still potentially useful for *layout* (avoiding handle crowding), but the
  gizmo itself is a generic geometric-constraint widget, not a themed one.

## Open, not decided by this file

- No concrete visual spec (shapes, colors, materials, animation) has been
  chosen yet — this file is reference material, not a spec.
- No decision yet on how a Tiny-Glade-soft aesthetic maps onto this
  project's existing render style.
- The owner is doing their own Tiny Glade dissection in parallel; this file
  should be reconciled with those findings before #318 moves to an actual
  component design.
- Still open: dedicated visual-element research for Tiny Glade specifically
  (icon shapes, exact colors/materials, animation/transition style),
  requested next by the owner — not yet done, see chat.
