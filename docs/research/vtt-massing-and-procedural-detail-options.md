# Massing plus procedural detail: state of the art, code, and failure modes

- Research date: 2026-08-08
- Status: **raw research on an owner-proposed architecture**. Closes nothing,
  adopts nothing, and deliberately records the arguments against the proposal
  alongside the ones for it
- Decision authority: none, same as every document in `docs/research/`
- Prompted by: the owner's proposal that the grid store only a coarse volume
  plus a *classification* ("this set of cells is a house, the next is a road"),
  with a surface generator called afterwards to produce the real geometry — so
  that no fixed asset library has to be authored, and so that moving or
  regenerating the grid does not lose the design

## The proposal, restated

Two layers with a contract between them:

1. **Massing / blockout.** Low-resolution volume on the existing cell lattice.
   A house is a box with a wedge on top. Persisted state is small: which cells
   belong to which region, and what *type* each region is.
2. **Surface generator.** Consumes a classified region and emits the real
   geometry — walls that may be irregular, varied, weathered. Not persisted;
   derived.

This is not novel, which is good news: it is the dominant architecture for
procedural architecture, and its failure modes are documented rather than
waiting to be discovered.

## The lineage: shape grammars

The canonical work is **Müller, Wonka, Haegler, Ulmer and Van Gool,
"Procedural Modeling of Buildings" (SIGGRAPH 2006)**, which introduced **CGA
shape** — a rule system where coarse mass models are refined by successive
production rules into detailed shells. CityEngine grew out of that work and is
now an Esri product.

The shape is exactly the owner's proposal: a mass model, then rules that split
and refine it. Twenty years of follow-up work means the weak points are
published.

### Documented failure modes, and they land on our requirement

Reported in the literature on layered/irregular extensions:

- **Split grammars enforce a grid-like structure.** Complex geometry generally
  has to be imported rather than generated.
- **Complex mass models need an excessive number of splits.**
- **The mass model cannot easily be changed** — novel configurations demand
  additional production rules.
- **Straight facades are the original and main application field.** Curved and
  organic facades are where the family is weakest.
- Facades are assumed to decompose into a **tree**, and in practice often do
  not; real facades read better as several overlapping rectilinear layers.

That last cluster matters more than the rest here, because "irregular,
non-repetitive walls" is the stated reason for wanting this architecture at
all. The classic answer to *avoid* an asset library is the technique that is
weakest at *irregular*.

### Documented resolutions

- **Layered shape grammars** (Jesus et al., *The Visual Computer*, 2016) —
  layering raises variability, and a vectorial definition of shapes admits
  complex ones. Context-sensitive rules let entities in the hierarchy interact
  rather than being refined in isolation.
- **Layer-based facade design** — facades separated into depth layers, each a
  rectilinear grid, composing into something neither layer could express.
- **Inverse procedural modelling** — do not author the rules; *derive* them.
  "Procedural facade variations from a single layout" (ACM TOG) generates many
  variations from one labelled example, and **FaçAID** (arXiv 2406.01829, 2024)
  is a transformer that converts segmented facades into split-grammar programs.
  This is the sharpest answer found to "reduce authoring work": the input
  becomes examples rather than rules.

## The other family: implicit surfaces

If the requirement is genuinely organic — rock, cave, eroded wall — the grammar
family is the wrong tool and the implicit/SDF family is the right one. Geometry
is defined by a function rather than by splits, so curvature, blending, erosion
and boolean carving are native rather than special cases, and the mesh is
extracted at whatever resolution is asked for.

This is also already half-adopted here: `fast-surface-nets-rs` is **Decided**
in the registry, though scoped to heightmap seeding and distant scenery. If the
surface generator is implicit, that scoping is the thing to revisit — not a new
dependency.

## Candidate code

Licence matters more than usual: the owner's stated goal is a closed-source
commercial product, and `GATE-008` (licence policy) is still open.

| Candidate | Licence | Maturity (2026-08-08) | wasm | Fit |
| --- | --- | --- | --- | --- |
| **`fidget`** (mkeeter) | **MPL-2.0** | 0.5.0, 43.7k downloads, updated 2026-08-03 | **`wasm32-unknown-unknown` Tier 1, CI-checked, no JIT** (interpreter fallback); ships a web-editor demo | Implicit-surface kernel: expression graphs, tape simplification by interval evaluation, Manifold Dual Contouring meshing. The strongest single candidate for an organic surface generator |
| **`csgrs`** | **MIT** | 0.20.1+, 40.5k downloads, updated 2025-07 | explicit **`wasm` feature** with browser wrappers | CSG on meshes via BSP trees, OpenSCAD-like. Fits massing → boolean detail (carve windows, doors, arches) without leaving mesh-land |
| `crater-rs` | MIT | 0.8.0, 15.3k downloads | not verified | N-dimensional geometry, procedural modelling, marching cubes from implicit fields. Less proven than the two above |
| `fast-surface-nets-rs` | MIT OR Apache-2.0 | already **Decided** here, `wasm32` verified | yes | Surface extraction from a scalar field. Already in the registry; only its *scope* is in question |
| **ShapeML** (stefalie) | **GPLv3** | active, has parser/interpreter + preview app | n/a | The closest open-source CGA-like framework found — and **disqualified as a dependency** by its licence given the closed-source goal. Usable as a *concept* reference only, like Sylves |
| ShapeGrammarLanguage (cosmicpotato137) | Unity package | small | n/a | C#/Unity. Concept reference |
| Blender city generators (Suicidator, Blended Cities) | open source, Blender-bound | mature but tool-shaped | n/a | Tools, not libraries. Reference for what the output should look like |

**Licence note.** MPL-2.0 (`fidget`) is *file-level* copyleft: linking it into a
closed-source product is fine, but modifications to fidget's own files must be
published. That is a materially different obligation from GPLv3 (`ShapeML`),
which would reach the whole product. Neither reading should be relied on
without the owner's own legal call — `GATE-008` exists for exactly this.

## Problems this architecture hits, and what answers them

Ordered by how badly each would hurt *this* repository.

1. **Determinism across backends.** The map is replicated state (`DEC-016`,
   `PROV-003`, `ADR-0004`). A generator must produce byte-identical geometry
   from the same definition and seed on every host, or two clients disagree
   about the world. `fidget` runs a hand-written JIT on `x86_64`/`aarch64` and
   an interpreter on `wasm32` — **whether those agree bit for bit is not
   established here and would need measuring before adoption.** A native
   authoritative host plus browser clients is precisely the configuration that
   would expose it.
2. **Seams between regions.** A wall generated for region A must meet region
   B's. Independent per-region generators crack at the boundary. The classic
   answer is to generate the *boundary* once and hand each side its half —
   which is what `shell-cell-graph.ts` already computes, and is an argument for
   feeding the generator the extracted shell rather than raw region membership.
3. **Cost and streaming.** Detailed geometry for a whole map cannot be
   generated eagerly. Chunking plus a level-of-detail policy is required, and
   the blockout is naturally the low LOD — a benefit, if planned for.
4. **Editing after generation.** The world model already answers this for
   modules — geometry deforms, choices stay. A generator invites the opposite
   (regenerate on edit), which risks a wall changing appearance when a vertex
   moves. The proposal's own premise (store the definition, regenerate freely)
   is in tension with the recorded rule that generation is fixed.
5. **The authoring work moves, it does not vanish.** Writing the generator *is*
   the authoring. The trade is real — difficulty in code, which scales, instead
   of difficulty in assets, which does not — but it is a trade, not a saving.
   Inverse procedural modelling is the one documented way to make it a genuine
   saving, by turning rules into examples.
6. **Collision and physics.** These should read the blockout, not the detailed
   mesh. `parry2d`/`parry3d` over a coarse cage is cheap and stable, and this
   architecture makes that natural rather than a compromise. A benefit worth
   stating explicitly so it is not lost.

## What this would mean here

- The tileset's job shrinks from choosing *art* to choosing *classification*, a
  vocabulary of maybe a dozen types rather than hundreds of modules. That is
  the stated goal, and it is achievable.
- Several defects fixed in `#66`–`#69` are artefacts of assembling geometry
  cell by cell — double walls, coplanar skirts, z-fighting. A generator that
  consumes a whole classified region does not have them.
- `shell-cell-graph.ts` changes role: from "where modules are assigned" to
  "the boundary handed to the generator". The work stands; the consumer changes.
- `ADR-0022` fits without strain: the blockout is grid-classified, and the
  generator emits both the geometry and the free-geometry semantic records,
  which is already that ADR's stated mitigation.

## What was not established

- **No bit-for-bit determinism measurement** of any candidate across
  `wasm32` and native. This is the highest-risk unknown and it is cheap to
  measure before committing.
- No performance measurement of any candidate at map scale. Every number above
  is a licence, a version or a download count, not a benchmark.
- Whether the contract should be *region membership plus type* or *extracted
  boundary plus per-face type*. This decides whether the two layers can evolve
  independently, and nothing here settles it.
- `crater-rs`'s `wasm32` support was not verified.
- Whether an implicit generator can hit the flat, hard-edged look that
  buildings need, or whether buildings want CSG (`csgrs`) and only terrain
  wants implicit. A hybrid is likely and is not designed.

## Sources

- [Procedural modeling of buildings — Müller, Wonka, Haegler, Ulmer, Van Gool (ACM TOG 2006)](https://dl.acm.org/doi/10.1145/1141911.1141931)
- [SIGGRAPH history entry for the same paper](https://history.siggraph.org/learning/procedural-modeling-of-buildings-by-muller-wonka-haegler-ulmer-and-gool/)
- [CGA shape grammar lecture notes (UPC)](https://www.cs.upc.edu/~virtual/SGI/docs/1.%20Theory/Unit%2011.%20Procedural%20modeling/CGA%20shape%20grammar.pdf)
- [Layered shape grammars for procedural modelling of buildings (The Visual Computer)](https://link.springer.com/article/10.1007/s00371-016-1254-8)
- [Inverse Procedural Modeling of Facade Layouts (arXiv 1308.0419)](https://arxiv.org/pdf/1308.0419)
- [Procedural facade variations from a single layout (ACM TOG)](https://dl.acm.org/doi/10.1145/2421636.2421644)
- [FaçAID: A Transformer Model for Neuro-Symbolic Facade Reconstruction (arXiv 2406.01829)](https://arxiv.org/pdf/2406.01829)
- [ShapeML (GPLv3)](https://github.com/stefalie/shapeml)
- [fidget (MPL-2.0)](https://github.com/mkeeter/fidget) and [Fidget: Yet Another Implicit Kernel (Keeter, 2024)](https://www.mattkeeter.com/research/fidget-2024.pdf)
- [csgrs (MIT)](https://github.com/timschmidt/csgrs)
- crates.io API for licence, version and download figures, queried 2026-08-08
