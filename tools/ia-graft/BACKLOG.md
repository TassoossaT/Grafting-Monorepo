# `ia-graft` known gaps and improvements

Running list of concrete CLI gaps found while doing real task work, kept so
a manual `git`/filesystem exception (which the project's workflow otherwise
forbids — task coordination goes through this CLI only) has a paper trail
back to what should close the gap, instead of the exception becoming a
silent habit. Add an entry when a real task hits a missing capability; do
not pre-populate speculative ones.

## Open

- **Task-worktree dependency symlinks break `next dev --turbo` module
  resolution for some transitive packages.** Discovered 2026-08-14 on
  `VTT-CONSTRUCTION-GRID` trying to browser-verify a change to
  `apps/vtt`: `packages/ui/node_modules/rete-connection-plugin` (a real
  transitive dependency `packages/ui/package.json` declares, needed by its
  `canvas/graph` module which `apps/vtt`'s barrel import pulls in even
  though `apps/vtt` itself only uses `createHeightfieldCanvas`) is a symlink
  into the *main repo's* `node_modules/.ia-graft-task-deps/<taskId>/...`
  cache, outside the task worktree entirely — Turbopack's dev server fails
  to resolve it (`Module not found: Can't resolve 'rete-connection-plugin'`)
  even though the file genuinely exists at that path and `tsc --noEmit`
  resolves it fine. Setting `turbopack.root` explicitly made it *worse*
  (`next/package.json` itself unresolvable — `next` is linked the same
  symlinked way), confirming this is general to the linking scheme, not one
  package. Root cause not fully isolated (unclear whether Turbopack refuses
  to follow symlinks that resolve outside its inferred root, or something
  narrower); not fixed here — reverted the `next.config.mjs` attempt rather
  than guess further, and verified this task's actual change via
  `tsc --noEmit` + `node --test` only, no live browser check. Worth
  isolating properly since it silently blocks the project's own
  "browser-verify before done" convention for any task-worktree touching
  `apps/vtt` (or any other Next.js app) whose dependency graph reaches a
  package with this symlink shape.
## Resolved (kept for history, do not re-add)

- **CLI-native commit amend and dry-run validation.** `task commit --amend` amends
  the previous commit on the task branch without creating redundant commits.
  `task commit --dry-run` (or `--check`) validates taskId, commit message, and
  author resolution without executing git operations or modifying the tree.
  Resolved 2026-08-16 in task `IA-GRAFT-COMMIT-AMEND-DRYRUN`.
- **CLI-native cross-package workspace dependencies and lockfile updates.**
  `task deps --install --update-lockfile` (and `task deps --update-lockfile`) runs
  pnpm with `--no-frozen-lockfile`, recomputes the lockfile hash, and updates the
  managed overlay marker. `task deps --add <pkg>@<range> [--workspace <name>] [--dev]`
  edits `package.json` and updates dependencies and lockfile together in one step.
  Resolved 2026-08-16 in task `IA-GRAFT-DEPS-UPDATE-LOCKFILE`.
- Branch-aware `task new` resume, `task checkout --restore` (test a task
  branch in the main checkout without merging), Windows-safe `task cleanup
  --force`, and `task done`/`checkout` resolving the real default branch via
  `resolveDefaultBranch()` instead of assuming `main` — all present in
  `task-commands.ts` as of 2026-08-11. Originally surfaced 2026-08-04
  during `VTT-TERRAIN-QUANTIZATION` (see project memory
  `feedback-never-manual-worktree-git`); the gap list itself only ever
  lived in that session's scratchpad and was lost to compaction, which is
  why this file exists now instead of another scratchpad note.
