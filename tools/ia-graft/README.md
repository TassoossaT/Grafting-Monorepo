# ia-graft

Task-lifecycle CLI (`task new`/`commit`/`test`/`done`/`doc-check`/...) plus a `delegate`
command family for offloading peripheral work to Gemini 3.6 Flash through
the locally installed `agy` CLI cheaply, without going through Claude.

From the repository root on Windows, every `ia-graft` command is invoked with `.\ia-graft.cmd` followed by command and flags, and no global installation is required:

```cmd
.\ia-graft.cmd <command> [--flags]
```

This stable opaque launcher forwards every current and future command group; agents must not invoke `src/bin.ts` directly; Codex trusts the entire launcher using `.codex/rules/ia-graft.rules` instead of individual subcommands or broad Node or PowerShell access. Installed package consumers may continue using the `ia-graft` binary.

---

## Task Management Commands

### `task commit` -- Stage & Commit with AI Co-authorship

```bash
ia-graft task commit --id <TASK-ID> --message "<msg>" [--file <path>]... [--agent <name|preset>] [--co-author <name|preset>]...
```

- `--agent`: Specifies primary AI agent (e.g. `gemini`, `claude`, `codex`).
- `--co-author`: Repeatable. Appends `Co-authored-by: Name <email>` trailers natively to the commit. Built-in presets map `gemini`, `claude`, `codex`, `copilot` automatically.

### `doc-check` -- Validate AI Instruction File Size Limits

```bash
ia-graft doc-check
```

- Verifies that core instruction files meet strict size budgets (`AGENTS.md` ≤ 100 lines, `GEMINI.md` ≤ 30 lines, `CLAUDE.md` ≤ 30 lines) to prevent token context inflation.

---

## `delegate` Command Family

### `delegate run` -- Text in, Text/JSON out

```bash
ia-graft delegate run --prompt "<p>" [--effort low|medium|high] [--file <path>]... [--json-schema <json>]
```

- `--effort` selects the model tier (`delegate-profiles.ts`).
- `--file` (repeatable, combined content capped at 28k chars) embeds repo files directly into prompt.
- `--json-schema` requests structured output matching the schema.

### `delegate edit` -- Sandboxed Worktree Writing

```bash
ia-graft delegate edit --id <TASK-ID> --prompt "<p>" [--effort ...] [--scope <prefix>]... [--context <text>]
```

- Gives Gemini real file-write access inside isolated task worktree (`.worktrees/<TASK-ID>`).
- `--scope` restricts touchable paths; out-of-scope edits are auto-reverted.

### `delegate research` -- Web Research Written to Markdown

```bash
ia-graft delegate research --id <TASK-ID> --topic "<t>" --output-file <path.md> [--effort low|medium|high]
```

- Web research wrapper offloading search & summary directly into a target `.md` file in the task worktree.
