# AGENTS.md -- `grafting-vtt-generation-wasm`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

This crate is a Wasm bridge only, mirroring `libs/isekai/wasm-bridge`'s own
boundary discipline: it exposes a thin, JSON/typed-array ABI to the Web host
and must not accumulate unrelated domain logic. Its current single function,
`generate_heightmap`, is deliberately scoped to pipeline step 1 (the
continuous heightmap seed) from
`docs/research/vtt-map-and-terrain-construction-options.md` — it must not
grow into the terrain-quantization, WFC, water, or interior-generation passes
described there; those belong in their own crate(s) once designed, not
bolted onto this one.

Panics are not catchable on `wasm32-unknown-unknown` (no `catch_unwind`), the
same constraint `libs/isekai/wasm-bridge/AGENTS.md` already documents for its
own crate — validate inputs at the boundary rather than relying on panic
recovery.

Consumed only by `packages/vtt-generation-wasm` (the generated `wasm-pack`
npm wrapper) and, through it, `apps/architecture-studio`'s `/vtt-generation`
route. Do not depend on this crate from anywhere in `libs/isekai/` or
`libs/engine/` — this is a VTT-product-specific crate (DEC-046), not a shared
engine domain.
