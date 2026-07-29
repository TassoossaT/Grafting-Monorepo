# `@grafting/isekai-wasm`

Technical package: the compiled `grafting-isekai-wasm` `.wasm` + loader +
TS types (master source S9.2). No domain logic here, and no hand-written
Nx `check`/`test` targets of its own -- this package is *generated
output*, not independently built/tested; its content is produced by
`isekai-wasm-bridge`'s own `build` Nx target (see
`libs/isekai/wasm-bridge/README.md`).

## Regenerating

```bash
pnpm nx run isekai-wasm-bridge:build
# equivalent to, run from libs/isekai/wasm-bridge:
wasm-pack build --target web --out-dir ../../../packages/isekai-wasm/pkg
```

`pkg/` is gitignored (S10.3's "generated code is not committed by
default," extended here) -- regenerate it, don't hand-edit it.

## Consumers

`packages/isekai-web-client` uses the engine API and Architecture Studio uses
the graph-layout batch adapter through this generated package. Both depend on
it via `workspace:*`; neither owns or hand-edits `pkg/`.
