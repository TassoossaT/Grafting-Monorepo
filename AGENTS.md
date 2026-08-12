# AGENTS.md — Grafting Monorepo Agent Operational Contract

Canonical, machine-first operational rules for AI agents (Claude, Gemini, Codex) in Grafting Monorepo.
All non-prose changes MUST execute exclusively through the root `ia-graft` launcher (`.\ia-graft.cmd` on Windows).

## 1. MANDATORY CONSTRAINTS (MUST NOT)

- **Decisions & Architecture:**
  - MUST NOT silently close an `OPEN` decision or replace a `LOCKED` technology choice.
  - MUST NOT treat summary documents as superior to `GRAFTING_MASTER_SOURCE.md`.
  - MUST NOT create a second workspace root or lockfile without an ADR.
  - MUST NOT use Nx to replace native toolchains (Cargo, pnpm, uv, .NET).
  - MUST NOT create top-level `spikes/` directories; use `apps/architecture-studio` (`/lab`).
  - MUST NOT create an empty future directory tree.
  - MUST NOT introduce tools, agents, skills, or MCPs without explicit evaluation.
  - MUST NOT modify security controls or agent policy without owner approval.

- **Code Autonomy & Boundaries:**
  - MUST NOT duplicate Rust logic in TypeScript, C#, or Python. Reusable graph structures, algorithms, layout math, and queries belong strictly to `grafting-graph-core` (DEC-051, [ADR-0013](docs/adr/ADR-0013-rust-graph-core-and-api-contracts.md)).
  - MUST NOT duplicate authoritative behavior across packages; maintain single canonical source (DEC-049).
  - MUST NOT import vendor APIs outside designated owning package or leak vendor-owned types in Grafting public APIs (DEC-049, [ADR-0011](docs/adr/ADR-0011-package-autonomy-and-external-isolation.md)).
  - MUST NOT hardcode visual identity or interaction policy in capability packages (DEC-052, [ADR-0014](docs/adr/ADR-0014-composable-capability-packages.md)).
  - MUST NOT expose Rust types directly through ABI, promise cross-domain zero-copy, or misname authoritative replication "Event Sourcing".
  - MUST NOT change public API names, parameters, or contracts without baseline updates and passing `api-check` (DEC-051).
  - MUST NOT inspect `cfg(target_os)`, `navigator.gpu`, `process.platform`, or RID outside `polymath` abstractions (DEC-042, [ADR-0006](docs/adr/ADR-0006-polymath-platform-abstraction.md)).

- **Git & PR Governance:**
  - MUST NOT merge a pull request (human merges only, DEC-053, [ADR-0015](docs/adr/ADR-0015-agent-git-write-policy.md)).
  - MUST NOT commit directly on `master`/`main` for any change touching non-Markdown files.

## 2. TASK LIFECYCLE (`tools/ia-graft`)

- `ia-graft` is the opaque repository-owned boundary for every command it exposes; agents must not invoke its Node entry point directly or inspect, reproduce, or separately operate its internal Git or hosting mechanics.
- Any request authorizing in-scope code, config, contract, or script work also authorizes every necessary `ia-graft` invocation through `task done`, including configured submission side effects, without separate confirmation; merging remains human-only.
- On Windows invoke `.\ia-graft.cmd` followed by the command; the project rule at `.codex/rules/ia-graft.rules` intentionally authorizes the entire launcher, including future subcommands.

- **Documentation-Only Edits (100% Markdown prose):**
  - Commit directly to `master`/`main` (no task branch, no PR needed).
  - Protocol/policy changes require owner approval before commit.

- **Code, Config, Contract & Script Edits:**
  1. Start task: `ia-graft task new --id <TASK-ID> [--base <branch>] [--parent <ID>]`
  2. Work inside `.worktrees/<TASK-ID>/` isolated worktree.
  3. Incremental commits: `ia-graft task commit --id <TASK-ID> --message "<msg>" [--agent <name>] [--co-author <name>]`
  4. Run verification: `ia-graft task test --id <TASK-ID> --command "<cmd>"`
  5. Submit for review: `ia-graft task done --id <TASK-ID> --title "<title>" --body "<body>"`
  6. Clean up after merge: `ia-graft task cleanup --id <TASK-ID>`

## 3. TOKEN ECONOMY & DELEGATION (`ia-graft`)

- **Token Economy & Discovery:**
  - Use pattern search (`grep`, `glob`) instead of full directory listing.
  - Read targeted line ranges (`view_file`), never full files unnecessarily.
  - Rely on `ia-graft context` or `GRAFTING_MASTER_SOURCE.md` (§0.4 router) for on-demand domain specs.
  - Run `ia-graft doc-check` to verify AI instruction size limits (`AGENTS.md` ≤ 100 lines).

- **Sub-Agent Delegation (`ia-graft delegate`):**
  - **Fact Lookup & Text Generation:** Use `ia-graft delegate run --prompt "<p>" [--file <path>]... [--effort low|medium|high]` to offload web searches or schema extraction without consuming caller context.
  - **Sandboxed Code Editing:** Use `ia-graft delegate edit --id <TASK-ID> --prompt "<p>" [--scope <prefix>]...` to delegate repetitive code edits inside a task worktree.
  - **Markdown Doc Research:** Use `ia-graft delegate research --id <TASK-ID> --topic "<t>" --output-file <path.md>` to research and write `.md` documents directly to disk.

## 4. STOP CONDITIONS

Stop immediately and request human decision when: an open decision gate changes structure, major ABI break occurs, GPU sharing between runtimes is required, or a `LOCKED` choice appears unviable.
