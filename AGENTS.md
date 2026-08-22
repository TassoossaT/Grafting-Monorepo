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
  - MUST NOT hand-roll a generic, product-agnostic capability (a UI atom, a hook, a math/utility function, a template) inside an app when it carries no product-specific semantics. Promote it to the relevant `packages/*`, or create a new package, so other apps can reuse it instead of re-deriving it later. Packages MAY be created freely whenever a genuinely reusable capability emerges; do not wait for a second consumer to justify extraction — the test is whether the thing has any product meaning baked in, not how many callers it currently has.
  - MUST NOT import vendor APIs outside designated owning package or leak vendor-owned types in Grafting public APIs (DEC-049, [ADR-0011](docs/adr/ADR-0011-package-autonomy-and-external-isolation.md)).
  - MUST NOT hardcode visual identity or interaction policy in capability packages (DEC-052, [ADR-0014](docs/adr/ADR-0014-composable-capability-packages.md)).
  - MUST NOT expose Rust types directly through ABI, promise cross-domain zero-copy, or misname authoritative replication "Event Sourcing".
  - MUST NOT change public API names, parameters, or contracts without baseline updates and passing `api-check` (DEC-051).
  - MUST NOT inspect `cfg(target_os)`, `navigator.gpu`, `process.platform`, or RID outside `polymath` abstractions (DEC-042, [ADR-0006](docs/adr/ADR-0006-polymath-platform-abstraction.md)).

- **Git & PR Governance:**
  - MUST NOT execute direct mutating git commands (`git commit`, `git add`, `git checkout`, `git switch`, `git branch`, `git push`, `git merge`, `git rebase`, `git reset`, `git stash`). All Git operations MUST execute through `ia-graft`.
  - MUST NOT execute direct package installs (`pnpm/npm/yarn install/add`); use `ia-graft task deps`.
  - MUST NOT merge a pull request (human merges only, DEC-053, [ADR-0015](docs/adr/ADR-0015-agent-git-write-policy.md)).
  - MUST NOT commit directly on `master`/`main` for any change touching non-Markdown files.

## 2. TASK LIFECYCLE & ISSUE GOVERNANCE (`tools/ia-graft`)

- **Autonomous Execution:** User requests pre-authorize all necessary `ia-graft` commands through `task done` without pausing for confirmation; merging PRs remains human-only.
- **Issue & Backlog Governance:** Manage backlog, refinements, and tasks via `ia-graft issue <list|view|new|update>`. Do NOT invent unversioned markdown backlogs.
- On Windows invoke `.\ia-graft.cmd` followed by the command; `.codex/rules/ia-graft.rules` pre-authorizes the launcher.
- **Documentation-Only Edits (100% Markdown prose):** Commit directly to `master`/`main` (no task branch needed). Protocol/policy changes require owner approval before commit.
- **Code, Config, Contract & Script Edits:**
  1. Start task: `ia-graft task new --id TASK-<ISSUE-ID>-<SLUG> [--base <branch>] [--parent <ID>]`
  2. **Stacked PRs:** When building upon an unmerged task, MUST use `--parent <PARENT-TASK-ID>`. `task done` automatically opens a stacked PR targeting the parent branch.
  3. Work inside `.worktrees/<TASK-ID>/` isolated worktree.
  4. Incremental commits: `ia-graft task commit --id <TASK-ID> --message "<msg>" [--amend] [--agent <name>]`
  5. Run verification: `ia-graft task test --id <TASK-ID> --command "<cmd>"`
  6. Submit for review: `ia-graft task done --id <TASK-ID> --title "<title>" --body "Closes #<ISSUE-ID>\n\n<details>"`
  7. Clean up after merge: `ia-graft task cleanup --id <TASK-ID>`

## 3. TOKEN ECONOMY & DELEGATION (`ia-graft`)

- **Mandatory Context Packing:** Agents MUST run `ia-graft context --pack` or `ia-graft task resume` when starting/resuming tasks to load scoped context and avoid token waste.
- **Surgical Inspection:** Agents MUST use pattern search (`grep`, `glob`) and targeted line ranges (`view_file`), never reading full files (>100 lines) unnecessarily.
- **Mandatory Sub-Agent Delegation (`ia-graft delegate`):**
  - **Fact Lookup & Research:** MUST offload web searches, broad codebase surveys, or schema extraction via `ia-graft delegate run` or `ia-graft delegate research`.
  - **Sandboxed Code Editing:** MUST delegate repetitive code edits inside a task worktree via `ia-graft delegate edit`.
  - **Stdio MCP Integration:** Prefer native `graft_context_pack`, `graft_task_resume`, and `graft_task_status` MCP tools.

## 4. STOP CONDITIONS

Stop immediately and request human decision when: an open decision gate changes structure, major ABI break occurs, GPU sharing between runtimes is required, or a `LOCKED` choice appears unviable.
