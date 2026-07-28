// Message protocol between the main thread and the Dedicated Worker
// (DEC-015). Not domain logic -- just the request/response envelope for
// the one real operation `isekai-wasm` exposes (see that crate's
// `lib.rs` docs for why it's `submit_increment`, not a generic
// Command/DomainEvent channel).

export type WorkerRequest =
  | { type: "init"; id: number; seed: Uint8Array }
  | { type: "increment"; id: number; amount: bigint };

export type WorkerResponse =
  | { type: "init-ok"; id: number }
  | { type: "init-error"; id: number; message: string }
  | { type: "increment-ok"; id: number; newValue: bigint; stateHash: Uint8Array }
  | { type: "increment-error"; id: number; message: string; poisoned: boolean };
