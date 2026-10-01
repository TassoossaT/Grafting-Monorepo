# VTT Asset Architecture: Decoupled Facet Model, Physics, Hitboxes & Environmental Reactivity

- **Research Date:** 2026-09-30
- **Status:** Reference only — Architectural Specification & Facet Model Guide
- **Source Prior Art & Industry Standards:**
  - **Decoupled Trait/Capability Systems:** Unreal Engine Data Assets / Gameplay Ability System (GAS), Godot 4 Resource Architecture, Bevy ECS Component Facets.
  - **Physics & Hitbox Layering:** PhysX / Jolt / Rapier discrete collision filtering (Solids vs. Hitboxes vs. Hurtboxes vs. Triggers).
  - **Real-Time Environmental Shaders:** Dynamic vertex displacement heightmaps (mud/snow deformation), vertex-color pivot wind simulation (Ghost of Tsushima, Zelda: Breath of the Wild, Julian Bragagna / SideFX).
  - **Structural Destruction via Graph Severance:** Besiege / Kerbal Space Program / Battlefield modular breakage.
- **Related Normative References:**
  - `AGENTS.md` (Neutral capabilities, package autonomy, single source of truth, DEC-049, DEC-051, DEC-052)
  - `docs/research/vtt-modular-joints-and-procedural-surfacing-synthesis.md` (Sockets, RMF framing, triplanar shaders)
  - `docs/research/vtt-procedural-tech-art-patterns-skylark-grot.md` (Procedural surfacing & erosion)
  - `docs/research/vtt-asset-placeable-and-assembly-architecture.md` (Placeable identity vs. visual binding)
  - `docs/architecture/asset-store-package-design.md` (`@grafting/assets` package design)
- **Target Systems in Grafting Monorepo:**
  - `packages/assets` (The external, neutral Asset Definition and Facet Registry)
  - `libs/graph/core` (Rust graph engine — topological connectivity and structural joint severance)
  - `packages/render-3d` (Visual facet, LOD batching, vertex shader wind, triplanar projection)
  - `apps/vtt` (Virtual Tabletop token, prop, and map placement runtime)
  - Native Desktop Engine (C#/.NET consuming the exact same asset descriptors and Rust core)

---

## 1. Executive Summary: The Decoupled External Asset Layer

In traditional game engines and virtual tabletops, assets are frequently coupled to application-specific entity types (e.g., a `WallEntity` hardcodes its 3D model, its HP, and its collision box). This anti-pattern prevents asset reuse across different consumers, breaks headless testing, and forces duplicate asset pipelines.

To fulfill the monorepo's mandatory constraints (neutral capabilities, DEC-052; package autonomy, DEC-049; single canonical core, DEC-051), **assets live in an external, product-agnostic layer (`@grafting/assets`)**.

Assets are modeled using the **4-Facet Orthogonal Model**:
```text
┌────────────────────────────────────────────────────────────────────────┐
│               EXTERNAL ASSET DEFINITION (@grafting/assets)             │
│                                                                        │
│  Asset Ref: "fantasy/timber/bridge_plank_01"                           │
│                                                                        │
│  ├── Facet 1: VISUAL (LOD Meshes, Material Family, Shader Uniforms)    │
│  ├── Facet 2: STRUCTURAL (Joints / Sockets, Break Force Thresholds)    │
│  ├── Facet 3: PHYSICAL (Hitboxes, Solid Colliders, Mass, Friction)     │
│  └── Facet 4: REACTIVITY (Wind Stiffness, Flammability, HP, Deform)    │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
 ┌───────────────┐           ┌───────────────┐           ┌───────────────┐
 │   VTT (Web)   │           │ Desktop Game  │           │ Architecture  │
 │  (Three.js)   │           │  (.NET / C#)  │           │    Studio     │
 └───────────────┘           └───────────────┘           └───────────────┘
 (Consumes Visual,           (Consumes Heavy             (Consumes only  │
  Hitbox, Sockets)            Physics, Audio)             Graph Topology)
```

No consumer owns the asset, and the asset owns no game rules. The consumer inspects declared facets and activates only what its runtime requires.

---

## 2. Facet 1: Physical Representation & Hitboxes

Rendering meshes (with thousands of polygons) must never be passed to the physics engine. The asset declares simplified collision primitives:

### 2.1 Primitive Shapes
- **`box`**: Oriented bounding box $[w, h, d]$.
- **`sphere`**: Radius $r$.
- **`capsule`**: Radius $r$, cylinder height $h$.
- **`convex_hull`**: Simplified convex polyhedron ($\le 32$ vertices) for irregular boulders or rubble.

### 2.2 Collision Roles (Interaction Filtering)
Each collider declares a distinct role:
1. **`solid` (World Obstacle):**
   - Blocks character movement, token pathfinding, and navigation meshes.
   - Triggers physical rigid-body collisions.
2. **`hitbox` (Damage Receiver):**
   - Intersects raycasts for weapon swings, projectile hits, and spell targeting.
   - Carries damage multipliers (e.g., standard, weak point, reinforced).
3. **`trigger` (Proximity Zone):**
   - Non-blocking volume that emits entry/exit events (e.g., a creaky floorboard, a trap trigger).

### 2.3 Physical Properties
- **`massKg`**: Weight in kilograms (e.g., $15.0\,\text{kg}$ for a timber plank, $450.0\,\text{kg}$ for a granite pillar). Used for falling debris, buoyancy, and kinetic impact calculations.
- **`friction`**: Surface grip coefficient ($0.05$ for ice, $0.6$ for timber, $0.85$ for rough stone).
- **`restitution`**: Bounciness factor ($0.0$ for non-elastic mud, $0.2$ for wood, $0.7$ for springy materials).

---

## 3. Facet 2: Structural Integrity & Joint Breakage

Expanding on the 3DCoat *Make Joints* paradigm documented in `docs/research/vtt-modular-joints-and-procedural-surfacing-synthesis.md`, joints are not merely static snap points — they carry structural limits:

### 3.1 Break Force Threshold (`breakForceNewtons`)
Each joint declares the mechanical force required to sever it:
* Light timber peg: $1{,}500\,\text{N}$
* Heavy iron bolt: $25{,}000\,\text{N}$
* Solid stone mortar: $80{,}000\,\text{N}$

### 3.2 Dynamic Severance (Structural Graph Breakage)
When an explosion, cannon hit, or excessive weight occurs:
1. The physics solver computes the kinetic impulse at contact point $\mathbf{p}_{\text{hit}}$.
2. If $\text{Impulse} > \text{Joint.breakForceNewtons}$, the engine removes the connecting edge in the Rust graph core ([`libs/graph/core`](../../libs/graph/core)).
3. **Instant Structural Response:** The structure splits into two independent topological subgraphs. Unanchored segments instantly transition from static level geometry to dynamic rigid-body debris that falls under gravity.

---

## 4. Facet 3: Environmental Reactivity & Shaders

Real-time interactions (wind, footstep deformation, fire, damage peeling) run with near-zero CPU overhead by delegating continuous effects to GPU shaders:

### 4.1 Wind & Foliage Motion (`windStiffness`)
* Assets declare a scalar `windStiffness` $\in [0.0, 1.0]$.
  * $0.0$: Rigid (stone walls, cast iron).
  * $0.4$: Semi-rigid (stout wooden beams, hanging ropes, signs).
  * $1.0$: Fully flexible (tall grass, flower petals, cloth banners).
* **GPU Vertex Shader Execution:**
  $$\Delta \mathbf{x} = \mathbf{w}_{\text{dir}} \cdot \sin(\mathbf{x}_{\text{world}} \cdot \omega + t \cdot s) \times \text{windStiffness} \times \text{vertex.color.r}$$
  The root remains clamped to the ground; only the upper vertices oscillate.

### 4.2 Dynamic Terrain Deformation (`terrainDepressionDepth`)
* When an asset moves across or lands on deformable surfaces (mud, snow, sand), it specifies its imprint profile:
  * `depth`: Maximum depression in meters (e.g., $0.05\,\text{m}$ for boots, $0.25\,\text{m}$ for a heavy wagon wheel).
  * `profile`: Soft radial falloff or tread pattern.
* The renderer stamps this profile onto the dynamic 2D displacement heightmap, instantly depressing the terrain mesh via vertex displacement.

### 4.3 Destructibility & Layer Peeling (GROT Integration)
* **`maxHealth`**: Structural health points.
* **Damage Stages:**
  - $100\%$ HP: Pristine render.
  - $75\%$ HP: Surface micro-cracks and decal scuffs.
  - $40\%$ HP: Outer plaster/wood peeled away, exposing internal brick or framing.
  - $0\%$ HP: Graph edge severed, asset replaced with debris shards.
* **`flammability`**: Susceptibility to fire propagation. Connected joints can propagate heat/fire across graph neighbors.

---

## 5. Facet 4: Visual Representation & LODs

* **LOD Hierarchy:** Ordered list of mesh resource keys (`lod0` for full geometry, `lod1` for mid-distance instancing, `lod2` for distant silhouettes).
* **Material Family:** References procedural shader configurations (e.g., `"rustic_timber_weathered"`, `"chiseled_granite"`), enabling world-space triplanar mapping without per-instance texture baking.
* **Audio Material Tag:** Declares surface acoustics (`"wood"`, `"stone"`, `"metal"`, `"foliage"`, `"mud"`), allowing the host application to trigger appropriate footstep, sliding, and projectile impact sounds.

---

## 6. Formal Data Contracts (`packages/assets`)

Below is the complete TypeScript specification to be integrated into [`packages/assets/src/contracts/`](../../packages/assets/src/contracts/):

```ts
import type { ResourceRef } from "./ref.js";
import type { Vec3 } from "./resource.js";

export type CollisionRole = 'solid' | 'hitbox' | 'trigger';
export type CollisionShapeKind = 'box' | 'sphere' | 'capsule' | 'convex';

export interface CollisionShapeDescriptor {
  readonly kind: CollisionShapeKind;
  readonly role: CollisionRole;
  readonly offset: Vec3;
  readonly dimensions: Vec3; // [w, h, d] for box; [radius, height, 0] for capsule
  readonly damageMultiplier?: number; // e.g. 1.0 (normal), 2.0 (weak point)
}

export interface AssetPhysicsFacet {
  readonly massKg: number;
  readonly friction: number;
  readonly restitution: number;
  readonly colliders: readonly CollisionShapeDescriptor[];
}

export interface AssetReactivityFacet {
  readonly windStiffness: number;       // 0.0 (unyielding) to 1.0 (fully flexible)
  readonly flammability: number;        // 0.0 (incombustible) to 1.0 (highly flammable)
  readonly maxHealth: number;           // Structural hit points
  readonly terrainDepressionDepth?: number; // Depth in meters stamped into mud/snow
  readonly audioMaterial: 'wood' | 'stone' | 'metal' | 'foliage' | 'dirt' | 'water';
}

export interface AssetStructuralJointFacet {
  readonly id: string;
  readonly category: string;
  readonly position: Vec3;
  readonly normal: Vec3;
  readonly up: Vec3;
  readonly gender: 'male' | 'female' | 'neutral';
  readonly breakForceNewtons?: number; // Threshold for structural failure
}

export interface AssetRenderFacet {
  readonly lodMeshes: readonly string[]; // Storage keys or relative paths
  readonly materialFamily: string;       // Procedural PBR shader key
}

/**
 * Universal, decoupled asset definition.
 * All facets are optional: headless tools or non-physical items populate only what applies.
 */
export interface CompleteAssetDefinition {
  readonly ref: ResourceRef;
  readonly revision: number;
  readonly dimensions: Vec3;
  readonly provenance: {
    readonly origin: string;
    readonly license: string;
    readonly attribution?: string;
  };
  
  // Decoupled Facets:
  readonly render?: AssetRenderFacet;
  readonly joints?: readonly AssetStructuralJointFacet[];
  readonly physics?: AssetPhysicsFacet;
  readonly reactivity?: AssetReactivityFacet;
}
```

---

## 7. Migration & Implementation Strategy

1. **Phase 1: Contract Expansion in `@grafting/assets`:**
   Add `physics`, `reactivity`, and `joints` facet schemas to [`packages/assets/src/contracts/definition.ts`](../../packages/assets/src/contracts/definition.ts).
2. **Phase 2: Headless Physics & Hitbox Verification:**
   Verify that server, CLI, and automated test runners can evaluate raycast picking and token-to-wall collisions solely from `AssetPhysicsFacet` without instantiating WebGL or Three.js contexts.
3. **Phase 3: Shader Hook Integration in `@grafting/render-3d`:**
   Expose uniforms for wind vectors, player footstep positions, and joint contact masks within the procedural instanced mesh pipeline.
4. **Phase 4: Structural Breakage in `libs/graph/core`:**
   Add a graph command (`sever_edge_by_force`) that evaluates break thresholds and emits decoupled island components as dynamic debris.

---

## 8. Generation Scope Hierarchy: Cloud (Macro) vs. Element (Micro)

Procedural generation must operate at two distinct structural tiers to prevent performance bottlenecks, texture seam artifacts, and disjointed environment reactions:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   MACRO TIER: THE CLOUD (NUVEM)                        │
│   (Connected Component: entire 50m wall run, road network, or terrain) │
│                                                                        │
│  • Single GPU Instanced Batch: all units rendered in 1 Draw Call       │
│  • Continuous World-Space Triplanar: stone/wood grain flows seamlessly │
│  • Collective Environmental Gradients: ground-contact moss, wind field │
│  • Global Terrain Scatter: Poisson-disk distribution across the patch   │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│  MICRO TIER: ELEMENT (PANEL A)  │     │  MICRO TIER: ELEMENT (PANEL B)  │
│                                 │     │                                 │
│ • Local Tint: e.g. Painted Red  │     │ • Local Tint: Natural Stone     │
│ • Local Aperture: Window Hole   │     │ • Solid (No Apertures)          │
│ • Local State: Damaged/Cracked  │     │ • Local State: Pristine         │
└─────────────────────────────────┘     └─────────────────────────────────┘
```

### 8.1 Cloud-Level Responsibilities (The Collective Whole)
1. **GPU Draw Call Batching:** The entire cloud (e.g. all 12 connected wall panels or a complete swept road) allocates a single `InstancedMesh` buffer in `@grafting/render-3d`. No per-panel draw calls.
2. **Seamless World-Space Shading:** UV coordinates derive from world positions $\mathbf{x}_{\text{world}}$, not local panel polygons. Stone strata and wood grain span across weld seams without border discontinuities.
3. **Collective Environmental Effects:** 
   - Base dampness/moss evaluates height relative to the ground across the whole cloud, creating a continuous organic waterline.
   - Terrain clouds execute stochastic point scattering (*Poisson Disk Sampling*) across the total area, distributing vegetation and pebbles as an integrated biome.

### 8.2 Element-Level Responsibilities (Regional Overrides)
Each individual panel or station within the cloud retains its topological identity:
* **Per-Instance Color Tint:** 
  $$\text{FinalColor} = \text{TriplanarTexture}(\mathbf{x}_{\text{world}}) \times \text{ElementTint}$$
  Allows individual wall sections to be painted, blood-stained, or scorched while preserving the cloud's underlying texture flow.
* **Local Holes & Damage:** A window or breach belongs to a specific region without invalidating the rest of the cloud's instancing pipeline.

---

## 9. Runtime Overrides & Aperture Hole-Masking

### 9.1 Stable Deterministic IDs
Every procedural unit emitted along a spine or within a wall region receives an immutable ID derived from its station and role:
$$\text{UnitID} = \{\text{StructureID}\}\text{:s}\{\text{station}\}\text{:a}\{\text{across}\}\text{ (e.g. "bridge\_01:s4:plank")}$$

### 9.2 The Runtime Mutation Map
Host applications (`apps/vtt`) store lightweight session overrides without mutating the procedural generator recipe:
```ts
export interface RuntimeStructureOverrides {
  /** Items manually erased by the user (e.g. rotted/missing planks, broken crenels). */
  readonly deletedItemIds: ReadonlySet<string>;
  /** Specific items replaced by visual variants (e.g. lantern post, mossy stone). */
  readonly replacedAssets: ReadonlyMap<string, ResourceRef>;
  /** Manual transform offsets for localized nudge adjustments. */
  readonly transformOffsets: ReadonlyMap<string, Matrix4>;
}
```
During instance synthesis, the generator skips any unit present in `deletedItemIds` and applies visual swaps from `replacedAssets`. When the user drags spine handles, manual modifications remain anchored to their respective stations.

### 9.3 Aperture Hole Masking (Doors, Windows, Craters)
In accordance with [`vtt-apertures-doors-and-windows-plan.md`](../architecture/vtt-apertures-doors-and-windows-plan.md):
1. **Topological Holes:** A host region defines its outer boundary loop minus inner hole loops:
   $$\text{ActiveDomain} = \text{OuterLoop} \setminus \bigcup \text{HoleLoops}$$
   The unit asset placer evaluates inclusion: units falling inside a hole are skipped; units along hole perimeter edges automatically orient jamb, sill, and lintel components.
2. **Dynamic Volumetric Holes (Explosions/Blasts):**
   Real-time spherical damage queries:
   $$\|\mathbf{p}_{\text{unit}} - \mathbf{p}_{\text{blast}}\| \le r_{\text{blast}}$$
   matching units are dynamically omitted from the live instance buffer and transitioned into physical debris rigid-bodies.
