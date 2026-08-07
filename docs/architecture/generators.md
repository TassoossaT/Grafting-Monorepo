# Generators and scaffolding

Relocated verbatim from `GRAFTING_MASTER_SOURCE.md` section 17 on 2026-08-07,
as the router table in that document's S0.4 had scheduled. The section
numbering is preserved because `S<n>.<n>` is the stable citation key used from
real source comments and manifests; those citations resolve here now,
unchanged. Precedence and normative language remain in
`GRAFTING_MASTER_SOURCE.md` section 0 and govern everything below.

---

## 17. Generators and scaffolding

### 17.1 Local plugin

A local Nx plugin will be created after the initial scaffold stabilizes.

Planned generators:

- `domain`;
- `rust-crate`;
- `flatbuffer-contract`;
- `python-package`;
- `web-package`;
- `dotnet-wrapper`;
- `adr`;
- `benchmark`.

### 17.2 Domain generator

Input:

- name;
- tags;
- needs a contract?;
- needs compute?;
- needs a public binding?;

Minimum output:

- directory;
- member manifest;
- `project.json`;
- tests;
- local documentation;
- workspace update;
- graph dependencies.

Do not create bindings for every domain automatically. Prefer an aggregated engine API.

### 17.3 Adoption rule

During the bootstrap phase, the first structure can be created manually by the agent.

After the generator passes its tests:

- new standardized projects must use the generator;
- manual topology changes must be justified;
- the generator must be updated when the convention changes.
