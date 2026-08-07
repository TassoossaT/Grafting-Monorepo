# Toolchains: physical topology, Nx, Python/uv, Node/pnpm/Wasm

Relocated verbatim from `GRAFTING_MASTER_SOURCE.md` sections 6-9 on
2026-08-07, as the router table in that document's S0.4 had scheduled. The
section numbering is preserved because `S<n>.<n>` is the stable citation key
used from real Rust/C#/TypeScript source comments and package manifests
(for example `packages/isekai-web-client/package.json` cites S9.2/S9.3);
those citations resolve here now, unchanged.

Precedence, normative language (MUST/SHOULD/LOCKED/PROVISIONAL/OPEN), and the
rules an agent may not apply silently remain in `GRAFTING_MASTER_SOURCE.md`
section 0 and govern everything below.

---

## 6. Proposed physical topology

### 6.1 Initial tree

```text
/
├── GRAFTING_MASTER_SOURCE.md
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── grafting.graph.json
├── .mcp.json
├── .ai/
│   ├── README.md
│   ├── registry/
│   ├── policies/
│   ├── skills/
│   ├── agents/
│   ├── prompts/
│   ├── workflows/
│   ├── context/
│   ├── contracts/
│   ├── adapters/
│   ├── evals/
│   ├── catalog/
│   ├── state/
│   ├── reports/
│   └── scripts/
├── .claude/
├── .codex/
├── .agents/
├── nx.json
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── Cargo.toml
├── Cargo.lock
├── rust-toolchain.toml
├── pyproject.toml
├── uv.lock
├── .python-version
├── global.json
├── Directory.Build.props
├── Directory.Packages.props
├── System.sln
├── apps/
│   ├── web-vtt/
│   ├── desktop-game/
│   └── architecture-studio/
├── libs/
│   ├── engine/
│   │   ├── contracts/
│   │   ├── domain-core/
│   │   ├── compute-api/
│   │   ├── compute-cpu/
│   │   ├── compute-wgpu/
│   │   └── projection-core/
│   ├── isekai/
│   │   ├── wasm-bridge/
│   │   └── capi-bridge/
│   ├── platform/
│   │   └── polymath/
│   ├── graph/
│   │   └── core/
│   └── domains/
│       ├── narrative/
│       └── session/
├── packages/
│   ├── isekai-web-client/
│   ├── polymath/
│   ├── ui/
│   └── x6-canvas/ (retired reference)
├── dotnet/
│   ├── Grafting.Isekai.Interop/
│   ├── Grafting.Isekai.Protocol/
│   └── Grafting.Polymath/
├── python/
│   ├── automation/
│   ├── data-tools/
│   └── experiments/
├── tools/
│   ├── ai-gateway/
│   ├── nx-plugin/
│   ├── generators/
│   ├── graph-extractors/
│   └── scripts/
├── graphs/
│   ├── authored/
│   ├── schemas/
│   └── views/
├── backlog/
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── runbooks/
│   ├── benchmarks/
│   ├── generated/
│   └── archive/superseded/
└── dist/
```

Directories associated with `OPEN` decisions must not be definitively populated before the corresponding gate closes. The tree is a direction; it is not authorization to create every empty directory.

Every Nx project created must contain:

```text
project.json
README.md
AGENTS.md
Graph IR metadata
src/
```

A local `CLAUDE.md` will only be created when there is a specific need for the Claude adapter.

### 6.2 Correct rule for manifests

There will be a single **workspace root and lockfile** per ecosystem, but local manifests will continue to exist when the toolchain requires them.

| Ecosystem | Unique at the root                              | Allowed/required in members                                             |
| ----------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| Rust        | workspace `Cargo.toml`, `Cargo.lock`     | one `Cargo.toml` per crate                                                    |
| Node        | `pnpm-workspace.yaml`, `pnpm-lock.yaml` | one `package.json` per package/app                                             |
| Python      | workspace `pyproject.toml`, `uv.lock`    | one `pyproject.toml` per packaged member                                    |
| .NET        | `System.sln`, central props and packages   | one `.csproj` and, if lock mode is adopted, `packages.lock.json` per project |

It is forbidden to create:

- a second `Cargo.lock` inside a member crate;
- a second `pnpm-lock.yaml`;
- another independent uv workspace without an ADR;
- a parallel .NET solution without explicit reason;
- committed virtual environments.

### 6.3 Deterministic outputs

Consumable artifacts must converge into:

```text
dist/
├── wasm/
│   └── engine/
├── native/
│   ├── win-x64/
│   ├── linux-x64/
│   └── osx-arm64/
├── dotnet/
├── python/
├── contracts/
└── docs/
```

Internal build directories are not public artifacts:

- `target/`;
- `bin/`;
- `obj/`;
- `.venv/`;
- `node_modules/`;
- local caches.

Nx must cache final artifacts or deterministic outputs, not entire environments.

---

## 7. Nx orchestration

### 7.1 Role

Nx must:

- know the projects;
- know the dependencies;
- build the task DAG;
- execute in order;
- parallelize independent tasks;
- compute hashes from inputs;
- restore outputs and logs;
- run only affected tasks in PRs;
- provide local generators;
- export the structural graph.

Nx must not:

- install toolchains during every target;
- sync `.venv` across multiple parallel tasks;
- hide undeclared external dependencies;
- cache actions with side effects;
- fake hermeticity the workspace doesn't have.

### 7.2 Cache rule

A task can only use `cache: true` when:

\[
f(\text, \text, \text)
======================
\text{deterministic outputs}
\]

Cacheable targets:

- compile;
- build;
- lint;
- deterministic unit test;
- codegen;
- generated documentation;
- benchmarks only when treated as artifacts, not as an absolute time comparison.

Non-cacheable targets:

- install/bootstrap;
- deploy;
- publish;
- signing;
- database migration;
- calls to external services;
- end-to-end tests against a mutable environment;
- lockfile update;
- mutable download without checksum.

Nx restores both declared files and terminal output. Inputs and outputs need to be adjusted per project, per the official documentation:

- [https://nx.dev/docs/features/cache-task-results](https://nx.dev/docs/features/cache-task-results)
- [https://nx.dev/docs/reference/project-configuration](https://nx.dev/docs/reference/project-configuration)

### 7.3 Minimal target convention

Every applicable project should expose:

| Target           | Function                       |
| ---------------- | ------------------------------ |
| `format:check` | check formatting         |
| `lint`         | static analysis             |
| `typecheck`    | type checking              |
| `test`         | unit tests              |
| `build`        | produce artifact              |
| `codegen`      | generate derived sources         |
| `bench`        | local benchmark                |
| `package`      | organize publishable artifact |

Specific targets:

- `build:wasm`;
- `build:native`;
- `test:abi`;
- `test:protocol`;
- `test:differential`;
- `test:gpu`;
- `docs:generate`;
- `docs:check`.

### 7.4 Conceptual dependencies

```text
contracts:codegen
    ├──> domain-core:build
    ├──> isekai-web-client:build
    └──> isekai-dotnet-protocol:build

domain-core:build
    ├──> isekai-wasm-bridge:check
    └──> isekai-capi-bridge:build

isekai-wasm-bridge:check
    └──> (not an Nx target -- `libs/isekai/wasm-bridge`'s own co-located
         `package.json` `postinstall` script runs `wasm-pack` into that
         same directory on a plain `pnpm install`; consuming apps just
         depend on `@grafting/isekai-wasm` as `workspace:*`,
         DEC-055/ADR-0017)

isekai-capi-bridge:build
    └──> isekai-dotnet-interop:build

isekai-dotnet-interop:build
    └──> desktop-game:build
```

### 7.5 Explicit project before sophisticated plugins

In the initial phase, Rust, Python, and utilities must be representable with `project.json` and native commands.

A local Nx plugin should only abstract something after:

- there are at least two real occurrences;
- the inputs/outputs are well understood;
- the manual command has been tested;
- the abstraction reduces maintenance.

Do not create a "universal" generic executor that recreates Cargo, uv, or MSBuild.

### 7.6 .NET integration

The official `@nx/dotnet` plugin must be evaluated in a spike:

- `.csproj` detection;
- project dependencies;
- inferred targets;
- outputs;
- compatibility with the chosen engine;
- behavior on machines without the .NET SDK;
- migration cost.

If the spike fails, the fallback is:

- explicit projects;
- `dotnet restore/build/test/publish`;
- dependencies declared in the graph;
- without abandoning Nx.

For deterministic restore:

- NuGet versions are centralized in `Directory.Packages.props`;
- `RestorePackagesWithLockFile` must be enabled;
- `packages.lock.json` must be committed per project;
- CI uses `dotnet restore --locked-mode`;
- `bin/` and `obj/` files are neither sources nor lockfiles.

References:

- [https://nx.dev/docs/technologies/dotnet/introduction](https://nx.dev/docs/technologies/dotnet/introduction)
- [https://nx.dev/docs/technologies/dotnet/guides/migrate-from-nx-dotnet-core](https://nx.dev/docs/technologies/dotnet/guides/migrate-from-nx-dotnet-core)

### 7.7 Project identity and tags

Nx projects must use stable names and predictable tags.

Initial categories:

```text
scope:engine
scope:domain
scope:host
scope:tooling
scope:contracts

lang:rust
lang:typescript
lang:csharp
lang:python
lang:schema

platform:web
platform:desktop
platform:server
platform:cross

type:app
type:lib
type:binding
type:generator
type:test
```

Boundary rules:

- `scope:engine` does not depend on `scope:host`;
- `scope:domain` does not depend on bindings;
- hosts depend on wrappers/bindings, not on the core's internal details;
- `compute-api` does not depend on `compute-wgpu`;
- contracts do not depend on generated consumer code;
- tools can read manifests, but do not enter the product's runtime.

### 7.8 Polyglot dependencies in the graph

Nx must not "guess" Rust or Python dependencies from TypeScript imports.

Initial phase:

- declare `implicitDependencies` between polyglot projects;
- use generators to update those dependencies;
- validate the graph in CI.

Later phase:

- a local plugin can read `cargo metadata`;
- a local plugin can read uv's members and sources;
- `@nx/dotnet` can provide `.csproj` dependencies;
- generated dependencies must be compared against the declared graph.

The local plugin must not implement a new resolver. It only translates toolchain metadata into Nx's project model.

### 7.9 Explicit Rust project example

```json
{
  "name": "engine-compute-wgpu",
  "root": "libs/engine/compute-wgpu",
  "projectType": "library",
  "tags": [
    "scope:engine",
    "lang:rust",
    "platform:cross",
    "type:lib"
  ],
  "implicitDependencies": [
    "engine-compute-api"
  ],
  "targets": {
    "check": {
      "executor": "nx:run-commands",
      "options": {
        "command": "cargo check -p engine-compute-wgpu"
      },
      "cache": true,
      "inputs": [
        "{projectRoot}/**/*",
        "{workspaceRoot}/Cargo.toml",
        "{workspaceRoot}/Cargo.lock",
        "{workspaceRoot}/rust-toolchain.toml"
      ]
    }
  }
}
```

The example is conceptual. The real crate name and shared inputs must be defined via `namedInputs`.

### 7.10 Build directories and concurrency

Rust:

- `target/` can continue to be shared by Cargo locally;
- Nx must not publish `target/` as an artifact;
- publishable builds copy only final files into `dist/`;
- overly fragmented Cargo targets can contend for the same lock;
- prefer Cargo tasks with enough granularity to avoid dozens of redundant processes.

Python:

- `uv sync` happens before parallel execution;
- parallel tasks use `--no-sync`.

.NET:

- restore happens before the build matrix;
- targets should not perform implicit restore when `--no-restore` is safe.

Node:

- `pnpm install` happens before Nx;
- targets do not modify the lockfile or `node_modules`.

### 7.11 Global inputs

Build hashes must consider, depending on the target:

- the ecosystem's lockfile;
- the root manifest;
- the member manifest;
- the pinned toolchain;
- the schema;
- the build profile;
- the target triple/RID;
- features;
- environment variables that change output;
- scripts actually executed.

Do not depend on a hidden external variable, such as `RUSTFLAGS`, without declaring it as an input or neutralizing it in CI.

---

## 8. Python management with uv and Nx

### 8.1 Model

Python will be used heavily for:

- HTTP requests;
- automation;
- data generation;
- experimentation;
- AI;
- analysis;
- CI tools;
- documentation;
- maintenance scripts.

uv is the source of truth for:

- dependency resolution;
- lock;
- environment creation;
- execution;
- package build.

Nx only schedules these operations.

### 8.2 Workspace

The uv workspace will have:

- a root `pyproject.toml`;
- a cross-platform `uv.lock`;
- members with their own `pyproject.toml`;
- local dependencies declared as workspace sources;
- dependency groups where appropriate.

uv workspaces share a single lockfile, but each package keeps its own declaration:

- [https://docs.astral.sh/uv/concepts/projects/workspaces/](https://docs.astral.sh/uv/concepts/projects/workspaces/)

### 8.3 `.venv`

The rule is:

> one environment per checkout and per operating system, reconstructible from `uv.lock`.

`.venv`:

- is not universal;
- is not an Nx artifact;
- is not shared Windows ↔ WSL;
- is not sent to the remote cache;
- is not run in parallel by `sync` jobs;
- is not committed.

### 8.4 Avoiding races in parallel tasks

Local and CI flow:

1. run `uv sync --locked` once during bootstrap;
2. run Nx tasks in parallel;
3. within tasks use:

```bash
uv run --locked --no-sync --package <package> <command>
```

This prevents multiple targets from trying to mutate `.venv` simultaneously.

In CI:

```bash
uv lock --check
uv sync --locked
nx affected -t lint test build
```

The behavior of `--locked`, `--frozen`, and `--no-sync` is documented at:

- [https://docs.astral.sh/uv/concepts/projects/sync/](https://docs.astral.sh/uv/concepts/projects/sync/)

### 8.5 Packages with native builds

Python packages that depend on native wheels must:

- use pinned versions;
- prefer official wheels;
- declare platform markers;
- be tested in the OS/architecture matrix;
- never reuse `.venv` from another platform;
- produce their own wheels on native runners when necessary.

The Nx cache may store:

```text
dist/python/<package>/<version>/<platform-tag>/*.whl
```

It must not store the installed environment.

### 8.6 HTTP requests

Libraries such as `requests` must be a dependency of the package that actually uses them.

Example:

```bash
uv add --package automation requests
```

Do not manually install dependencies with `pip` inside `.venv`.

### 8.7 Throwaway scripts versus production automation

- Small experiments can use inline metadata recognized by uv.
- Automation used by CI or release must be a tested member package.
- Scripts must not implicitly depend on the current directory.
- Input, output, and side effects must be explicit.

---

## 9. Node, pnpm, and the Wasm package

### 9.1 pnpm policy

Use:

- the standard content-addressed store;
- workspace protocol;
- a single lockfile;
- Corepack or a pinned version;
- frozen install in CI.

Do not make the experimental Global Virtual Store a requirement.

### 9.2 Wasm codegen (DEC-055)

Generated Wasm bindings (`.wasm`, loader, TypeScript definitions,
ABI/protocol metadata, strictly necessary glue) never live inside a
separate `packages/` technical package, not even gitignored. Instead, the
Rust crate itself (`libs/isekai/wasm-bridge` and equivalents) is *also* a
normal pnpm workspace package: a `package.json` co-located right next to
its `Cargo.toml`, with a `postinstall` script that runs `wasm-pack build
--target web --out-dir pkg`, writing generated output into that same
directory (gitignored). Consuming apps depend on it exactly like any other
workspace package -- `"@grafting/isekai-wasm": "workspace:*"` in
`dependencies`, then a normal `import` -- no custom build script, no Nx
target/`project.json` entry for this at all. A plain `pnpm install`
already performs the conversion, the same as any npm package with native
bindings. There is no standalone `packages/isekai-wasm`-style intermediate
package; `@grafting/isekai-wasm` and `@grafting/vtt-generation-wasm` are
themselves the crates' own package.json identities. See
`docs/adr/ADR-0017-wasm-bindings-colocated-with-crate.md` for the full
rationale, the two earlier designs it supersedes (an app-owned Nx target,
then an app-owned `package.json` script), and the trade-offs.

The Rust crate must not contain domain logic rewritten in TypeScript.

### 9.3 Web wrapper

`packages/isekai-web-client` must offer an idiomatic API:

- Worker creation/termination;
- batch submission;
- Promise per job;
- cooperative cancellation;
- device loss handling;
- structured result decoding;
- transferables management.

Per DEC-055, this package depends on `@grafting/isekai-wasm` as a normal
`workspace:*` dependency and imports it statically, same as before this
decision -- what changed is only where `@grafting/isekai-wasm`'s own
`package.json` lives (co-located in `libs/isekai/wasm-bridge`, not a
separate `packages/isekai-wasm`).

The wrapper must not expose memory offsets to React components.
