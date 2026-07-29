# Claude runtime coordination guard evaluation — 2026-07-29

## Outcome

A project-scoped Claude Code `PreToolUse` hook was selected and implemented as
a thin enforcement adapter for the existing provider-neutral coordination
protocol. The task and handoff records under `.ai/` remain authoritative.

## Triggering evidence

The repository owner assigned I-004 to Claude, but no corresponding active task
record appeared in `.ai/state/tasks/`. `CLAUDE.md` already contained the correct
claim-before-edit instruction, while `.claude/settings.local.json` contained
permissions only and no hook. This demonstrated that instruction alone was not
an enforceable boundary.

## Options evaluated

### Continue with instructions only

Rejected as enforcement. The instructions remain necessary context, but the
observed missing claim proves they do not guarantee runtime compliance.

### Validate only at commit or in CI

Rejected as the primary boundary. It detects an ownership violation only after
the shared working tree has already been changed.

### Project `PreToolUse` hook

Selected. Claude Code runs the hook before the matched tool and supports a
blocking exit code. Project configuration is shareable, repository-local, and
does not require an MCP, service, credential, or model call. See the official
[hooks reference](https://code.claude.com/docs/en/hooks) and
[hooks guide](https://code.claude.com/docs/en/hooks-guide).

### Organization-managed hook policy

Deferred. Managed settings provide stronger tamper resistance, but require an
organization-controlled Claude deployment outside this repository. The
project hook is appropriate for the owner's current local workflow.

## Implemented boundary

`.claude/settings.json` matches `Write|Edit|Bash` and invokes:

```text
node ${CLAUDE_PROJECT_DIR}/tools/scripts/agent-task-guard.mjs
  --root ${CLAUDE_PROJECT_DIR}
  --agent claude
```

The guard:

- allows simple read-only inspection before a claim;
- allows creation or repair of a task record to avoid bootstrap deadlock;
- requires exactly one `in_progress` task owned by Claude before other
  mutations;
- validates exact Write/Edit paths against the task's `affected_paths`;
- rejects paths covered by another provider's active task;
- prevents editing or overwriting an immutable handoff;
- requires new handoff filenames to identify Claude as sender;
- rejects paths outside the repository.

## Validation

Eleven deterministic Node tests cover missing claims, safe inspection, task
bootstrap, completed/foreign task protection, exact and directory scopes,
cross-owner overlap, unique ownership, handoff immutability, and repository
containment. Direct hook simulations also verify exit code `2` for a blocked
mutation and exit code `0` for permitted inspection and task bootstrap; the
test suite covers work after a valid claim.

## Owner verification in Claude Code

1. Start a new Claude Code session or reload the IDE window.
2. Run `/hooks` and confirm one `Project` `PreToolUse` hook with matcher
   `Write|Edit|Bash`.
3. Confirm `.claude/settings.local.json` does not set
   `"disableAllHooks": true`.
4. Before I-004 is claimed, ask Claude to run a mutating command. It must be
   denied with `no in_progress task is owned by claude`.
5. Have Claude create and claim the I-004 task record, then confirm scoped
   writes are allowed and a path outside `affected_paths` is denied.

## Limitations

- A Bash command is permitted after a unique claim, but arbitrary shell text
  cannot be proven to touch only declared paths before execution. Diff review
  remains mandatory.
- `.claude/settings.local.json` has higher precedence than project settings.
  A user can disable project hooks; use `/hooks` to verify the `Project`
  `PreToolUse` hook is active.
- The adapter enforces Claude Code only. Codex, Gemini, and future providers
  still follow the canonical protocol and need separate evaluated adapters if
  runtime enforcement becomes necessary.
- The hook cannot repair a provider that is not running inside Claude Code.
- The `claude` executable was not available in the current PowerShell `PATH`,
  so client-version and `/hooks` UI verification must be performed inside the
  owner's active IDE integration.

## Rollback

Remove the `PreToolUse` entry from `.claude/settings.json` and revert the guard
script, tests, and documentation. Task and handoff state remains intact.
