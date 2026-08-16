# Multi-Agent Coordination Protocol

Canonical multi-agent communication and task execution protocol for Grafting Monorepo.
All task execution MUST use `tools/ia-graft`.

## 1. AUTHORITY HIERARCHY

1. `GRAFTING_MASTER_SOURCE.md`
2. Accepted ADRs (`docs/adr/`)
3. Root [`AGENTS.md`](../../AGENTS.md)
4. Implemented code, manifests, contracts, and schemas
5. Provider adapters (`GEMINI.md`, `CLAUDE.md`, `CODEX.md`) and chat history

## 2. IA-GRAFT COMMAND FAMILY SUMMARY

- `task new --id <ID> [--base <branch>] [--parent <PARENT-ID>]` — Creates or resumes isolated Git worktree (`.worktrees/<ID>`). Use `--parent` for Stacked PRs chained on an open task.
- `task commit --id <ID> --message "<m>" [--amend] [--dry-run] [--agent <a>]` — Stages and commits inside task worktree with AI co-authorship.
- `task test --id <ID> --command "<c>"` — Runs verification commands inside worktree with capped summary output.
- `task done --id <ID> --title "<t>" --body "<b>"` — Pushes task branch and opens/updates PR (or stacked PR) via `gh`.
- `task sync --id <ID> [--fetch]` — Integrates forward-only base updates without rebase.
- `task deps --id <ID> [--install] [--update-lockfile] [--add <pkg>]` — Managed dependency overlay and lockfile updates.
- `task cleanup --id <ID> [--force]` — Removes merged worktree and deletes task branch after PR merge.
- `delegate run --prompt "<p>" [--file <f>] [--effort low|med|high]` — Offloads web research / fact-checking headlessly.
- `delegate edit --id <ID> --prompt "<p>" [--scope <s>]` — Sandboxed code editing in task worktree.
- `delegate research --id <ID> --topic "<t>" --output-file <f.md>` — Researches and writes Markdown docs directly.
- `doc-check` — Validates instruction file size limits (`AGENTS.md` ≤ 100 lines).
- `guard-check` — Deterministic tool permission check.

## 3. RUNTIME SAFETY GUARDS & HOOKS

- `tools/scripts/agent-task-guard.mjs` and `.codex/rules/ia-graft.rules` intercept and block manual mutating Git commands (`git commit/add/checkout/push/reset`).
- **Autonomous Execution:** Agents have global pre-approval to run all `ia-graft` commands through `task done` without asking.
- **Forbidden Operations:** Direct commits on `master`/`main` (except 100% Markdown prose), manual Git mutations, direct package manager installs, and agent-side PR merges (`gh pr merge` — human merges only).

## 4. PRE-PULL REQUEST CHECKLIST

1. Run formatting, linting, typechecking, and tests via `ia-graft task test`.
2. If modifying `src/` in TypeScript or Rust packages, regenerate API reference docs:
   `node tools/scripts/generate-api-docs.mjs <name>` / `node tools/scripts/generate-rust-api-docs.mjs <name>`.
3. If adding 3rd party code, add attribution header, update `THIRD_PARTY_NOTICES.md`, and run `check-third-party-notices.mjs`.
4. Validate instruction file sizes with `ia-graft doc-check`.
