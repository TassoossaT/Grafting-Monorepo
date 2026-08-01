# `@grafting/vtt-generation-wasm`

Technical package: the compiled `grafting-vtt-generation-wasm` `.wasm` +
loader + TS types. No domain logic here, and no hand-written Nx
`check`/`test` targets of its own -- this package is *generated output*, not
independently built/tested; its content is produced by `generation-wasm`'s
own `build` Nx target (see `libs/vtt/generation-wasm/README.md`).

## Regenerating

```bash
pnpm exec nx run generation-wasm:build
# equivalent to, run from the repository root:
wasm-pack build --target web --out-dir ../../../packages/vtt-generation-wasm/pkg libs/vtt/generation-wasm
```

`pkg/` is gitignored -- regenerate it, don't hand-edit it.

## Consumers

`apps/architecture-studio`'s `/vtt-generation` route, via a static-asset copy
of `pkg/` (the same pattern already used for `@grafting/isekai-wasm`'s
graph-layout worker), not a direct module import.
