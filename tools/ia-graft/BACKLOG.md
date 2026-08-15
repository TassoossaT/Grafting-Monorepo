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
- **No CLI-native way to add a new cross-package workspace dependency.**
  `task deps --install` (`taskDependencies` → `GitClient.prepareTaskDependencies`
  → `materializeTaskDependencies`, `git-client.ts`) always runs `pnpm install
  --frozen-lockfile`, unconditionally. Discovered 2026-08-14 on
  `VTT-TERRAIN-SHAPE-PICKER`: adding `"@grafting/ui": "workspace:*"` to
  `apps/vtt/package.json` (a real, wanted new dependency edge, not a probe)
  left `pnpm-lock.yaml` out of date, and `task deps --install` failed with
  `ERR_PNPM_OUTDATED_LOCKFILE` instead of updating it — there is no
  `--no-frozen-lockfile` escape hatch, and `agent-task-guard.mjs` separately
  blocks calling `pnpm install` directly. A fix needs either: (a) `task deps
  --install --update-lockfile` (or similar) that runs pnpm without
  `--frozen-lockfile` when the task's own `package.json` changed, or (b) a
  dedicated `task deps --add <pkg>@<range> --workspace <name>` that edits
  `package.json` and regenerates the lockfile together in one guarded step.

- **No commit-message fix/amend path.** `task commit --input
  '{"taskId","message"}'` (`task-commands.ts`, `taskCommit`) always creates
  a new commit; there is no `--amend` or `task commit --fix-message`
  equivalent. Discovered 2026-08-11 on `GRAPH-STORAGE-BENCH`: a
  CLI-input-shape probe (`{"message":"placeholder"}`) committed for real
  instead of just validating the shape, leaving a wrong message with no
  CLI-native way to correct it — the fallback was a manual, user-authorized
  one-off `git commit --amend` exception. Two independent fixes would have
  prevented needing the exception: (a) `task commit` supporting `--amend`
  (or a separate `task commit --fix-message`) for the still-unpushed,
  current-HEAD case; (b) a `--dry-run`/`--check` flag on `task commit` for
  exactly this "does the CLI accept this input shape" probe, so testing
  input shape never risks a real commit.

## Resolved (kept for history, do not re-add)

- Branch-aware `task new` resume, `task checkout --restore` (test a task
  branch in the main checkout without merging), Windows-safe `task cleanup
  --force`, and `task done`/`checkout` resolving the real default branch via
  `resolveDefaultBranch()` instead of assuming `main` — all present in
  `task-commands.ts` as of 2026-08-11. Originally surfaced 2026-08-04
  during `VTT-TERRAIN-QUANTIZATION` (see project memory
  `feedback-never-manual-worktree-git`); the gap list itself only ever
  lived in that session's scratchpad and was lost to compaction, which is
  why this file exists now instead of another scratchpad note.
