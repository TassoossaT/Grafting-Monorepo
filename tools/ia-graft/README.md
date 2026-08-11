# ia-graft

Task-lifecycle CLI (`task new`/`commit`/`test`/`done`/... -- see `AGENTS.md`'s
"Task-based work" section for the canonical workflow) plus a `delegate`
command family for offloading peripheral work to Gemini 3.6 Flash through
the locally installed `agy` CLI, cheaply, without going through Claude.

Invoke as:

```
node --experimental-strip-types tools/ia-graft/src/bin.ts <command> --input '<json>'
```

`--input` takes a JSON string; flags (`--prompt`, `--effort`, `--file`, ...)
are also accepted directly and are more reliable across shells that mangle
quoted JSON (PowerShell in particular).

## `delegate run` -- text in, text/JSON out

```
ia-graft delegate run --prompt "<p>" [--effort low|medium|high] [--file <path>]... [--json-schema <json>]
```

- `--effort` selects the model tier (`delegate-profiles.ts` is the one
  place mapping effort to an actual model/CLI -- see that file if a model
  is renamed, a plan runs out of credits, or a new tier is added).
- `--file` (repeatable, combined content capped at 28k chars -- a Windows
  command-line length limit, not a model/cost concern: the prompt travels
  as a single argv element) embeds a repo file's content directly into the
  prompt. Always prefer this over just naming a path in prose: Gemini's
  agent has file-reading tools of its own, but they can hit a headless
  permission wall and return silently empty output if you rely on it to
  fetch content itself instead of receiving it directly.
- `--json-schema` requests structured output; the response's
  `structured_output` field comes back unwrapped as `output`.
- **Web research works today, no special flag needed.** `agy`'s Gemini
  session has a working `search_web` tool that runs headlessly without
  permission prompts (confirmed by direct testing). A prompt like
  `--prompt "What is the current stable version of X? Use web search,
  don't guess from memory."` triggers a real search and returns a cited,
  current answer in a few seconds -- useful for offloading fact-lookup
  that would otherwise spend the calling agent's own search budget. Verify
  anything load-bearing, same as any web result.

## `delegate edit` -- real write access, sandboxed to one task worktree

```
ia-graft delegate edit --id <TASK-ID> --prompt "<p>" [--effort ...] [--scope <prefix>]... [--context <text>]
```

Gives Gemini real file-write access, but only inside an already-isolated
`ia-graft` task worktree (never the main checkout), and it never commits on
its own -- run the normal `task test`/`task commit`/`task done` afterward.
`--scope` restricts which paths it's allowed to touch; anything else it
changes is reverted automatically. Every prompt is auto-grounded in this
repo's `.ai/INDEX.md` at zero token cost to the caller (a plain file read,
no LLM involved) -- `--context` is only for something INDEX.md wouldn't
cover, and composing it costs whoever calls this its own tokens, so leave
it unset unless you actually need it.

The result includes `changedFiles` (per-file line/word before/after
counts) and `contentStats.possibleContentLoss` -- a cheap, mechanical
word-count signal, not a correctness proof. Known gap: it does not verify
that specific expected files were actually produced, only that whatever
did change didn't shrink suspiciously.
