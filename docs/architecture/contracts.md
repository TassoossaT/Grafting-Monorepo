# Data contracts

Relocated verbatim from `GRAFTING_MASTER_SOURCE.md` section 10 on 2026-08-07,
as the router table in that document's S0.4 had scheduled. The section
numbering is preserved because `S<n>.<n>` is the stable citation key used from
real source comments and manifests; those citations resolve here now,
unchanged. Precedence and normative language remain in
`GRAFTING_MASTER_SOURCE.md` section 0 and govern everything below.

---

## 10. Data contracts

### 10.1 Two data paths

#### Structured path

Use FlatBuffers for:

- Commands;
- DomainEvents;
- ReplicationDeltas;
- Snapshots;
- transport envelopes;
- heterogeneous results;
- versionable messages.

#### Hot numeric path

Use raw arrays, preferably Structure of Arrays, for:

- positions;
- matrices;
- vectors;
- costs;
- gradients;
- candidates;
- indices;
- large homogeneous batches.

Example:

```text
positions_x: Float32Array
positions_y: Float32Array
positions_z: Float32Array
entity_ids:  Uint32Array
```

Do not wrap millions of floats in individual FlatBuffers objects.

### 10.2 Location

- Contracts exclusive to a domain live in the domain.
- Global envelopes live in `libs/engine/contracts`.
- Generated code goes into fixed consumer directories.

Example:

```text
libs/domains/physics/contracts/*.fbs
packages/isekai-web-client/src/generated/
dotnet/Grafting.Isekai.Protocol/Generated/
libs/engine/domain-core/src/generated/
```

### 10.3 Generation

`flatc` must:

- have a pinned version;
- be invoked by a deterministic Nx target;
- produce TS, C#, and Rust;
- fail on invalid schema;
- produce declared outputs;
- run during bootstrap.

Generated code:

- is not the source of truth;
- does not need to be committed by default;
- must be ignored when always reproducible;
- must exist before typechecking/IDE use;
- must be regenerated automatically in build/CI.

If a consumer or IDE requires committed code, the exception must be recorded via an ADR and validated with `codegen:check`.

### 10.4 Evolution

Minimum rules:

- new table fields are added at the end or use explicit IDs;
- removed fields are marked deprecated, not erased;
- existing defaults are not changed without migration;
- FlatBuffers `struct` is reserved for truly stable layouts;
- untrusted messages are verified before use;
- protocol version stays in the envelope.

References:

- [https://flatbuffers.dev/](https://flatbuffers.dev/)
- [https://flatbuffers.dev/evolution/](https://flatbuffers.dev/evolution/)
- [https://flatbuffers.dev/languages/typescript/](https://flatbuffers.dev/languages/typescript/)
- [https://flatbuffers.dev/languages/c_sharp/](https://flatbuffers.dev/languages/c_sharp/)
- [https://flatbuffers.dev/languages/rust/](https://flatbuffers.dev/languages/rust/)
