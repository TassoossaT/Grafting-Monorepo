# ABI: version and lifecycle

Relocated verbatim from `GRAFTING_MASTER_SOURCE.md` section 12 on 2026-08-07,
as the router table in that document's S0.4 had scheduled. The section
numbering is preserved because `S<n>.<n>` is the stable citation key used from
real source comments and manifests; those citations resolve here now,
unchanged. Precedence and normative language remain in
`GRAFTING_MASTER_SOURCE.md` section 0 and govern everything below.

---

## 12. ABI: version and lifecycle

### 12.1 Version axes

| Axis            | Example                      | What it protects                           |
| --------------- | ----------------------------- | ---------------------------------------- |
| Product         | `1.4.0`                    | user-perceived release         |
| ABI             | `2.1`                      | native library layout and functions |
| Wire protocol   | `3.0`                      | client/server messages              |
| Schema revision | per-contract identifiers | FlatBuffers evolution                  |
| Save format     | `5`                        | persisted snapshots/savegames         |

Do not infer protocol compatibility solely from the product version.

### 12.2 ABI policy

- `ABI_MAJOR`: incompatible break.
- `ABI_MINOR`: compatible append-only extension.
- product patch: internal implementation without contractual change.

Every public struct begins with:

```c
uint32_t struct_size;
```

New fields are added only at the end.

### 12.3 Capability negotiation

`EngineAbiInfo` must report:

- major;
- minor;
- size;
- build ID;
- target;
- feature flags;
- CPU backend;
- GPU backend;
- async support;
- supported protocol version.

The C# wrapper validates this at startup.

### 12.4 Lifecycle

#### Engine

```text
Creating → Ready → ShuttingDown → Destroyed
                  ↘
                   Poisoned → Destroyed
```

#### Job

```text
Pending → Running → Completed → Released
                  ↘ Failed ───→ Released
                  ↘ Cancelled → Released
```

#### Buffer

```text
OwnedByRust → ViewLeased → OwnedByRust → Released
```

### 12.5 Panic

Every `extern "C"` export must protect the boundary.

If a recoverable panic occurs:

- convert to status;
- log internal diagnostics;
- mark the engine as poisoned when the state cannot be guaranteed;
- allow querying the error and destruction;
- do not continue simulating in a doubtful state.

`catch_unwind` does not capture builds with `panic=abort`; the compilation policy must be deliberate.

Reference:

- [https://doc.rust-lang.org/nomicon/ffi.html](https://doc.rust-lang.org/nomicon/ffi.html)

### 12.6 C# wrapper

The wrapper must use:

- `LibraryImport` when compatible;
- `SafeHandle`;
- `Span<T>` only within a valid lifetime;
- centralized status translation;
- idempotent shutdown;
- packaging per RID;
- ABI test before first real use.
