# Third-party code notices

This file records every piece of external open-source code **copied or
adapted** into this repository — not ordinary dependencies (those are
already declared in each project's own `package.json`/`Cargo.toml`/
`pyproject.toml` and carry their own license terms as installed packages).
This file exists specifically for the case where source code from another
project is read, understood, and rewritten/ported into this codebase (for
example: porting a deck.gl layer's rendering technique into a Three.js-native
implementation).

Required by `.ai/coordination/PROTOCOL.md` and `AGENTS.md` whenever that
happens — attribution is never removed, regardless of the target project's
license permissions around commercial or closed-source use.

## How an entry gets here

1. Add a header comment at the top of every adapted file, in whatever
   comment syntax the language uses:

   ```text
   Adapted from <Project Name> (<source URL>).
   Original license: <SPDX-License-Identifier>. See THIRD_PARTY_NOTICES.md.
   ```

2. Add a matching entry below, in the same format as the template entry.
3. Run `node tools/scripts/check-third-party-notices.mjs` — it scans every
   Git-tracked source file for the marker above and fails if a marked file's
   project name has no corresponding entry here. This is a real,
   automatable check (wired into CI), not only a reminder.

A `PostToolUse` hook (`tools/scripts/third-party-attribution-reminder.mjs`,
wired in `.claude/settings.json`) reminds Claude Code when a `Write`/`Edit`
introduces content matching the marker pattern — it only reminds, it never
blocks or edits anything itself, the same non-enforcing design as the
existing research-registry reminder hook.

## Notice entry template

```markdown
### <Project Name>

- Source: <repository URL>
- License: <SPDX-License-Identifier> (verify current terms before relying on
  this — license facts drift; re-check at the time code is actually
  adapted)
- Adapted into: <repo-relative path(s) of the file(s) containing the
  adaptation>
- What was adapted: <one sentence — e.g. "the building-extrusion vertex
  shader technique from PolygonLayer">
- Date: <YYYY-MM-DD>
```

## Notices

None yet. The first entries will be added when deck.gl layer code is
actually ported into a Three.js-native implementation
(see `docs/research/vtt-map-and-terrain-construction-options.md`).
