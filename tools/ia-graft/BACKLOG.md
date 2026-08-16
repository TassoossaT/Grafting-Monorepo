# `ia-graft` known gaps and improvements

Running list of concrete CLI gaps found while doing real task work, kept so
a manual `git`/filesystem exception (which the project's workflow otherwise
forbids — task coordination goes through this CLI only) has a paper trail
back to what should close the gap, instead of the exception becoming a
silent habit. Add an entry when a real task hits a missing capability; do
not pre-populate speculative ones.

## Open

*(No open CLI gaps at this time).*

## Resolved (kept for history, do not re-add)

- **Task-worktree dependency symlinks in Turbopack / Next.js.**
  Investigated and resolved 2026-08-16 in task `IA-GRAFT-TURBOPACK-SYMLINKS`.
  Root cause isolated:
  1. *Missing gitignored build artifacts in fresh worktrees*: Workspace packages (`@grafting/ui`, `@grafting/render-3d`, `@grafting/procgen-*-wasm`) export from `dist/` or `pkg/` (`./dist/index.js`, `./pkg/...`). In freshly created worktrees, these gitignored outputs are not yet compiled; running `next build` / `next dev --turbo` before compiling workspace dependencies caused module resolution failures that surfaced as missing packages or missing transitive dependencies (`rete-connection-plugin`).
  2. *Turbopack root security boundary*: Turbopack restricts module compilation to its inferred workspace root. When `turbopack.root` was manually set to `.worktrees/<taskId>`, Turbopack resolved symlinks/junctions to external dependencies (e.g. `next`, `antd`, `react`) pointing into the outer repository's `node_modules` (or `.ia-graft-task-deps`), detecting them as outside `turbopack.root` and throwing `next/package.json not found`. Leaving `turbopack.root` unset allows Next.js to automatically infer the monorepo root (`Grafting Monorepo`), which encompasses both the outer `node_modules` and `.worktrees/<taskId>`.
  3. *Validation*: Verified both `apps/vtt` and `apps/architecture-studio` build cleanly (`next build` with Turbopack) and run live (`next dev --hostname 127.0.0.1 --port 4512`) returning HTTP 200 on dynamic routes (`/table/demo`) in task worktrees.
- **Commit amend and dry-run support in `task commit`.**
  `task commit --amend` allows correcting the unpushed HEAD commit message or author without creating extra commits. `task commit --dry-run` (and `--check`) validates input shape and previews changes without mutating git state.
  Resolved 2026-08-16 in task `IA-GRAFT-COMMIT-AMEND-DRYRUN`.
- **CLI-native cross-package workspace dependencies and lockfile updates.**
  `task deps --install --update-lockfile` (and `task deps --update-lockfile`) runs
  pnpm with `--no-frozen-lockfile`, recomputes the lockfile hash, and updates the
  managed overlay marker. `task deps --add <pkg>@<range> [--workspace <name>] [--dev]`
  edits `package.json` and updates dependencies and lockfile together in one step.
  Resolved 2026-08-16 in task `IA-GRAFT-DEPS-UPDATE-LOCKFILE`.
- **Branch-aware `task new` resume, `task checkout --restore` (test a task
  branch in the main checkout without merging), Windows-safe `task cleanup
  --force`, and `task done`/`checkout` resolving the real default branch via
  `resolveDefaultBranch()` instead of assuming `main` — all present in
  `task-commands.ts` as of 2026-08-11. Originally surfaced 2026-08-04
  during `VTT-TERRAIN-QUANTIZATION` (see project memory
  `feedback-never-manual-worktree-git`); the gap list itself only ever
  lived in that session's scratchpad and was lost to compaction, which is
  why this file exists now instead of another scratchpad note.
