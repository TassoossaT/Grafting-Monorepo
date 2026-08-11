# `ia-graft` known gaps and improvements

Running list of concrete CLI gaps found while doing real task work, kept so
a manual `git`/filesystem exception (which the project's workflow otherwise
forbids — task coordination goes through this CLI only) has a paper trail
back to what should close the gap, instead of the exception becoming a
silent habit. Add an entry when a real task hits a missing capability; do
not pre-populate speculative ones.

## Open

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
