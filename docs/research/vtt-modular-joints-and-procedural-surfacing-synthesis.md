# VTT Architectural Synthesis: Modular Joints & Procedural Surfacing (3DCoat Sockets + Julian Bragagna Houdini Patterns)

- **Research Date:** 2026-09-30
- **Status:** Reference only — Architectural Synthesis & Pattern Guide
- **Source Prior Art:**
  - **Pilgway 3DCoat:** *Make Joints* & *Joints Tool* (discrete socket snapping, kitbash alignment, modular interlocking mechanics) — [pilgway.com](https://pilgway.com) / [3dcoat.com](https://3dcoat.com)
  - **Julian Bragagna (@JooleanBoolean):** *Project Skylark* (3D Spline Discretization, Rotation Minimizing Frames, Adaptive Clearance Raycasting, Point Cloud Instancing) & *Project GROT* (Procedural Erosion, Contact Decay, Tendons, Force-Directed Edge Bundling) — [julianbragagna/blog](https://www.artstation.com/julianbragagna/blog)
  - **Grafting Internal Research:**
    - [`vtt-procedural-tech-art-patterns-skylark-grot.md`](vtt-procedural-tech-art-patterns-skylark-grot.md) (Deconstruction of Julian Bragagna's Houdini workflows)
    - [`vtt-procedural-geometric-surfacing.md`](vtt-procedural-geometric-surfacing.md) (Unit prototypes, surface recipes, and instanced batching)
    - [`vtt-asset-placeable-and-assembly-architecture.md`](vtt-asset-placeable-and-assembly-architecture.md) (Asset metadata, sockets, and movable assemblies)
- **Target Application in Grafting Monorepo:**
  - `libs/graph/core` (Canonical Rust Graph Engine — assembly topology and connectivity)
  - `libs/domains/procgen` (Spline discretization, RMF framing, socket matching solver)
  - `packages/assets` (Asset schema, socket/joint descriptors, prototype definitions)
  - `packages/render-3d` (GPU instanced batches, triplanar shaders, joint-proximity contact masks)
  - `apps/vtt` (Interactive construction brushes, magnetic socket snapping UX)

---

## 1. Executive Summary & The Problem Statement

Building real-time procedural environments (bridges, dungeon corridors, castle walls, roads, fences) in a tabletop engine faces two opposing failure modes:

1. **The Pure Kitbash Failure (Rigid Modular Tiles):**
   When modular assets are placed solely via rigid grid snapping or manual placement (the traditional 3D asset pack approach), the result looks artificial. Visible seams appear where pieces meet, textures repeat noticeably, and the system fails to adapt gracefully to organic slopes, curved paths, or uneven terrain.

2. **The Pure Procedural Mesh Failure (Runtime Monolithic Meshing):**
   When the engine attempts to generate every wall, bridge, or parapet via runtime CSG booleans, dynamic extrusions, and per-vertex meshing (the traditional CAD/Houdini offline approach), frame rates plummet, memory usage balloons, and WebGL/WebGPU draw-call batching becomes impossible.

**The Solution:** Synthesize the discrete **Socket / Joint Connection Model** popularized by 3DCoat with the **Adaptive Spline Discretization & Procedural Tech-Art Workflows** established by Julian Bragagna (SideFX / Cloud Imperium Games).

```text
[ User Drawing Gesture / Spline Path ]
                  │
                  ▼
[ 1. Spline Discretization & RMF Framing ] ─────── (Julian Bragagna / Skylark)
                  │
                  ▼
[ 2. Discrete Socket / Joint Matching ] ───────── (3DCoat Joints Tool)
                  │
                  ▼
[ 3. Terrain Raycasting & Adaptive Supports ] ─── (Julian Bragagna / Skylark)
                  │
                  ▼
[ 4. Joint Contact Masking & Triplanar PBR ] ──── (Julian Bragagna / GROT + Procedural Shaders)
                  │
                  ▼
[ 5. GPU Instanced Batched Rendering ] ────────── (@grafting/render-3d)
```

---

## 2. Deconstructing the Two Source Paradigms

### 2.1 The 3DCoat Paradigm: Sockets as First-Class Asset Metadata

In 3DCoat's *Make Joints* workflow, assets are not treated as inert 3D meshes. Instead, each unit prototype carries declared **Joints / Sockets**:
* **Transform Anchor:** A local 3D position $\mathbf{p} \in \mathbb{R}^3$, an outward-facing normal vector $\mathbf{n}$, and an up-vector $\mathbf{u}$.
* **Classification & Gender:** Connectors carry category tags (e.g., `wood_beam_end`, `wall_socket`, `balustrade_pin`) and mating rules (e.g., male-to-female, or hermaphroditic/neutral).
* **Alignment Constraint:** Automatic magnetic alignment enforces $\mathbf{n}_B = -\mathbf{n}_A$ and $\mathbf{u}_B = \mathbf{u}_A$, eliminating manual rotation fiddling.

**Limitation in isolation:** In 3DCoat, this is primarily an interactive, manual placement tool inside a modeling room. It does not understand adaptive slope calculations, terrain clearance, or dynamic procedural roads.

### 2.2 The Julian Bragagna Paradigm: Splines, RMF, and Point Cloud Instancing

In Julian Bragagna's *Project Skylark* and *Project GROT*, structures are driven by continuous mathematical curves:
* **Rotation Minimizing Frames (RMF):** Prevents the twists and discontinuities inherent to Frenet-Serret framing on 3D inflection curves.
* **Stride Discretization:** Stepping along the curve based on prototype bounding strides.
* **Terrain Raycasting:** Querying the distance between the road/bridge deck and the underlying terrain surface to automatically select appropriate vertical foundation types (direct pile vs. braced timber truss vs. stone arch).
* **Decoupled Point Clouds:** Emitting lightweight transform matrices rather than realized geometry, feeding instanced GPU draws.

**Limitation in isolation:** In Houdini networks, piece-to-piece connectivity is often computed via ad-hoc procedural VEX offsets (e.g., hardcoded bounding box arithmetic). If an asset is swapped for a differently proportioned variant, the generator code must be re-authored.

---

## 3. The Synthesis: Curve-Guided Socket Matching

The synthesis unifies these two models into a robust engine capability:

1. **The Curve guides Trajectory and Cadence (Skylark):**
   The user draws a continuous path on the table. The curve is framed via RMF and stepped using adaptive stride logic.

2. **Sockets govern Connection and Mating (3DCoat):**
   Instead of assuming modular pieces are simple uniform bounding boxes, the placer engine queries the asset's declared `AssetJoint` sockets. The target transform for piece $N+1$ is solved by finding the transformation matrix $M$ that perfectly satisfies:
   $$M \cdot \text{Socket}_{\text{start}}^{(N+1)} = \text{Socket}_{\text{end}}^{(N)}$$
   with angular tolerance limits. If the curve bends more sharply than the joint allows, the solver can either introduce an intermediate joint piece (e.g., an angled spacer) or emit an invalid placement flag.

3. **Dynamic Piers and Secondary Attachments:**
   Vertical pilings and diagonal braces connect to designated "sub-sockets" on the underside of the deck. Raycasts down to the terrain calculate height $h$. Based on $h$, the engine selects the appropriate pier asset and snaps its top socket to the deck's bottom socket.

---

## 4. Resolving the Visual Seam Problem: GROT & Procedural Shaders

The fatal flaw of modular snapping has always been the visible seam between pieces. Julian Bragagna's *Project GROT* demonstrates how procedural texturing eliminates this problem:

### 4.1 World-Space Triplanar Projection
Individual unit assets do not rely on local UV boundaries for macro materials (stone brick courses, weathered wood grain). Shaders compute UVs in continuous world coordinates $\mathbf{x}_{\text{world}}$, seamlessly projecting textures across interconnected components without visible borders.

### 4.2 Proximity-Based Contact Shading
Because the engine knows the exact coordinates of every active socket connection:
* **Mortar / Sealant Injection:** A shader mask adds mortar or caulking right at the contact plane.
* **Moisture & Moss Accumulation:** Sockets near the terrain or water level multiply a noise-based green/dark mask to simulate rising dampness and organic rot.
* **Contact Ambient Occlusion (AO):** Darkening recesses where modular elements meet, grounding the structure without expensive real-time ray-traced shadows.

### 4.3 Deterministic Instance Jitter
Every placed unit receives a stable, hash-based seed derived from its graph node ID:
$$\text{seed} = \text{hash}(\text{node\_id}, \text{salt})$$
This seed feeds subtle per-instance shader parameters:
* $\Delta \text{Hue} \in [-3^\circ, +3^\circ]$
* $\Delta \text{Roughness} \in [-0.05, +0.05]$
* Normal map micro-offset.

Even when assembling 100 identical modular planks or stones, no two adjacent units look completely alike.

---

## 5. Proposed Data Contracts

### 5.1 Asset Joint Descriptor (`packages/assets`)

```ts
export type JointGender = 'male' | 'female' | 'neutral';

export interface AssetJointDescriptor {
  readonly id: string;
  readonly category: string; // e.g. "timber_beam_end", "stone_wall_side", "railing_pin"
  readonly position: [number, number, number]; // Local coordinates relative to asset origin
  readonly normal: [number, number, number];   // Outward connection normal
  readonly up: [number, number, number];       // Tangent up-vector for roll alignment
  readonly gender: JointGender;
  readonly angularToleranceRad?: number;      // Maximum angular deviation allowed during snap
}

export interface UnitAssetMetadata {
  readonly assetRef: string;
  readonly physicalBounds: { min: [number, number, number]; max: [number, number, number] };
  readonly joints: readonly AssetJointDescriptor[];
  readonly materialFamily: string; // e.g. "rustic_timber", "chiseled_granite"
}
```

### 5.2 Mathematical Solver Transform (Rust: `libs/domains/procgen`)

To align a child socket $S_c = (\mathbf{p}_c, \mathbf{n}_c, \mathbf{u}_c)$ to a parent socket $S_p = (\mathbf{p}_p, \mathbf{n}_p, \mathbf{u}_p)$ in parent world space:

1. **Rotation Matrix $R$:**
   Compute rotation such that:
   $$R \cdot \mathbf{n}_c = -\mathbf{n}_p$$
   $$R \cdot \mathbf{u}_c = \mathbf{u}_p$$
2. **Translation Vector $\mathbf{t}$:**
   $$\mathbf{t} = \mathbf{p}_p - R \cdot \mathbf{p}_c$$
3. **Compound Transform Matrix:**
   $$M_{\text{child}} = \begin{bmatrix} R & \mathbf{t} \\ \mathbf{0}^T & 1 \end{bmatrix}$$

---

## 6. Architectural Boundary Conformance

In accordance with [`AGENTS.md`](../../AGENTS.md) and [`GRAFTING_MASTER_SOURCE.md`](../../GRAFTING_MASTER_SOURCE.md):

* **Single Core Authority (DEC-051 / ADR-0013):**
  Spline evaluation, RMF calculation, and socket transform solving must be implemented in Rust (`libs/domains/procgen` / `libs/graph/core`). The TypeScript frontends consume the resulting instance transform matrices.
* **Neutral Capability Packages (DEC-052 / ADR-0014):**
  The socket matching logic and asset joint descriptors belong to `@grafting/assets` and procedural domain crates. They contain no VTT-specific UI assumptions and can be consumed by both `apps/vtt` and `apps/architecture-studio`.
* **Vendor Isolation (ADR-0011 / ADR-0021):**
  Neither Three.js nor any external DCC toolchain (3DCoat, Houdini) is a runtime dependency. We adopt the *algorithmic patterns* and *data models*, expressing them natively in clean TypeScript and Rust.

---

## 7. Next Steps & Implementation Milestones

1. **Asset Socket Schema:** Formalize `AssetJointDescriptor` in [`packages/assets/src/`](../../packages/assets/src/).
2. **Procedural Assembly Spike:** In `apps/architecture-studio` (`/lab`), create an interactive prototype that steps modular bridge segments along a user-drawn 3D curve, snapping by sockets and raycasting piers to the terrain heightmap.
3. **Contact Shading Pipeline:** Extend `@grafting/render-3d` instanced materials to accept joint contact planes and world-space triplanar parameters.
