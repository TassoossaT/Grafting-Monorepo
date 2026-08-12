# VTT construction layering: graph, mesh, asset, and behavior

- Research date: 2026-08-10
- Status: **partially promoted to a decision.** The graph→mesh→surface→asset
  shape below, and the node operations (move/add/delete/merge/split), are now
  **Accepted** via `docs/adr/ADR-0022-wall-representation-free-geometry.md`'s
  2026-08-10 in-place revision (`DEC-060`) — that document is now the
  authoritative source for that part, this one is the design trail that
  produced it. What remains genuinely open is listed in its own section
  below (the terrain/structure seam, chiefly) — this document no longer
  describes the whole thing as undecided, only the parts that still are
- Decision authority: for the parts marked open below, none, same as every
  document in `docs/research/`; for the parts the ADR above has accepted,
  that ADR is authoritative, not this document
- Scope: how a constructed thing (a wall, a door, a window, terrain itself)
  is represented across generation stages, from raw topology down to a
  renderable, interactive result. Distinct from
  `docs/architecture/vtt-map-construction-roadmap.md` (the already-accepted,
  ADR-0022-compliant contract-level design for boundaries specifically) and
  `docs/research/vtt-wall-representation-options.md` (why a boundary is free
  geometry, not this document's layering question, which is broader and
  applies to terrain too)

## The proposal as the owner stated it

Two things, kept separate on purpose:

1. **The generation graph** — responsible only for the central structure,
   "o esqueleto em si" (the skeleton itself): the irregular grid and its
   topology. This is where a player-driven edit happens (click to place
   something), and the graph's only job is deciding *where* structure
   exists, not what it *is*.
2. **The surface/mesh that sits on top of the graph** — a "camada de
   efeito" (effect layer) carrying properties assembled from
   asset/configuration data. That configuration supplies the parameters
   that give the generated surface its physical character. Concretely, in
   the owner's own example: clicking to place a wall only tells the graph
   "generate a regular normal square" — the layer above is what turns that
   into an actual wall, and that layer's content has nothing to do with the
   map itself.

Observed already working, not just theoretical: the `/lab` trials already
combine an irregular grid with a Perlin heightmap and a 3D mesh pass, and
inside that irregular grid a further irregular-or-regular mesh forms,
producing real randomized structure. The stated next step is a full 3D grid
across the entire map, to delimit objects — with the mesh acting as a
"pre-asset layer" generating a surface inside the irregular grid that itself
still carries little characteristic information, and an asset layer above
that.

## Reframing into four explicit layers

Working through the idea in conversation surfaced that "graph + mesh" is
really describing four layers, two of which were implicit rather than
named. This reframing is not a new invention — each layer already matches a
decision made elsewhere in this repository, just not yet assembled into one
picture:

**Superseded by later conversation, kept for the historical record**: the
table originally here had four layers (Graph, Mesh, Asset, Behavior) with
Mesh doing double duty as both bare geometry and the thing that decides
solid/passage. That turned out wrong — see "Correction" below. The current,
accepted shape (`ADR-0022`, revised 2026-08-10) is:

| Layer | Job | Status |
| --- | --- | --- |
| **1. Graph (topology)** | Nodes plus operations (cycles). Pure connectivity, no visual/semantic meaning at all. Each node carries its spatial position as payload — this *is* "the 3D grid," not a separate structure | Design settled; implementation blocked on `vtt-roadmap.md` Epic 1 (`E1.1`/`E1.2`) |
| **2. Mesh (geometry)** | Pure geometric parameters derived from a cycle of graph nodes. Because a cycle can be any connected set (not two fixed points), a mesh can express any polygon a cycle describes — a hexagon, an irregular outline — not only a rectangle | Settled |
| **3. Surface (semantics)** | `{ type (open/extensible, never a fixed enum), physical: bool, mesh }`. Decides which cycles become real and carries the passable/ground-or-not fact — **the graph itself marks none of this**, only the surface does | **Accepted, `ADR-0022` (revised 2026-08-10, `DEC-060`)** |
| **4. Asset (visual identity)** | Fills the mesh by replication (a small reusable unit tiled along it, count depending on size) or by stretch/fit (a single unique asset scaled to the mesh's exact dimensions). Owns vision-blocking and other rendering-relevant behavior — never the surface | Settled in conversation; not yet its own ADR, but consistent with `DEC-059`'s external visual-kind registry pattern |

A fifth thing sits logically above this stack, external to it: richer
authoritative game state (open/closed, locked, trapped) belongs to
`vtt-roadmap.md` Epic 6's rules system, referencing a Surface by its
node-set identity, never restating its geometry. It is not part of the
four layers above and is not designed yet.

### Correction: the graph does not mark solid/passage/partial

An earlier pass of this document (and this ADR, before its own revision)
assumed the *graph* needed to mark "solid vs. passage" as a structural
fact. The owner corrected this directly: **the graph marks nothing** — "o
grafo não marca, quem marca sobre passagem ou não é a superfície... isso a
superfície sabe, o grafo não sabe e nem o mesh também, o mesh só tem
parâmetros." Passage/solid is a `Surface` fact (`physical: bool` and
`type`), not a graph fact. This is now the table above, not the original
one — kept crossed out rather than deleted so the correction itself stays
legible.

## Problem 1 (owner-identified): a functional door/window is hard to place in this model

Why it is hard: "functional" quietly asks for several things at once that
were not yet separable in the original two-layer framing. A door is not "a
square with a wood texture" — it needs (updated to the corrected,
`ADR-0022`-accepted shape, not the original draft's graph-marks-passage
version):

1. **Graph**: a node cycle — same mechanism as any other surface, the graph
   itself carries no notion of "passage" at all.
2. **Mesh**: the geometry that cycle describes — a frame/gap shape rather
   than a filled block, but this is a property of *which cycle* was chosen,
   not something the mesh layer decides on its own.
3. **Surface**: `physical: false` (or whatever the passable convention ends
   up being) plus an open `type` identifying it as a door-shaped opening —
   this is where "it's a passage, not solid" actually gets recorded, per
   the correction above.
4. **Asset**: which specific door model fills that opening, via stretch/fit
   (a single asset scaled to the surface's exact dimensions) rather than
   replication — supplied externally, owns vision-blocking.
5. **State** (external to the four-layer stack): open or closed, currently
   blocking movement/vision or not — authoritative, changeable, belongs to
   `vtt-roadmap.md` Epic 6's rules system, referencing the Surface by its
   node-set identity. `BoundarySegment` no longer exists as a concept; this
   is not "the same flags as `BoundarySegment` had," it is a new, separate
   layer this document's original draft had not yet distinguished from
   Surface itself.

With graph/mesh/surface/asset/state cleanly separated, a door stops being a
special case: it is a node cycle + a passable surface + a specific door
asset + a state record — the same shape as a wall, differing only in which
cycle, which surface flags, and which asset apply.

## Problem 2 (owner-identified): the whole map risks becoming "one thing"

The owner's own words: "todo meu mapa seria uma coisa só, o que talvez não
faça sentido em alguns casos... talvez isso funcione bem só para terreno e
aí para paredes e outras estruturas eu tenha que seguir outra estratégia."

This is correct, and it was already anticipated — just not cross-referenced
against this conversation before now. `docs/research/vtt-map-and-terrain-construction-options.md`'s
end-to-end pipeline (section "How the generation pipeline fits together")
already treats terrain and buildings as **separate passes with separate
tilesets**, the building pass "running on top of whatever terrain elevation
already resolved at that location" rather than merging into one continuous
mesh. The reason terrain and structures cannot share one grid+mesh: terrain
is continuous and organic (a heightmap-driven relief with no natural seams),
while structures must stay independently, topologically editable per
`ADR-0022` (remodel a wall without disturbing what is around it) — a single
fused mesh would drag the ground along with every wall edit.

**Resolution sketch, not yet validated**: apply the four-layer model **per
domain**, not once for the whole map. Terrain gets its own graph + mesh +
asset stack (continuous, heightmap-driven). Structures get their own graph +
mesh + asset stack (discrete, socket/topology-driven, free-geometry
boundaries per `ADR-0022`). The two meet spatially (a wall's base sits at
whatever height the terrain resolved there) but never structurally (they are
not the same mesh, the same graph, or the same edit history).

## External evidence (research pass, 2026-08-10)

A follow-up research pass looked for how shipped systems and published work
handle both problems. Full sourced findings kept in this session's record;
summarized here with citations.

**Problem 1 (functional door) — the strongest evidence found anywhere for
this document's four-layer split, from real shipped code.** RimWorld's
decompiled source (`Chillu1/RimWorldDecompiled` on GitHub — proprietary,
"personal use only," cited strictly as design evidence, never as reusable
code, the same treatment already given to Veloren/Godot Voxel elsewhere in
this repository's research) shows almost exactly this document's split,
already shipped:

- `RimWorld/RoomLayoutCellType.cs` — topology is a 4-value enum
  (`Empty, Floor, Wall, Door`) with zero visual/material information, plus a
  separate room-adjacency graph (`Delaunator`/`RelativeNeighborhoodGraph`)
  in `StructureLayout.cs` — this document's Layer 1, in real code.
- `RimWorld/LayoutSketch.cs` — `IsDoorAt(...)` queries pure topology; only
  once topology says "door here" does `AddThing(DoorThing, doorStuff)`
  resolve which asset fills it — the Layer 1 → Layer 3 handoff this
  document proposes, not inferred, read directly from the class.
- Door state (open/closed/forbidden/locked) lives on the placed `Thing`
  instance at runtime, independent of both the topology cell and the asset
  definition ([RimWorld Wiki, "Door"](https://rimworldwiki.com/wiki/Door)) —
  Layer 4.

**Dwarf Fortress** corroborates the state-independence point from
documented behavior (not source, DF isn't open):
[Dwarf Fortress Wiki, "Door"](https://dwarffortresswiki.org/index.php/23a:Door)
confirms open/closed/forbidden/pet-passable/internal-external are
independently settable flags — "it is impossible for a door to be forbidden
or 'tightly closed' while propped open" — and that a door can be
deconstructed and rebuilt without the passage itself changing, i.e. topology
and the specific door instance are genuinely separate records in a shipped
game, not merged.

**Problem 2 (map-as-one-thing) — no shipped system was found that formally
proves two independent graph+mesh+asset stacks meeting only spatially.**
What is real is looser, but consistent with the resolution sketch above:

- **Astroneer**'s "Leveling Block" is a dedicated tool object whose entire
  job is producing a flat surface snapped to the terrain voxel grid so
  structures can sit on organic sculpted terrain without becoming part of
  its mesh — i.e. the seam is a real, separately-solved problem in a
  shipped game, not something the engine unifies away.
- **No Man's Sky** base-building objects are typed (`Building`,
  `BuildingFoundation`, `BuildingDecoration`); `Building` objects cannot
  place directly on terrain and must snap to other building
  objects/foundations — buildings form their own connectivity graph via
  snap points, touching terrain only at foundation anchors
  ([NMS Modding Wiki](https://nmsmodding.fandom.com/wiki/Enabling_object_snapping_to_buildable_objects)).
- **Valheim**'s terrain edits are replayable "modifier" deltas over a base
  heightmap, while structure placement runs its own independent grid/snap
  validation — community-mod-documented, not an official engineering
  source, so weighted accordingly.
- **Independent proof the seam is a real, named problem in the field, not
  just this project's worry**: the GDMC (Generative Design in Minecraft)
  academic settlement-generation competition
  ([Salge et al., FDG 2018, ACM](https://dl.acm.org/doi/10.1145/3235765.3235814);
  full text [arXiv:1803.09853](https://ar5iv.labs.arxiv.org/html/1803.09853))
  documents a real entrant failure where a church's door ends up several
  blocks above ground because the building template wasn't adapted to
  terrain slope, "which keeps the villager from entering it" — a
  peer-reviewed, citable instance of exactly this document's Problem 2.

**BSP+WFC connectivity — now more precisely a known-open gap, not merely
undiscovered.** One real attempt was found (Shaan Khan's coursework,
[shaankhan.dev](https://shaankhan.dev/blog/wfc-and-bsp-for-procedural-dungeons-2021),
no public repository), and it **self-reports the path-constraint guarantee
does not work**: "the WFC algorithm fails to properly seal the room,"
requiring "an additional implementation/modification of the back-tracking
algorithm for adding corridors" that was not completed. No production,
license-clear, connectivity-guaranteed open-source implementation was
found. Pure BSP dungeon generators exist as real code (several small
repos); pure WFC dungeon/voxel generators exist as real code (two found,
both effectively abandoned, neither treats doors as a distinct
topology/asset/state entity) — but nothing found combines both with a
working guarantee.

**Academic precedent for door/window placement as a rule system**: Müller
et al., ["Procedural Modeling of Buildings" (CGA shape), SIGGRAPH 2006](https://dl.acm.org/doi/10.1145/1141911.1141931)
is the field's canonical paper — mass shape → facade component split →
doors/windows placed as facade elements under context rules (e.g. "windows
or doors do not intersect with other walls"). It structurally separates
mass generation from facade detail, adjacent to this document's graph/mesh
split, but has **no runtime state layer at all** — it targets static
architectural visualization, not gameplay. Mirahmadi & Shami,
["A Novel Algorithm for Real-time Procedural Generation of Building Floor Plans"](https://ar5iv.labs.arxiv.org/html/1211.5842)
(arXiv:1211.5842) maintains an explicit connection-graph topology that is
logically prior to and separate from physical room geometry, with doors
placed on the geometry only after it resolves — a modest but real precedent
for this document's topology-then-geometry-then-opening order.

**Tiny Glade — the owner's stated primary inspiration, but confirmed *not*
an architecture reference for either open problem.** A dedicated research
pass looked for published technical detail from the developers (Anastasia
Opara/"ana-sthetic" and Tomasz Stachowiak/"h3r2tic"). Confirmed: built on a
heavily customized Bevy (Rust/ECS) with a private Vulkan renderer
([80.lv interview](https://80.lv/articles/exclusive-tiny-glade-developers-discuss-bevy-proceduralism-publishers-cozy-games);
[Wikipedia](https://en.wikipedia.org/wiki/Tiny_Glade)); Opara's own words —
"there are a lot of algorithms and generators, each tailored to a specific
element... how it should behave" — confirm there is no single unified
generation algorithm, only per-element pipelines. The one confirmed public
technical talk (Stachowiak, GPC 2024, ["Rendering Tiny Glades With Entirely
Too Much Ray Marching"](https://www.youtube.com/watch?v=jusWW2pPnA0)) is
about rendering (GI, ray marching, software ray tracing), not structural
decision-making. **No source, official or third-party, describes a
graph/grid representation underneath the free-form drawing** — the only
lead is unverifiable forum speculation, explicitly discounted.

Directly on this document's two problems, confirmed via official Steam
sources:

- **Problem 1 (functional door) does not apply to Tiny Glade — it has no
  door state at all.** Doors are not a placeable element; they emerge from
  tool intersections (the path tool crossing a wall produces a door/arch;
  the window tool crossing an upper floor produces a door) — confirmed via
  [Gamerant](https://gamerant.com/tiny-glade-how-to-make-doors/) and
  [Gamepressure](https://www.gamepressure.com/newsroom/how-to-build-doors-in-tiny-glade-its-harder-than-you-think/z872f9).
  There is no open/closed animation or state — consistent with Tiny Glade
  having no gameplay beyond building/photography. It sidesteps this
  document's Problem 1 by never needing Layer 4 (behavior/state) at all,
  which is exactly why it offers no precedent for solving it.
- **Problem 2 (map-as-one-thing) has no architectural precedent in Tiny
  Glade either** — developer h3r2tic confirmed on
  [Steam](https://steamcommunity.com/app/2198150/discussions/0/4844274022647241858/)
  that the map has a hard size/piece-count cap for performance and
  two-person-team scope reasons ("*Implementing an unlimited mode would take
  a lot of effort... expanding the limits of just about every procedural
  generator*"), not a documented terrain/structure separation or chunking
  system.
- **Townscaper is confirmed as the explicit main inspiration**, official
  dev quote via Steam FAQ: "Townscaper is our main inspiration!" — but no
  technical comparison of the two games' internal mechanisms was published
  by either side.

Net effect on this document: Tiny Glade remains a legitimate reference for
the *feel* of free-form, snap-together construction the owner wants, but
contributes no evidence toward either open problem below — RimWorld and the
academic sources above remain the load-bearing precedents.

## What is still genuinely open

- **The seam itself — unresolved, unaffected by the ADR-0022 revision.**
  Who owns the point where a structure's base meets terrain — does the
  structure query terrain's resolved height, or does terrain get locally
  overridden/flattened under a building footprint? Neither option is
  designed. This is `ADR-0022`'s own "not resolved" list, restated here.
- ~~How "solid vs. passage vs. partial" gets expressed formally at the graph
  layer~~ — **resolved**: it does not. The graph marks nothing; `Surface`
  does (`physical: bool`, open `type`). See "Correction" above and
  `ADR-0022`.
- **What the external Rules/state layer looks like** (open/closed, locked,
  trapped — richer than `Surface`'s `physical: bool`) once tokens and rules
  (Epics 5 and 6 of `vtt-roadmap.md`) need authoritative, changeable state
  on constructed things. Narrower than before: `BoundarySegment` no longer
  exists to compare against, so this is now "design the Rules layer from
  scratch, referencing a Surface's node-set identity," not "decide if an
  existing record is broad enough."
- **How this connects to `E2.3`** (`vtt-roadmap.md`'s task to design the
  VTT's domain entities as real `Command`/`DomainEvent` types) — the
  graph/mesh/surface/asset split is now an accepted contract E2.3 can build
  against (a Surface's node-set identity is stable, so it is a valid
  `Command`/`DomainEvent` reference target), but E2.3 itself has not been
  written against it yet.
- ~~Whether a third domain (interior fixtures, props) needs its own stack
  too~~ — **resolved, by the owner directly**: no. Furniture/props do not
  reuse any of this. This graph/mesh/surface/asset structure is scoped
  exclusively to procedural generation of the map itself (terrain +
  structural skeleton). Furniture and detail items are placed by a
  separate, later system, driven by kit rules (e.g., a table+chair set
  chosen according to house size), explicitly deferred — added at a later
  moment, likely after physics.

## Why this is recorded now rather than designed further

Updated from the original framing (which said none of this was decided):
most of the four-layer model *is* now decided — `ADR-0022`'s 2026-08-10
revision is the authoritative record for the graph/mesh/surface/asset
shape and the node operations. What remains genuinely undecided is the
short list above, chiefly the terrain/structure seam. This document's job
now is to keep the design trail (why each layer is shaped the way it is,
what was tried and corrected along the way) legible for whoever picks up
the remaining open items — not to argue for a conclusion that already
shipped in the ADR.
