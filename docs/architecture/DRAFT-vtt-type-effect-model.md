# DRAFT — VTT type/effect model (discussion, not decided)

Temporary, uncommitted. Captures the 2026-09-15 discussion so it is not lost. Formalize into a real architecture doc + issue refinement only when the owner says so.

## Problem

- Type knowledge is scattered: ~20+ sites compare `surfaceType === "..."`, keep `Set`s of type names, or switch on names (tools, analyses, color).
- Two cross matrices grow with every addition:
  - **operation × type**: each new operation needs a function on every type (`roleFor`, `policyFor`, `repairAfterCut`, `motionInfluences`, ...).
  - **type × type**: `interactionOver(coveredType)` answers "what do I do with *that* type" per pair.
- Operations are not reusable: cut is `executeTerrainCut`, repair is `CUT_REPAIR_EXECUTORS` keyed by type name (terrain only), analyses are `terrain-*` modules although they are generic region geometry.
- No single extension point → AI-written code invents mini-patterns ("puxadinhos").
- Owner's stress test: a future "bomb" power must be defined in ONE place and work on every type, possibly touching faces only, not structure.

## Principles agreed by the owner

1. **Types react to effects, never to other types.** No type-name comparison anywhere outside the type registry.
2. **Effects are generic and already work across all types.** Cut, generation/fill, regeneration are written once and reused by every interaction.
3. Hardcoded, coupled analyses are to be removed, not wrapped.
4. Each cloud family keeps its own reaction, because terrain's structure genuinely differs. Only the reusable steps are extracted into a shared toolbox.
5. Effects propagate between clouds. A reaction can emit effects that hit other clouds, which react in turn, as one atomic transaction.

## Proposed model (still open)

Three pieces, none of which knows type names.

### 1. Generic effects
Written once, operate on any region:
- `cut(footprint, targets)` → removes footprint from hit regions, returns holes/rims (fallout)
- `fill(loop, generator)` → fills a closed loop using a generator
- `regenerate(region, generator)` → rebuilds an existing region
- `conform(nodes, support)` → follows a supporting surface's height
- `move`, `remove`, `markFace`

Effects act on **layers**: structure (geometry), face (covering/material/marks), game (walkable, blocks sight, destructible — post-1.0).

### 2. Pluggable generators
- `lattice` — irregular mesh + height field (today's terrain generation, reusable by any organic surface)
- `planar` — platforms, floors
- `panel` — wall between two rails
- `ribbon` — paths, ramps

### 3. Type = data only
```ts
{ name: "terrain",  family: "field", generator: "lattice", traits: ["ground", "supports"] }
{ name: "platform", family: "sheet", generator: "planar",  traits: ["supports"] }
{ name: "wall",     family: "panel", generator: "panel",   traits: ["solid", "hosts-openings"] }
```
- **family** = shared shape code (roles/handles), written once per shape, not per type.
- **traits** = tags effects filter on (`where: trait("ground")`).
- Repair after cut is not a type function: generic pipeline `cut → holes → fill(hole, region's own generator)`.

### Composition examples
- Road stroke: `cut` where `trait("ground")`... + create ribbon; bridge preset uses `conform`/rest instead of `cut` (effect parameter, not `subtype === "bridge"`).
- Platform: `cut` filtered by `trait("ground")`.
- Bomb: `cut` in a volume + `markFace("scorch")`.

### Current interactions mapped
| Today (type × type) | Effect model |
|---|---|
| terrain over terrain → `restack` | raise/regenerate ground on `trait("ground")` |
| terrain over other → `forbid` | default reaction for undeclared = refuse |
| path over anything → `cut` | `cut` + `fill` with each hit region's generator |
| bridge → `ignore` via `subtype === "bridge"` | preset emits `conform` instead of `cut` |
| path `conformsTo` terrain | `conform` onto `trait("supports")` |
| platform over terrain → `cut`, else `ignore` | `cut` filtered by `trait("ground")` |
| panel / roof → `ignore` | rest only, no cut |

### Anti-mini-pattern guards
- One extension point per concept: new type = registry entry; new effect = one module; new primitive = Rust, rare.
- Build-failing test forbidding `surfaceType` string comparisons outside the registry (precedent: `tool-presets-are-placeholders.test.mjs`).
- Relations (opening belongs to wall) derived from topology (shared rim edges), never from names.

## Open questions
1. Closed vs open vocabulary of effects/reactions (recommendation: closed, changes are deliberate + tested).
2. Ownership: traits/tables/dispatcher in app TS (product policy, ADR-0014) with geometric primitives in Rust (recommendation), vs registry in Rust.
3. Scope: design all three layers now, implement structure layer only for 1.0 (recommendation).

## Blocks / related
- #302 opening-type part waits on this (PR #307 did only the interior/room-delete removal).
- Feeds #303 (edit contract per type), #284 (cut repair), #291 (generic delete), #231 (openings); Epic #271 (volumetric ops) is the bomb case post-1.0.

## Code analysis (2026-09-15, master @ 2804030, before PR #307 merges)

Scope surveyed: VTT construction TS, ~20.9k lines. Main modules: `features/edit-construction/structure-types` 4.7k (path alone 3.0k), `composition/tabletop/terrain` 3.1k, `topology` 1.7k, `tools/*` ~4.4k, `interference` 0.8k, `spine` 0.6k, `tabletop-runtime.ts` 1.2k. Rust `construction-wasm` / `graph-core` are **type-agnostic already** (type strings only in tests). That is the good base to build on.

### Dimension
- Type-name literals outside the registry: ~35 sites in ~22 files. Also `isTerrainSurface` has 25 uses; it is a name list plus a `startsWith("terrain")` prefix heuristic.
- Parallel registries keyed by type name: `STRUCTURE_TYPE_DEFINITIONS`, `SURFACE_EDIT_MODE_DEFINITIONS` (terrain → path-brush), `CUT_REPAIR_EXECUTORS` (terrain only), the `colorForSurfaceType` switch, `WALL_COLOR` and `TERRAIN_COLOR` inside tools, `WALL_SURFACE_TYPES`, `TERRAIN_TYPES`.
- Rough blast radius of the full model: 60-70% of the 20.9k lines touched. Most of it is moves and renames of already-generic geometry. The truly new code is small: registry, effect pipeline, guard test.

### Structural findings, worst first
1. **Terrain's reaction mixes its own logic with a toolbox other clouds need.** Owner correction: it is legitimate that terrain has its own reaction to a cut, because its structure differs. Every other cloud should have an equivalent reaction of its own. The problem is only that the reusable steps are trapped inside `executeTerrainCut` and the `terrain-*` modules, so the fix is to extract them.
   - Generic steps: faces-in-area query (`faceIntersectsArea`, `topologyToPolygon`), neighbourhood (`terrainStandingAround`), painter perimeter, absorbed edge-neighbours, boundary constraint rings (`buildConstraintRings`, `perimeterConstraints`, `outlineConstraints`), seam node adoption (`adoptContourNodes`), commit as a replacement.
   - Terrain-specific steps: lattice generator + height field (`heightFieldOf`), concave/convex/dirt profiles, face size, lattice mesh-quality fixes (`dropInventedCorners`).
2. **Cut repair is a hidden side effect of the runtime.** `TabletopRuntime.applyPatchReplacement` always calls `dispatchCutRepairs`, so infrastructure owns interference policy. The dispatch hardcodes `["terrain","terrain-grass"]`, speaks road vocabulary (`newRoadTopologies`, "terreno sob a rua"), and takes overloaded positional arguments (`dispatchRemovalRepairs`).
3. **Several pipelines for the same effect.** The sculpt tool calls `executeTerrainCut` and `restackTerrain` directly. Roads, platforms, roofs and slopes reach cut repair through the runtime hook. Removal goes through `dispatchRemovalRepairs`. Openings use `addPatch` + `addHole` with no repair at all.
4. **No single mutation entry point.** Tools call 5 generic runtime mutations (`addPatch`, `applyPatchReplacement`, `applyRegionEdit`, `addHole`, `removeSurface`) plus type-specific runtime methods (`applyWallCrossingWeld`, `undoPathBrush`/`redoPathBrush`, `generateRegionPartition`). Undo is therefore fragmented; this is the root of #263.
5. **Three curve/ribbon models.** Path has a contour pipeline under `structure-types/path` (~3.0k: `union-bands`, `offset-bands`, `catmull-rom`, `plan-spine-contour`). Slope regenerates its own ribbons (`platform-slope-spine` → `ribbonSections`). Walls keep curves in edge geometry (#299). The generic "ribbon along a spine" generator is hidden inside the path type; `DEFAULT_SPINE_OWNER = "path"`.
6. **`StructureTypeDefinition` is a bag of optional functions:** `roleFor`, `policyFor`, `interactionOver`, `repairAfterCut`, `conformsTo`, `motionInfluences`, `deriveMotion`, `validateMotion`, `spine`. Behaviour lives in code per type, not in data. The orchestrator still special-cases `platform`/`platform-slope` by name (`edit-orchestrator.ts:170`).
7. **Vendor type leak and TS/Rust duplication.** `polygon-clipping`'s `MultiPolygon` appears in domain contracts (`structure-type.ts`, `structural-cut.ts`, `contour-patch.ts`). Boolean ops run in TS in 4 modules while Rust already exposes `planar_boolean_json`. This breaks the AGENTS "no duplicated Rust logic" rule and the "third-party behind own seam" rule.
8. **Full scans filtered by name.** `getAllRegionTopologies()` has 16 call sites, most followed by `.filter(t => t.surfaceType === X)`. Wanted instead: a spatial + trait query.
9. **God objects:** `tabletop-runtime.ts` 1246 lines, `construction-session-port.ts` 729, wasm adapter 681.
10. **Relations inferred by names and proximity.** Openings are found by type-name set + centroid distance (removed with room delete in #307; the pattern must not return). Walls under platforms use `surfaceType !== "platform"` (`wall-shared.ts:201`).

### Target mapping, today → model
| Today | Becomes |
|---|---|
| `executeTerrainCut`, `terrain-fill`, `terrain-constraints`, `terrain-regenerate` | effects `cut` / `fill` / `regenerate` + generator `lattice` |
| `terrain-restack` | effect `regenerate` with height displacement, filtered by `trait("ground")` |
| `dispatchCutRepairs` in runtime | explicit effect pipeline step `cut → fill(hole, hit region's generator)` |
| `interactionOver`, `conformsTo`, `TERRAIN_TYPES`, `isTerrainSurface` | effect params + trait filters |
| path contour + slope ribbons | one `ribbon` generator on spines, owners are data |
| `CUT_REPAIR_EXECUTORS`, `SURFACE_EDIT_MODE_DEFINITIONS`, colors | fields on the single type registry (color → Epic 4 visual registry) |
| 5+ runtime mutations and type-specific runtime methods | one effect/transaction entry, one undo unit (#263) |
| polygon-clipping in domain types | own geometry types; booleans via Rust `planar_boolean` or one adapter |

### Suggested phasing (not decided)
- **A. Registry + guard.** Type = data (family, generator, traits). Add a test that fails on type-name comparisons, with an allowlist of current violations that may only shrink.
- **B. Explicit effect pipeline + extracted toolbox.**
  - The generic pipeline receives an effect (e.g. `cut(footprint)`), finds the hit clouds by spatial query, and hands each cloud the effect through the reaction its type declares. There are no hardcoded type lists and no runtime side-effect hook.
  - Each family keeps its own reaction. Terrain's is slimmed to its generator plus terrain-only steps, built from the extracted toolbox. Wall, platform and path reactions (#284) reuse the same toolbox with their own generators.
  - One transaction entry, absorbing #263.
  - **Chain reactions across clouds (owner requirement).** A reaction may emit new effects. Example: terrain regenerates, the regenerated area reaches a platform, and the platform reacts from its own table. Rules:
    - Reactions are pure planning. Each returns `{ mutations, emittedEffects }` and never commits or calls other clouds directly.
    - The pipeline owns one queue per transaction and processes emitted effects with the same dispatch: spatial query → hit clouds → declared reaction. No reaction knows who reacts next.
    - Termination: a cloud reacts at most once per (effect kind, transaction); the origin cloud is excluded from its own emitted effects; there is a depth cap with an explicit error. The cap is a safety net, not the design.
    - Deterministic order: breadth-first, ties broken by a stable cloud id.
    - Atomic: any `refuse` anywhere in the chain aborts the whole transaction. The whole chain commits as one undo unit.
    - The preview comes from the same chained plan, so the brush-preview contract holds for cascaded changes too.
  - **As implemented in PR #308 (2026-09-15), deviations from the rules above:**
    - Reactions mutate the live state inside one engine transaction instead of returning planned mutations. The engine has no prospective-state API, and transaction rollback gives the same guarantees: atomic, nothing partial, one undo entry.
    - "Reacts once" is per (effect kind, declared reaction), not per cloud. A family answers once across all of its types.
    - Preview is not yet derived from the chained plan.
    - The pipeline reaches faces by their nodes, like the engine's bounds query. A large face with no node near the change is not reached.
- **C. One ribbon generator** for path + slope. One curve-handle capability across spine and edge geometry, feeding #303.
  - **Done in PR #308, 2026-09-15:**
    - `spine/spine-ribbons.ts` is the one generator. Roads, ramp surfaces and ramp motion all sweep spans through it.
    - The legacy TS road model is deleted: Catmull-Rom, offset bands, station sweep, reference line and graphPatchForSpine. It was only reachable without a curve port, which production always has.
    - The spine module names no type any more. Each owner stamps its own spans.
  - **Single bezier handle, owner approved 2026-09-15:** done in PR #308.
    - `topology/curve-handles.ts` provides one set of handles, picks and reshape for spine spans and bezier contour edges.
    - A contour reshape goes through the grabbed role's `reshape` capability. Panel runs carry the opposite run.
    - The engine's `curved_edges_json` places the handles.
    - Not yet: turning a straight edge into a curve, and handles following when an anchor moves.
  - **Note:** `conformsTo` has no production consumer since the reference line went. It is future input to a `conform` effect.
- **D. Migrate tools** to emit effects. Delete type-specific runtime methods. Openings become a data type using topology relations (#302 remainder, #231).
- **D, done in PR #308, 2026-09-15:**
  - Every construction tool commits one gesture through `commitChange` or `commitPatchReplacement`: one transaction, a cut effect, one undo entry. That covers path, curve, platform, roof, ramp, wall (with its T-junction welds), opening and sculpt.
  - `applyWallCrossingWeld` is gone. The runtime has no type-specific methods left.
  - Openings are a data type, `opening`.
  - **Still outside transactions:** the edit-mode drag and the contour curve reshape. They keep region-edit history with inverse ops.
- **E. Geometry seam.** Remove `polygon-clipping` from contracts; route booleans through Rust or one adapter.
  - **Done in PR #308, 2026-09-15:**
    - `topology/planar-area.ts` is the only module that imports the library. It exposes `PlanarArea`, `PlanarPolygon` and `PlanarRing`, with `planarUnion` and `planarDifference`.
    - Domain contracts now carry `PlanarArea`.
    - `test/third-party-seams.test.mjs` holds the rule.
  - **Open:** the TS booleans still duplicate the engine's `planar_boolean`. Switching is now a one-file change, but it needs checking against the real engine first.
