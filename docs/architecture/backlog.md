# Initial backlog

Relocated verbatim from `GRAFTING_MASTER_SOURCE.md` section 23 on 2026-08-07,
as the router table in that document's S0.4 had scheduled. The section
numbering is preserved because `S<n>.<n>` is the stable citation key used from
real source comments and manifests; those citations resolve here now,
unchanged. Precedence and normative language remain in
`GRAFTING_MASTER_SOURCE.md` section 0 and govern everything below.

---

## 23. Initial backlog

### Epic A — Decisions and proofs of concept

| ID    | Work              | Depends on  | Acceptance criteria                           |
| ----- | ---------------------- | ----------- | --------------------------------------------- |
| A-001 | Web host ADR       | —          | GATE-001 closed with justification            |
| A-002 | C# engine ADR      | —          | GATE-002 closed and P/Invoke risk assessed |
| A-003 | V1 platforms ADR | —          | explicit OS/arch matrix                  |
| A-004 | Determinism ADR   | —          | required levels defined                    |
| A-005 | Rust/C# C ABI spike   | A-002       | create/execute/destroy and error work       |
| A-006 | Wasm/Worker spike   | A-001       | batch processed off the main thread          |
| A-007 | Native `wgpu` spike  | —          | compute + async readback                |
| A-008 | Web `wgpu` spike     | A-006       | same WGSL runs on WebGPU                  |
| A-009 | Copy benchmark  | A-005,A-006 | copy budget measured                  |
| A-010 | Evaluate `@nx/dotnet` | A-002       | adopt or record fallback                  |

### Epic B — Workspace foundation

| ID    | Work                | Depends on   | Acceptance criteria                       |
| ----- | ----------------------- | ------------ | ----------------------------------------- |
| B-001 | Create pnpm/Nx workspace | A-001        | executable graph                         |
| B-002 | Create Cargo workspace   | —           | `cargo check --workspace`               |
| B-003 | Create uv workspace      | —           | `uv lock --check` and example package      |
| B-004 | Create .NET solution    | A-002        | minimal restore/build                     |
| B-005 | Pin toolchains        | B-001..B-004 | reproducible versions                   |
| B-006 | Create bootstrap         | B-005        | installs/syncs once                |
| B-007 | Configure Nx cache     | B-001        | second build restores output               |
| B-008 | Configure affected     | B-007        | local change runs only dependents |
| B-009 | Initial Linux CI        | B-006        | green PR on clean checkout                |
| B-010 | Initial Windows CI      | B-004,B-006  | DLL and C# tests green                |

### Epic C — Core and contracts

| ID    | Work                     | Depends on        | Acceptance criteria             |
| ----- | ---------------------------- | ----------------- | ------------------------------- |
| C-001 | Create `domain-core`         | B-002             | pure crate with no host/network/GPU |
| C-002 | Define minimal Command      | C-001             | validation and test             |
| C-003 | Define minimal DomainEvent  | C-002             | tested semantic event       |
| C-004 | Define minimal Snapshot     | C-001             | round trip and hash               |
| C-005 | Configure `flatc`          | B-001,B-002,B-004 | TS/C#/Rust generated              |
| C-006 | Define schema evolution | C-005             | compatibility test        |
| C-007 | Implement state hash       | C-001             | replay reproduces hash             |
| C-008 | Create property tests         | C-002..C-004      | invariants covered            |

### Epic D — Isekai, ABI, and bindings

| ID    | Work                         | Depends on   | Acceptance criteria                 |
| ----- | -------------------------------- | ------------ | ----------------------------------- |
| D-001 | Define `EngineAbiInfo`         | A-005        | compatibility tested             |
| D-002 | Implement handles              | C-001        | generation and double-release tested |
| D-003 | Implement engine lifecycle     | D-002        | states and poison tested           |
| D-004 | Implement buffer lease         | D-002        | view/release without leak               |
| D-005 | Export `isekai-capi` v1       | D-001..D-004 | header and DLL                        |
| D-006 | Create `Grafting.Isekai.Interop` | D-005        | `SafeHandle` and smoke test         |
| D-007 | Create `isekai-wasm`             | C-001,D-002  | offsets/handles tested            |
| D-008 | Create `isekai-web-client`       | D-007        | Promise/job/cancel/shutdown         |
| D-009 | Memory test                | D-006,D-008  | no leak in the target scenario           |

### Epic E — Compute

| ID    | Work                 | Depends on  | Acceptance criteria              |
| ----- | ------------------------ | ----------- | -------------------------------- |
| E-001 | Create `compute-api`     | C-001       | domain does not depend on `wgpu` |
| E-002 | Create `compute-cpu`     | E-001       | correct baseline                 |
| E-003 | Choose pilot workload | A-007,A-008 | dataset and metric defined     |
| E-004 | Create single WGSL        | E-003       | validates native and Web              |
| E-005 | Create `compute-wgpu`    | E-001,E-004 | device/pipeline/job              |
| E-006 | Persistent buffers     | E-005       | amortized upload                |
| E-007 | Async readback     | E-005       | no wait on UI             |
| E-008 | CPU fallback             | E-002,E-005 | capability switch tested        |
| E-009 | Differential test        | E-002,E-005 | tolerance approved             |
| E-010 | Decision benchmark     | E-006,E-007 | range in which GPU wins           |

### Epic F — Hosts

| ID    | Work                     | Depends on  | Acceptance criteria          |
| ----- | ---------------------------- | ----------- | ---------------------------- |
| F-001 | Web scaffold                 | A-001,B-001 | app starts                   |
| F-002 | Integrate Worker/Wasm         | D-008,F-001 | state comes from Rust           |
| F-003 | Integrate Three.js            | F-001       | renderer separate from compute |
| F-004 | Desktop scaffold             | A-002,B-004 | app starts                   |
| F-005 | Integrate DLL                 | D-006,F-004 | state comes from Rust           |
| F-006 | Native packaging             | F-005       | correct DLL per RID          |
| F-007 | Shared vertical slice | F-002,F-005 | equivalent behavior    |

### Epic G — Automation and documentation

| ID    | Work                | Depends on  | Acceptance criteria               |
| ----- | ----------------------- | ----------- | --------------------------------- |
| G-001 | Create `AGENTS.md`      | B-001       | correct rules and commands        |
| G-002 | Create `CLAUDE.md`      | G-001       | short adapter, no duplication |
| G-003 | Generate repo map          | B-001       | reproducible derived file    |
| G-004 | Generate artifact manifest | D-001       | correct versions and target        |
| G-005 | ADR template         | —          | standardized new ADR              |
| G-006 | Crate generator      | B-001,B-002 | valid crate and graph            |
| G-007 | Domain generator   | G-006,C-005 | complete slice                    |
| G-008 | `docs:check`          | G-003,G-004 | CI detects drift                 |

### Epic H — Future multiplayer

| ID    | Work                 | Depends on  | Acceptance criteria           |
| ----- | ------------------------ | ----------- | ----------------------------- |
| H-001 | Authoritative host ADR | GATE-004    | GATE-004 closed              |
| H-002 | AcceptedCommand          | C-002       | order/dedup tested          |
| H-003 | Journal                  | H-002       | append/recovery               |
| H-004 | Snapshot recovery        | C-004,H-003 | validated hash                 |
| H-005 | Projection core          | C-003       | private information isolated  |
| H-006 | ReplicationDelta         | H-005       | client-specific delta |
| H-007 | Transport adapter        | H-001,H-006 | core remains agnostic      |

---

### Epic I — Knowledge Plane and Graph IR

| ID    | Work                            | Depends on  | Acceptance criteria                            |
| ----- | ----------------------------------- | ----------- | ---------------------------------------------- |
| I-001 | Knowledge & Automation Plane ADR | —          | authority and documentary lifecycle defined    |
| I-002 | Graph IR v1                         | I-001       | schemas, IDs, and evidence validated            |
| I-003 | Per-project operational/API template | I-001       | README, AGENTS, metadata, generated API baseline, `api-check`, and behavioral contracts validated |
| I-004 | Nx → Graph IR extractor             | I-002,B-001 | reproducible projects/targets/edges          |
| I-005 | Context pack v1                     | I-002,G-001 | task generates a small, traceable package         |
| I-006 | Read-only Architecture Studio       | I-002,I-004 | navigable subgraph without editing derived facts |
| I-007 | Drift check                         | I-003,I-004 | CI detects outdated documentation/graph  |

### Epic J — AI Control Plane

| ID    | Work                          | Depends on        | Acceptance criteria                                 |
| ----- | --------------------------------- | ----------------- | ----------------------------------------------------- |
| J-001 | Create `.ai/` structure           | I-001             | valid registry, policies, contracts, and state      |
| J-002 | Install AI System Maintainer     | J-001,B-003       | observe/audit tested via uv                       |
| J-003 | Capabilities and agents registry | J-001             | unique IDs and valid schemas                      |
| J-004 | Skill lifecycle and adapters        | J-003,G-001,G-002 | same skill locatable by Claude and Codex         |
| J-005 | Prompt IR v1                      | J-001             | compiled prompt with reproducible hash               |
| J-006 | Promptfoo                         | J-005       | evaluated regressions and triggers               |
| J-007 | Bifrost gateway spike             | J-005,J-006       | routing/cost/exact cache measured                |
| J-008 | Langfuse spike                    | J-005,J-006       | tracing with validated data policy             |
| J-009 | Learning candidates               | J-002,J-006       | evidence becomes a proposal, not an automatic change |
| J-010 | LangMem/GEPA/DSPy spikes          | J-009             | variant evaluated in a branch with rollback            |
| J-011 | Context Broker MCP                | I-005,J-003       | minimal tools tested in MCP Inspector            |
| J-012 | AI Graph IR extension             | I-002,J-003,J-005 | skills/prompts/runs appear with evidence         |
