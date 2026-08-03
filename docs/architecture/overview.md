# Product vision

> Extracted from `GRAFTING_MASTER_SOURCE.md` §1 as part of the master-source
> split (`MASTER-SOURCE-SPLIT-PHASE1`). This section had zero external
> citations by section number; DEC-XXX IDs remain the stable citation key and
> are unaffected by this move. See `GRAFTING_MASTER_SOURCE.md` §0's router
> table for the full document map.

The repository will house two main products:

1. **Web Virtual Tabletop**

   - TypeScript;
   - Three.js;
   - web interface;
   - engine consumption via WebAssembly;
   - simulation and heavy computation off the main thread.
2. **Native Desktop Game**

   - C#/.NET;
   - graphics engine still to be decided;
   - engine consumption via native library;
   - initial priority support for Windows, with a design compatible with Linux and macOS.

Both products will consume the same proprietary Rust core.

## 1.1 Central objective

Build a logical, mathematical, and optimization engine that:

- is the single source of truth;
- is reusable on Web and Desktop;
- allows future implementation of a proprietary optimization solver;
- runs algorithms on CPU and, when advantageous, on GPU;
- maintains explicit control of memory and lifecycle;
- does not replicate proprietary logic in the hosts;
- can in the future operate locally or on an authoritative server.

## 1.2 What "single core" means

"Single core" means:

- a single mathematical model;
- a single implementation of the business rules;
- a single solver algorithm;
- a single collection of WGSL kernels;
- a single protocol for commands, events, and snapshots;
- thin bindings, without reimplementing behavior;
- interchangeable execution backends behind internal contracts.

"Single core" does not mean:

- a single process;
- a single binary for all systems;
- a single logical GPU device instance;
- a single Rust reference crossing any runtime;
- a single physical representation of memory across CPU, Wasm, Worker, GPU, and network.

## 1.3 Architectural success criteria

The project will be considered well structured when:

- a rule changed in Rust produces the same behavior in both products;
- Web and Desktop do not have copies of the solver;
- an incompatible contract change fails early in the build;
- an incompatible ABI fails at startup, not during gameplay;
- affected tasks are executed in the correct order by Nx;
- each compiler continues to be operated by its native toolchain;
- the cache never masks external effects or artifacts from another platform;
- the absence of WebGPU triggers a controlled CPU fallback;
- the renderer does not need to know the solver's internal implementation;
- the solver does not need to know about Three.js, the C# engine, or transport protocols.

## 1.4 Identity and taxonomy

The project is called **Grafting Monorepo**, inspired by the idea of grafting or connecting parts that originally belong to different places into a coherent system.

Conventions:

| Context                         | Name                  |
| -------------------------------- | --------------------- |
| Human project name           | `Grafting Monorepo` |
| Recommended repository slug | `grafting`          |
| Rust crate prefix           | `grafting-*`        |
| npm package scope            | `@grafting/*`       |
| C# root namespace                | `Grafting.*`        |
| Bridge between runtimes/languages  | `Isekai`            |

**Isekai** is the bounded context that transports data, commands, results, and lifecycles between execution "worlds":

- native Rust ↔ C#/.NET;
- Rust/Wasm ↔ TypeScript;
- Wasm linear memory ↔ TypedArrays;
- native memory ↔ C# spans/views.

The name does not replace technical terminology. Public APIs remain explicit:

```text
engine_submit
engine_job_poll
engine_buffer_release
```

and do not use metaphorical names such as `send_to_another_world`.

Boundaries:

- Isekai contains no business rules;
- Isekai does not implement the solver;
- Isekai has no rendering;
- Isekai is not the multiplayer system;
- Isekai depends on the engine; the engine does not depend on Isekai;
- networking remains in the `replication` and `transport` contexts.

This discipline allows using a memorable identity without harming the technical readability of the code.

Planned components:

| Artifact                     | Responsibility                         |
| ----------------------------- | ----------------------------------------- |
| `grafting-isekai-wasm`     | Rust crate that exposes the core to Wasm   |
| `grafting-isekai-capi`     | Rust crate that exposes the native C ABI     |
| `@grafting/isekai-wasm`    | the same Rust crate's directory, also a normal npm package (co-located `package.json`, `postinstall` runs `wasm-pack`); not a separate `packages/` technical package (`ADR-0017`, DEC-055) |
| `@grafting/isekai-web`     | idiomatic TypeScript/Worker client    |
| `Grafting.Isekai.Interop`  | safe C# wrapper for the native library   |
| `Grafting.Isekai.Protocol` | C# types generated from binary contracts |

In Nx, project names must remain unique, for example:

```text
isekai-wasm-bridge
isekai-capi-bridge
isekai-web-client
isekai-dotnet-interop
isekai-dotnet-protocol
```
