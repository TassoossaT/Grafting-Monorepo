# FFI and memory

Relocated verbatim from `GRAFTING_MASTER_SOURCE.md` section 11 on 2026-08-07,
as the router table in that document's S0.4 had scheduled. The section
numbering is preserved because `S<n>.<n>` is the stable citation key used from
real source comments and manifests; those citations resolve here now,
unchanged. Precedence and normative language remain in
`GRAFTING_MASTER_SOURCE.md` section 0 and govern everything below.

---

## 11. FFI and memory

### 11.1 Main rule

> Whoever allocates controls the lifecycle and offers the compatible release operation.

This does not mean all memory needs to be copied. It means ownership cannot be implicit.

### 11.2 What can cross the C ABI

Allowed:

- fixed-width integers;
- fixed-width floats;
- pointer + length;
- opaque handles;
- versioned `#[repr(C)]` structs;
- status codes;
- callbacks with an explicit contract.

Forbidden:

- `Vec<T>`;
- `String`;
- `&str`;
- `Box<T>` without an opaque API;
- Rust enum without a fixed representation;
- trait object;
- panic;
- C# exception;
- ABI-dependent `usize`, `long`, or `bool`.

### 11.3 Handles

Use 64-bit generational handles:

```text
EngineHandle
ProblemHandle
JobHandle
BufferHandle
```

Properties:

- `0` is invalid;
- index and generation prevent trivial use-after-free;
- the logical type is validated;
- duplicate release returns an error;
- handles are not public pointers.

### 11.4 Synchronous call

For small data or short work:

```text
host lends pointer + length
Rust processes during the call
Rust does not retain the pointer
call returns
host can move/free the memory
```

In C#, managed memory must remain pinned only during the call.

### 11.5 Asynchronous call

For long CPU work or GPU:

```text
host submits batch
Rust copies to its own arena or receives explicit ownership
Rust returns JobHandle
host polls/waits on status
Rust delivers BufferHandle
host reads within a lease
host releases BufferHandle
```

A pinned C# pointer MUST NOT be retained after the `submit` call returns.

### 11.6 Conceptual API

```c
EngineStatus engine_get_abi_info(EngineAbiInfo* out_info);

EngineStatus engine_create(
    const EngineCreateInfo* create_info,
    EngineHandle* out_engine
);

EngineStatus engine_submit(
    EngineHandle engine,
    const uint8_t* command_data,
    uint64_t command_length,
    JobHandle* out_job
);

EngineStatus engine_job_poll(
    JobHandle job,
    JobState* out_state
);

EngineStatus engine_job_take_result(
    JobHandle job,
    BufferHandle* out_buffer
);

EngineStatus engine_buffer_view(
    BufferHandle buffer,
    const uint8_t** out_data,
    uint64_t* out_length
);

EngineStatus engine_buffer_release(BufferHandle buffer);
EngineStatus engine_job_release(JobHandle job);
EngineStatus engine_shutdown(EngineHandle engine);
EngineStatus engine_destroy(EngineHandle engine);
```

### 11.7 Wasm

In Wasm:

- public references are offsets and lengths;
- TypedArrays are views into linear memory;
- `memory.grow` can invalidate previous views;
- views must be recreated after growth;
- arenas should reduce frequent growth;
- the Worker must own the Wasm instance.

Conceptual API:

```text
reserve_input(length) -> offset
commit_input(offset, length) -> JobHandle
job_poll(job) -> state
job_result(job) -> { offset, length, BufferHandle }
buffer_release(handle)
```

### 11.8 Copy budget

| Boundary                 | V1 target                                                        |
| ------------------------- | -------------------------------------------------------------- |
| C# → Rust synchronous      | zero copy, memory pinned during the call                 |
| C# → Rust asynchronous    | one copy into native memory                                |
| Rust → C# synchronous view | zero copy within lease                                    |
| Main thread → Worker     | `ArrayBuffer` ownership transfer when possible |
| JS → Wasm arena          | one copy when data originated outside Wasm                  |
| Wasm view → Rust         | zero copy within linear memory                          |
| CPU/Wasm → GPU           | one explicit upload                                           |
| GPU → CPU                | one explicit readback                                           |
| network                      | copies depend on the runtime and transport                       |

Correct formulation:

> The system aims to avoid full deserialization and redundant copies, keeping at most the intentional copies required by each memory domain.
