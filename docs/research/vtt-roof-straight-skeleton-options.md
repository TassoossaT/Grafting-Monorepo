# Roof generation: straight-skeleton library/approach options (E7.7 gate)

- Status: research complete, decision open for the owner
- Trigger: `docs/architecture/vtt-roadmap.md`'s E7.7 ("Roof research decision
  and first footprint-to-roof surface generator, with a separate
  license/algorithm evaluation before any straight-skeleton dependency is
  introduced") — this document is that evaluation, done before writing any
  E7.7 product code
- Scope: a hip/gable-style roof generator over the footprint polygons
  `VTT-ROOM-DERIVE` (E7.6) already produces — a closed, simple polygon (no
  holes in v1, matching what `room-derive-tool.ts` currently derives)

## Verdict, upfront

**No third-party crate found is both license-clean for this project and
practically usable in its actual WASM build pipeline.** Recommendation:
hand-roll a roof-scoped straight-skeleton in a new
`libs/domains/procgen/roof-generation` crate, the same pattern already used
for `terrain-generation`/`structure-generation`/`surface-mesh` — this
project already builds its own procedural geometry in Rust rather than
depending on a general-purpose computational-geometry library, and every
third-party candidate below has a real, specific disqualifying problem, not
just "not invented here."

## Candidates evaluated

### `straight-skeleton` (crates.io, `lizelive/straight-skeleton`) — Discarded

- **License: GPL-2.0-or-later.** A hard disqualifier on its own for a
  project whose other dependencies are consistently MIT/Apache-2.0
  (`Cargo.toml`s across `libs/` never pull in a GPL crate today) — pulling
  this in would put the combined binary/WASM output under GPL obligations.
- Also immature independent of the license problem: published 2026-07-17,
  version 0.2.1, 79 downloads total. "Integer-constrained" (its own
  description) means it works on integer coordinates, not the `f32` world
  positions this app's graph already uses everywhere -- a real conversion
  boundary, not just a style difference.

### `sfcgal` (crates.io, Rust bindings to the SFCGAL/CGAL geometry stack) — Discarded

- License chain: the Rust binding crate itself is dual MIT/Apache-2.0, but
  it links SFCGAL (LGPL-2.0+), which itself wraps CGAL's
  `Straight_skeleton_2` package (LGPL-3.0-or-later, per that package's own
  SPDX header -- some older CGAL docs pages label the whole "surface and
  volume mesh" tier GPL, but the straight-skeleton package specifically is
  LGPL). LGPL is workable licensing-wise (linking doesn't force this
  project's own code to become LGPL), so license is not the disqualifier
  here.
- **The real disqualifier is the build target.** Every WASM crate in this
  repository (`construction-wasm`, `generation-wasm`, `terrain-generation`,
  etc.) targets `wasm32-unknown-unknown` through `wasm-bindgen`/`wasm-pack` --
  confirmed by every `project.json` `build` target in
  `libs/domains/procgen/*`. CGAL is a large C++ template-heavy kernel that
  also pulls in GMP/MPFR for exact rational arithmetic; it is not designed
  for `wasm32-unknown-unknown` and is not known to compile there through
  this project's existing toolchain (CGAL-to-WASM builds that exist
  elsewhere, e.g. the `vHawk/straight-skeleton` npm package below, go
  through Emscripten -- a completely different C/C++-first WASM pipeline
  this repository does not have and would need to newly stand up). Adopting
  `sfcgal` would mean introducing a second, C++-based WASM build path
  alongside the existing pure-Rust one.

### `vHawk/straight-skeleton` (npm, TypeScript wrapper over CGAL-via-Wasm) — Discarded

- Not a Rust crate at all -- an npm/WASM package. The wrapper's own code is
  MIT, but it compiles and bundles CGAL's C++ straight-skeleton
  implementation via Emscripten; the bundled CGAL code carries CGAL's own
  license terms (see `sfcgal` above), which the wrapper's MIT badge does not
  by itself override.
- Even setting that aside, adopting a TypeScript/npm library here would put
  roof geometry generation in `apps/vtt`'s JS layer -- directly the pattern
  the user has repeatedly asked to move *away* from (see
  `[[project_irregular_terrain_rust_port_pending]]`: "não quero calculos
  sendo feitos pelo .ts"). Wrong layer for this project regardless of its
  license.

### `geo-buf` (crates.io, Apache-2.0, GeoRust ecosystem) — Discarded, but the closest fit

- **License: Apache-2.0.** Clean, matches this project's usual permissive
  dependencies, and (being pure Rust with no C/C++/GMP dependency) should
  compile to `wasm32-unknown-unknown` without the toolchain problem `sfcgal`
  has.
- **Does not expose what a roof generator needs.** Its public API
  (`buffer_polygon`/`buffer_multi_polygon`) only returns an inset/offset
  polygon -- the straight skeleton is computed internally but never
  returned as a graph of ridge/hip edges and event vertices, which is
  exactly the structure a hip-roof mesh generator needs (the roof's ridge
  line *is* the skeleton's own internal edges, not something derivable from
  an offset outline alone).
- Low maturity independent of the API gap: 0 GitHub stars/watchers, a fork
  of an older, apparently-abandoned `geo-buffer` crate, single maintainer,
  no visible test/CI signal.
- Its license does make it a legitimate *reference* while writing the
  hand-rolled version below -- Apache-2.0 permits reading and adapting its
  algorithm (with attribution) even though its public API isn't usable
  as-is.

## Why hand-rolling is the actual right call here, not a fallback

A general-purpose straight skeleton (arbitrary polygons with holes,
degenerate/collinear input, industrial robustness) is genuinely hard --
that difficulty is why CGAL's implementation alone is a multi-thousand-line
package with its own dedicated research paper (Petr Felkel & Štěpán
Obdržálek's 1998 algorithm, later robustness work by Aichholzer et al. cited
in CGAL's own docs). But this project does not need that generality:

- Input footprints come from `room-derive-tool.ts` -- a simple polygon
  (no holes), already validated as a closed loop by the face-tracing
  algorithm that produced it, with `f32` world-space vertices already
  shared with the rest of the construction graph (no coordinate-system
  conversion boundary the way `straight-skeleton`'s integer constraint
  would need).
- The event-based straight-skeleton algorithm (Felkel/Obdržálek), scoped to
  simple polygons only, is implementable in a few hundred lines -- shrinking
  wavefront edges, tracking edge/split events with a priority queue, same
  general shape as other procedural algorithms already in this repository's
  `procgen` crates.
- This mirrors the repository's own established pattern:
  `terrain-generation`, `structure-generation`, and `surface-mesh` are all
  hand-rolled procedural geometry in Rust already, not third-party
  dependencies -- `[[feedback_prefer_third_party_over_hand_rolled]]`'s own
  bar ("well-scoped MIT libraries instead of writing the equivalent by
  hand") is specifically about avoiding hand-rolling something a good
  library already does well; here, no such library exists for this
  project's actual constraints.

## Proposed scope for the follow-up implementation task

Not started, no code written for this yet -- for whoever picks up
`VTT-ROOF-GENERATOR` next:

- New crate `libs/domains/procgen/roof-generation`, mirroring
  `structure-generation`'s shape (pure geometry in, `Surface`/`Node` specs
  out, no graph-mutation side effects itself).
- v1 scope: a single simple polygon (no holes), one uniform roof pitch,
  hip roof only (every edge slopes inward to the ridge -- no gable ends).
  Gable roofs, mixed pitches, and multi-footprint buildings are explicit,
  documented follow-ups, not this task's scope.
- Consumed the same way `generateWall`/`generateTerrainCell` are: a new
  `ConstructionSessionPort` method wrapping a new
  `construction-wasm::generate_and_apply_roof_json`, mirroring `wall.rs`'s
  own id-collision/weld validation pattern from `VTT-WALL-CORNER-WELD` (the
  roof's eave nodes should weld onto the footprint's own existing top
  corner nodes, not mint new ones).

## Sources

- [straight-skeleton crate (crates.io API)](https://crates.io/api/v1/crates/straight-skeleton) -- GPL-2.0-or-later, 79 downloads, v0.2.1 (2026-07-17)
- [lizelive/straight-skeleton repository](https://github.com/lizelive/straight-skeleton)
- [sfcgal crate (crates.io API)](https://crates.io/api/v1/crates/sfcgal) -- MIT/Apache-2.0 binding
- [mthh/sfcgal-rs repository](https://github.com/mthh/sfcgal-rs)
- [CGAL 6.2 Straight Skeleton package license header (Fossies mirror)](https://fossies.org/linux/CGAL/include/CGAL/license/Straight_skeleton_2.h) -- SPDX `LGPL-3.0-or-later OR LicenseRef-Commercial`
- [CGAL license overview](https://doc.cgal.org/latest/Manual/license.html)
- [vHawk/straight-skeleton (npm/Wasm-over-CGAL)](https://github.com/vHawk/straight-skeleton) -- MIT wrapper, bundles CGAL C++ source
- [geo-buf crate (crates.io API)](https://crates.io/api/v1/crates/geo-buf) -- Apache-2.0
- [njwitthoeft/geo-buf repository](https://github.com/njwitthoeft/geo-buf)
