# AGENTS.md -- `@grafting/isekai-web-client`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

This package MUST NOT expose memory offsets, raw `WasmEngine`
handles/pointers, or any `@grafting/isekai-wasm` internal type to its own
callers (S9.3) -- `IsekaiEngine`'s public methods are the only surface.

`@grafting/isekai-wasm` is co-located with its Rust source in
`libs/isekai/wasm-bridge` (DEC-055/ADR-0017), not a separate `packages/`
technical package -- depend on it as a normal `workspace:*` package.json
dependency, same as any other workspace package.

MUST NOT assume a Wasm panic is distinguishable from an ordinary
`Result::Err`-turned-JS-throw without re-reading `src/worker.ts`'s module
docs first -- the current design deliberately treats any exception from a
`WasmEngine` call as poisoning, not as a bug to "fix" by trying to add
finer-grained classification without a real need for it.

Do not add domain logic here (DEC-001) -- this package only orchestrates
the Worker and decodes the fixed result shape `isekai-wasm` defines.
