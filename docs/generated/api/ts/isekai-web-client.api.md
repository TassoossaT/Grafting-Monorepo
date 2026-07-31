# isekai-web-client

### `class isekai-web-client.EngineError`

`poisoned: true` means this specific engine is dead (a Wasm panic or
an unexpected lifecycle rejection, see `worker.ts`'s docs) -- create a
fresh `IsekaiEngine` rather than retrying.

### `constructor isekai-web-client.EngineError.constructor(message: string, poisoned: boolean): EngineError`

### `property isekai-web-client.EngineError.poisoned: boolean`

### `class isekai-web-client.IsekaiEngine`

### `method isekai-web-client.IsekaiEngine.increment(amount: bigint): Promise<IncrementResult>`

One `postMessage` round trip = one Promise (S9.3's "Promise per
job") -- `increment` completes in microseconds inside Wasm, so there
is no meaningful mid-flight cancellation to offer here; cooperative
cancellation remains open for future long-running jobs.

### `method isekai-web-client.IsekaiEngine.terminate(): void`

Voluntary shutdown (distinct from an unexpected crash, handled by
`onerror` below) -- rejects any still-outstanding Promises cleanly.

### `method isekai-web-client.IsekaiEngine.create(seed: Uint8Array): Promise<IsekaiEngine>`

One Worker, one Wasm engine (this package's V1 scope -- see README).
`seed` must be exactly 32 bytes, caller-visible and caller-controlled
on purpose (DEC-044), matching the native/Wasm engines' own seed.

### `interface isekai-web-client.IncrementResult`

### `property isekai-web-client.IncrementResult.newValue: bigint`

### `property isekai-web-client.IncrementResult.stateHash: Uint8Array`
