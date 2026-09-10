# ia-graft

Task-lifecycle CLI (`task new`/`commit`/`test`/`done`/`doc-check`/...) plus a `delegate`
command family for offloading peripheral work to Gemini 3.6 Flash through
the locally installed `agy` CLI cheaply, without going through Claude.

From the repository root on Windows, every `ia-graft` command is invoked with `.\ia-graft.cmd` followed by command and flags, and no global installation is required:

```cmd
.\ia-graft.cmd <command> [--flags]
```

This stable opaque launcher forwards every current and future command group; agents must not invoke `src/bin.ts` directly. Installed package consumers may continue using the `ia-graft` binary. `ia-graft <command> --help` prints a command's full flag list and the MCP tool it corresponds to.

## Single source of truth

Every command is declared exactly once, in `src/command-registry.ts`. Three consumers are derived from that one declaration and none of them may restate it:

| Derived from the registry | Where |
|---|---|
| MCP tool manifest and JSON Schema | `src/mcp/server.ts` |
| `--flag value` argv parser | `src/cli/argv.ts` |
| CLI routes, usage text and `--help` | `src/bin.ts` |

`defineCommand<TInput>` binds a declaration to its handler's own input interface: `parameters` is a mapped type over `keyof Required<TInput>`, so a field the handler accepts but nobody declared, a declared field the handler does not have, and a required/optional mismatch are all **compile** errors. Drift is caught by `pnpm typecheck`, not by review.

Adding a command means writing the handler and its `*Input` interface, then adding one `defineCommand<ThatInput>({...})` entry. There is no second place to update, and no command is exposed under more than one name.

The CLI flag is derived from the field name (`--<kebab-case>`), so only an established exception is declared: `taskId` reads `--id`, `files` reads `--file`. `flagAliases` carries the back-compatible spellings, `prose: true` adds the `--<flag>-file` form, and `mcpOnly: true` marks a field with no command-line form at all.

## Layout

```
src/
  bin.ts                 CLI entry: routing, usage, --help
  command-registry.ts    every command declared once
  cli/argv.ts            argv -> input, derived from the registry
  mcp/server.ts          stdio JSON-RPC, tools derived from the registry
  commands/              one module per command family; each owns its *Input types
    task.ts  issue.ts  pr.ts  doc-check.ts  guard.ts
    delegate/            run.ts  edit.ts  research.ts  profiles.ts
  git/                   the only place that touches the repository
    exec.ts              child processes, output summarizing
    naming.ts            task paths and branch names, path safety, safe removal
    dependencies.ts      worktree dependency overlays and the lockfile
    remote-branches.ts   merge proof and remote branch deletion
    session.ts           GitWorktreeSession: one open task worktree
    client.ts            GitClient: everything not scoped to one worktree
```

Tests sit beside what they test. The `git/` layer is strictly ordered -- `exec` depends on nothing, `naming` on `exec`, `dependencies` and `session` on both, and only `client` on everything -- so there are no cycles to unpick when reading it.

Nothing above `git/` runs a git or `gh` command directly, and nothing below `commands/` knows what a command is.

## MCP server

`ia-graft mcp` speaks stdio JSON-RPC and serves one tool per registered command. It is registered for the repository in the versioned `.mcp.json`, so it does not depend on any one machine's user configuration.

Agents listed in `MCP_ONLY_AGENTS` (`tools/scripts/agent-task-guard.mjs`) reach `ia-graft` through MCP only: the guard denies the launcher over Bash for them and names the `graft_*` tool to call instead. Agents without an MCP client, such as Codex, keep using the launcher through `.codex/rules/ia-graft.rules`.

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

- `--effort` selects the model tier (`src/commands/delegate/profiles.ts`).
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
