# VTT covering contracts: definitions built for replaceability

- Plan date: 2026-08-21
- Status: **proposed contracts, uncommitted.** No decision is closed here, no
  API is accepted, and this is not an ADR. Names are deliberate but
  provisional.
- Companion to `docs/architecture/vtt-surface-covering-transformation-plan.md`,
  which describes the migration. This document defines the shapes that
  migration converges on.
- Authority preserved: `DEC-049`, `DEC-051`, `DEC-052`, `DEC-060`,
  `ADR-0011`, `ADR-0013`, `ADR-0014`, `ADR-0017`, `ADR-0022`, `ADR-0023`.

## 1. The goal, stated as a test

Owner direction: *"para que trocar no futuro não seja custoso."*

That is only meaningful if the things likely to be swapped are named in
advance. §7 lists them, with what each swap costs. Every contract below exists
to keep one of those costs at "one adapter" instead of "every consumer."

A design is *not* more replaceable because it has more layers. Each indirection
below is justified by a named, plausible future swap; §8 lists what this
document deliberately refuses to generalize, which matters just as much.

## 2. Seven rules the contracts obey

1. **Identity is opaque and revisioned.** Never a URL, file path, array index,
   or positional id. `tileset-wfc::CellId` is the repository's own cautionary
   case (`ADR-0022`): a positional index persisted as identity shifts when
   anything is inserted before it.
2. **Kinds are open and externally registered — never a closed enum.**
   `ADR-0022` already had to correct one closed enum (`BoundaryKind`), and
   `DEC-052`/`ADR-0014` forbid baking product concepts into infrastructure.
   `@grafting/render-3d`'s `VisualRegistry` is the pattern this repository has
   already proven; every extension point below reuses it rather than inventing
   a second mechanism.
3. **Contracts are plain data.** No behavior, no vendor type, no GPU or DOM
   handle. This is what keeps the renderer private (`DEC-049`).
4. **Transport is not contract.** A contract says "a buffer of N transforms."
   Whether it arrives as JSON, a typed-array view over Wasm memory, or a
   shared buffer is an adapter concern, invisible to consumers (§6).
5. **Express placements, not instances.** The Khronos
   `EXT_mesh_gpu_instancing` note already cited in
   `vtt-procedural-geometric-surfacing.md` makes the distinction explicit:
   transport-time GPU batching is not data instancing. Naming the contract
   after instancing would weld one drawing strategy into it and make LOD —
   which deliberately swaps that strategy by distance — a contract change.
6. **Layout metadata is not authority.** A unit's `dimensions` let a layout
   compute courses. They are not collision, not physics, not vision.
7. **Revisions are scoped independently.** Changing a covering must not bump a
   surface revision; changing an asset must not invalidate unrelated scenes.

## 3. Layer contracts

### 3.1 Covering domain — the drawing region

**Naming correction, 2026-08-22.** An earlier revision called this
`SurfaceRegion`. That name is already taken: `grafting_graph_core`'s
`contour.rs:607` defines `SurfaceRegion { id: RegionId, outer_loops:
Vec<ContourLoop>, holes: Vec<ContourLoop> }`, landed by
`feat(construction-wasm): migrate surface creation to SurfaceRegion` (#151).
Reusing the name for a different concept would have been a genuine collision.

Better than renaming around it: that existing type **is** the boundary this
design needs — outer loops plus holes is exactly the polygon a covering fills.
So the new concept is only the *frame* plus identity, wrapping the existing
region rather than restating it.

```ts
/** Right-handed orthonormal frame in which the domain's 2D coordinates are expressed. */
interface CoveringFrame {
  readonly origin: Vec3;
  readonly u: Vec3;       // unit, in-plane
  readonly v: Vec3;       // unit, in-plane, orthogonal to u
  readonly normal: Vec3;  // unit, u × v
  readonly anchor: FrameAnchor;
}

/** How the frame was derived, so it can be rebuilt identically. */
interface FrameAnchor {
  readonly originNode: NodeRef;
  readonly uDirectionNode: NodeRef;   // origin → this node defines +U
  readonly flipped?: boolean;
}

/** One surface's drawable domain: the existing analytic region, plus a stable frame. */
interface CoveringDomain {
  readonly surfaceRef: SurfaceRef;
  /** Projected from `grafting_graph_core::SurfaceRegion` — never a second copy of it. */
  readonly regionId: string;
  readonly outerLoops: readonly (readonly Vec2[])[];
  readonly holes: readonly (readonly Vec2[])[];
  readonly frame: CoveringFrame;
  readonly revision: number;
}
```

### 3.1.1 Fragments: how a door or window is actually modeled

**Confirmed in code 2026-08-22**, replacing this section's earlier "worth
confirming" note. `region_editing.rs`'s own doc comment states it outright:
*"`AddHole` — what a door or a window is. Structurally nothing new: a hole is
a second real loop of registered edges, validated by the same closure and
manifold rules as any outer loop."*

The topology is half-edge/B-rep shaped, and that is what makes fragments work:

- a `ContourEdge` has stable identity and is a real curve — `Line` **or**
  `CircularArc`, so an arched window needs no polyline approximation;
- `ContourTopology::add_region` validates `outer_loops.iter().chain(holes.iter())`,
  so **a hole registers edge usage exactly like an outer loop does**;
- `check_manifold` allows an edge at most **twice, once per direction**; a
  second use in the same direction is `NonManifoldEdge`;
- `regions_using_edge(edge)` returns the (at most two) regions sharing it.

So a wall with a glazed window is two regions sharing one loop:

| Region | Uses the opening loop as | Direction |
| --- | --- | --- |
| wall | a `hole` | one way |
| window | its `outer_loop` | **reversed** |

Two uses, opposite directions — valid. Each region has its own `RegionId`, so
each takes its own covering: brick on the wall, glass on the window, or `none`
for an open doorway. Because both reference the *same* edges, moving a node of
the opening moves both at once, and adjacency is a lookup rather than a
geometric search.

Three consequences worth stating plainly:

1. **Orientation is the caller's responsibility.** Creating the window region
   with the same winding as the wall's hole fails with `NonManifoldEdge`. The
   TypeScript side must reverse it explicitly.
2. **At most two regions per edge.** Three fragments cannot meet at one edge.
   Sufficient for wall/window/door; a hard limit to know about.
3. **The tools do not author this yet.** `editing.rs` and `diff_apply.rs` go
   through `straight_cycle_region`, which produces a single outer loop with no
   holes. The capability is exposed end to end — Rust `add_hole` →
   `session.rs::add_hole_json` → `construction-session-wasm-adapter.addHole()`
   → `ConstructionSessionPort.addHole()` — but no brush or tool calls it.

This *simplifies* the covering design rather than complicating it: the plan
assumed coplanar sibling surfaces around an opening. Fragments-as-regions is
cleaner, and `SurfaceCovering.targets[]` (§3.2) already spans several regions,
so a shared pattern frame across wall and jambs still works unchanged.

`anchor` is what makes the frame reproducible rather than merely present.
Storing only the resolved axes means a rebuild has to re-derive them, and any
drift re-anchors every pattern on the surface. Storing the two node references
means the frame is a pure function of graph state.

**Genericity note.** The Rust crate that computes layouts must not know about
`SurfaceRef`. It takes `(boundary, frame)` and returns placements; the app
attaches identity. That keeps the crate usable by any consumer with a polygon.

### 3.2 Covering — externally registered, like visual kinds

```ts
type CoveringKind = string;   // open, never a union

interface SurfaceCovering {
  readonly coveringRef: CoveringRef;
  readonly targets: readonly SurfaceRef[];  // coplanar siblings share one frame
  readonly kind: CoveringKind;
  readonly params: unknown;                 // interpreted by the kind
  readonly revision: number;
}

/** Turns a covering's params plus its regions into render output. */
interface CoveringDefinition<TParams = unknown> {
  readonly kind: CoveringKind;
  resolve(domains: readonly CoveringDomain[], params: TParams): CoveringOutput;
  equals?(a: TParams, b: TParams): boolean;
}

interface CoveringRegistry {
  register<TParams>(definition: CoveringDefinition<TParams>): void;
  get(kind: CoveringKind): CoveringDefinition<never> | undefined;
  kinds(): readonly CoveringKind[];
}

interface CoveringOutput {
  /** Meshes to draw — empty for a covering that draws no surface. */
  readonly surfaces: readonly CoveredMesh[];
  /** Prototype placements — empty for a covering that places nothing. */
  readonly placements: readonly PlacementGroup[];
  /** How much this covering occludes, for the visibility system. See §9.2. */
  readonly occlusion?: OcclusionHint;
}
```

This is the single most important shape in the document. It is a deliberate
copy of `VisualDefinition`/`VisualRegistry`, and copying it buys three things:

- **`none` needs no special case.** It is a registered kind returning empty
  `surfaces` and empty `placements`. The pipeline has no `if (kind === "none")`
  anywhere.
- **A new covering costs zero contract change.** Decals, spray-painted
  markings, scattered vegetation, procedural damage, a fog overlay — each is a
  registration, not an edit to a union type consumers must be recompiled
  against.
- **`painted` and `instanced` are not privileged.** They are the first two
  registrations, structurally equal to anything added later.

The registry lives in `apps/vtt` because covering *kinds* are product
vocabulary. The registry *mechanism* is generic enough to extract later if a
second app ever needs it — but see §8.

### 3.3 Placement plan — the Rust output

```ts
interface PlacementGroup {
  readonly groupId: string;
  readonly prototypeRef: PrototypeRef;   // opaque; resolved by the catalog
  readonly chunkId: string;              // spatial bucket, for invalidation
  readonly count: number;
  readonly translations: Float32Array;   // 3 × count, required
  readonly rotations?: Float32Array;     // 4 × count, quaternions; identity when omitted
  readonly scales?: Float32Array;        // 3 × count; unit when omitted
  readonly variants?: Uint16Array;       // count; 0 when omitted
  readonly bounds: Aabb;
}

interface PlacementPlan {
  readonly planRef: string;
  readonly sourceRevisions: readonly RevisionRef[];  // regions + covering + catalog
  readonly groups: readonly PlacementGroup[];
}
```

Decisions inside this shape, and why:

- **Separate T/R/S arrays, not packed `mat4`.** Matches glTF's
  `EXT_mesh_gpu_instancing` layout (`TRANSLATION`/`ROTATION`/`SCALE`), so an
  eventual import or export path aligns instead of converting. It is also
  smaller — 10 floats versus 16 — and omitting `rotations`/`scales` when a
  layout does not use them costs nothing.
- **Quaternions, not Euler.** No order convention to get wrong across a
  language boundary.
- **`variants` is an index, not a payload.** The catalog resolves what variant
  3 means. A plan stays valid when the variant's geometry changes.
- **`chunkId` lives on the group.** Invalidation is per chunk, so a node move
  rebuilds one bucket, not the wall.
- **`sourceRevisions`, not a timestamp.** A consumer can tell exactly why a
  plan is stale, and which input changed.

### 3.4 The one change `@grafting/render-3d` needs

```ts
interface VisualDescriptor {
  readonly geometry: GeometryDescriptor;
  readonly material: MaterialDescriptor;
  readonly pickable?: boolean;
  /**
   * Optional repeated placements of this geometry+material, relative to the
   * item's own transform. Absent means one draw at the item's transform.
   * How these are drawn — instanced, batched, merged — is the backend's
   * choice, never the caller's.
   */
  readonly placements?: PlacementSet;
}

interface PlacementSet {
  readonly count: number;
  readonly translations: Float32Array;
  readonly rotations?: Float32Array;
  readonly scales?: Float32Array;
  readonly bounds?: Aabb;
}
```

This is the minimum viable extension and it is worth arguing for explicitly:
it introduces **no new scene concept**. `describe()` already returns a
`VisualDescriptor`, so an externally registered kind can emit placements
without the engine learning anything. No new item type, no new layer type, no
new registry.

It also keeps rule 5 honest: the contract says *where things are*, and
`InstancedMesh` versus `BatchedMesh` versus a merged buffer stays entirely
inside `src/backend/three/`.

Note the process cost: `@grafting/render-3d` has a generated public-API
baseline (`tests/snapshots/public-api.md`) and `forbiddenModules`. Any change
here requires regenerating that baseline and passing `api-check`, per
`DEC-051`. That is a feature — it makes the boundary change visible in review.

### 3.5 Prototype catalog

```ts
type PrototypeRef = string;   // opaque; never a path or URL

interface PrototypeDefinition {
  readonly prototypeRef: PrototypeRef;
  readonly revision: number;
  /** Layout metadata only. Not collision, not vision (rule 6). */
  readonly dimensions: Vec3;
  /** Documented local frame so layouts need no per-asset correction. */
  readonly localFrame: PrototypeFrameConvention;
  readonly variants: readonly PrototypeVariant[];
  readonly lods?: readonly PrototypeLod[];
  readonly provenance: AssetProvenance;   // source, license, attribution
}

/** Turns an opaque ref into something drawable. Registered, like everything else. */
interface PrototypeResolver {
  resolve(ref: PrototypeRef, variant: number, lod: number): VisualDescriptor;
}
```

`PrototypeResolver` is the seam that makes §7's asset-source swap free. A
parametric box, a decoded `.glb`, and a procedurally generated mesh are three
resolvers behind one opaque ref. Nothing upstream of the resolver knows which
it got.

`provenance` is not optional bookkeeping: the repository's own research
registry already tracks CC0 licensing per candidate pack, and
`THIRD_PARTY_NOTICES.md` has an enforced check.

## 4. Where each contract lives

| Contract | Home | Why there |
| --- | --- | --- |
| `RegionFrame`, `RegionBoundary`, layout math, `PlacementPlan` production | new Rust crate (`libs/domains/procgen/surface-dressing`) | `DEC-051`/`ADR-0013` |
| Wasm exposure of that crate | colocated `*-wasm` package | `ADR-0017` |
| `CoveringDomain`, `SurfaceCovering`, `CoveringRegistry` | `apps/vtt` (`entities`/`features` + a port) | product vocabulary (`ADR-0023`) |
| `PrototypeDefinition`, `PrototypeResolver`, catalog | `apps/vtt` fixture first; extract to a package when a second consumer appears | `ADR-0014` |
| `PlacementSet` on `VisualDescriptor` | `@grafting/render-3d` | generic capability, no product name |

## 5. Revisions and invalidation

Five independent revision scopes, so no change rebuilds more than it must:

| Revision | Bumped by | Invalidates |
| --- | --- | --- |
| region | node move, cycle change | plans referencing that region |
| covering | binding/params change | that covering's output only |
| prototype | asset geometry/material change | consumers of that prototype |
| plan | recomputation | render chunks it owns |
| render chunk | plan or covering output change | one GPU buffer |

The rule that makes this worth the bookkeeping: **a covering change never
bumps a region revision.** Recoloring a wall must not look like a geometry
edit, or undo/redo and network replication inherit presentation churn.

## 6. Transport (rule 4 applied)

The contracts above say nothing about how a `PlacementPlan` crosses the Wasm
boundary — deliberately, because the current mechanism cannot carry one.

Today every value crosses as a JSON string (`construction-wasm`'s `editing.rs`;
the TS adapter reads positions as `readonly number[]` then converts with
`Float32Array.from`). A thousand placements is ~16k numbers through
`JSON.parse` per rebuild.

Because transport is not contract, this is replaceable in one adapter:

1. **Now:** JSON, for correctness and for small plans. Nothing else changes.
2. **Then:** typed-array views over Wasm linear memory for the numeric buffers,
   JSON retained for the small structural envelope.
3. **If measured necessary:** a shared growable buffer with explicit
   generations.

Consumers see `Float32Array` in all three. Only the adapter changes. This is
the concrete payoff of rule 4, and the reason the plan's Phase 5 is not
blocked on picking the final transport now.

## 7. Substitution matrix — what each future swap costs

| Swap | What changes | What does not |
| --- | --- | --- |
| Three.js → another renderer | `packages/render-3d/src/backend/` | every contract above; already true today |
| Parametric box → authored `.glb` | one `PrototypeResolver` | plans, coverings, regions, layouts |
| Running bond → herringbone, planks, scatter | a layout kind in the Rust crate | every TypeScript contract |
| Instanced → merged mesh or impostor (LOD) | backend strategy for `PlacementSet` | the plan — it names placements, not instances (rule 5) |
| JSON → typed-array Wasm transport | one adapter | every consumer (rule 4) |
| New covering (decal, vegetation, damage) | one registration | nothing |
| In-memory catalog → remote repository | one resolver | `PrototypeRef` is opaque (rule 1) |
| Add per-unit state later | new entity keyed by placement identity | placements stay derived cache (§8) |

If a proposed change breaks a "what does not" cell, the design has regressed
and the change needs review — that is the practical use of this table.

## 8. What this deliberately does *not* generalize

Over-generalization is a cost too, paid immediately and forever.

- **No per-brick entity.** Placements are derived cache, not product state.
  Making each unit an entity buys replication, undo, persistence, and picking
  cost with no current product value. Add it only when a feature needs
  per-unit state, keyed by placement identity.
- **No plugin system for layouts.** Layout kinds are open *inside the Rust
  crate*. A runtime-loadable third-party layout is not a requirement and would
  drag sandboxing and versioning in with it.
- **No second abstraction over the renderer.** `render-3d` is already the
  abstraction. Wrapping it again in the app would double the translation cost
  and hide the boundary `api-check` protects.
- **No empty package scaffolded ahead of its first real implementation.**
  Corrected 2026-08-21: an earlier revision of this bullet said the catalog
  should start as an app fixture and be extracted only after a first consumer
  worked. That contradicts the root `AGENTS.md`, which is explicit that
  packages "MAY be created freely whenever a genuinely reusable capability
  emerges" and that "the test is whether the thing has any product meaning
  baked in, not how many callers it currently has." A resource catalog has no
  product meaning baked in, so it is a package. What still holds is the
  narrower rule (`S4.3`, `DEC-028`): create the package *together with* its
  first working implementation, never as an empty future tree. See
  `docs/architecture/asset-store-package-design.md`.
- **No covering inheritance or cascade.** Resolution is a flat lookup per
  surface. A cascade is a whole style system, and nothing has asked for one.

## 9. Open decisions these contracts leave to the owner

1. **`OcclusionHint`'s shape (§3.2).** A barred gate is the forcing case:
   `physical: true` with near-zero occlusion. Options are a scalar 0–1, a
   coverage fraction derived from the placements, or an authored flag. This
   cannot be settled without `vtt-visibility-and-knowledge-contract.md`
   agreeing — it is the one contract above that is genuinely unresolved rather
   than merely provisional.
2. **Does a covering target one surface or a sibling group?** Modeled as a
   group above (`targets[]`), because retrofitting the group later re-cuts the
   contract and Phase 4 needs it for bond continuity across a door opening.
   Confirm before implementing.
3. **Where coverings persist**, and the default covering for a
   generator-produced surface that names none.
4. **Variant selection authority** — does the plan pick variants from a seed
   (reproducible, Rust-owned) or does the catalog pick per draw (cheaper, not
   reproducible)? The contracts above assume the former.
5. **`PrototypeRef` granularity** — is a variant a separate ref, or an index
   within one prototype as written above?

## 10. References

- `docs/architecture/vtt-surface-covering-transformation-plan.md` — the
  migration these contracts converge on
- `docs/adr/ADR-0022-wall-representation-free-geometry.md` — accepted layering
- `docs/adr/ADR-0014-composable-capability-packages.md` — no product concepts
  in capability packages
- `docs/adr/ADR-0011-package-autonomy-and-external-isolation.md` — vendor
  isolation
- `docs/research/vtt-procedural-geometric-surfacing.md` — layout model, LOD,
  measured-spike requirements
- `docs/research/vtt-asset-placeable-and-assembly-architecture.md` — asset
  definition, ingestion, revision scopes
- `packages/render-3d/tests/snapshots/public-api.md` — the baseline any
  renderer change must update
