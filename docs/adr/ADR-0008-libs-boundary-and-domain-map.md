# ADR-0008: `libs/` boundary rule and domain map for multi-product reuse

- Status: **Accepted.** Not a numbered Decision Gate of the master source; it is a
  complementary structural decision, in the same spirit as
  `docs/adr/ADR-0006-polymath-platform-abstraction.md`, recorded as
  DEC-046.
- Proposal date: 2026-07-26
- Decision date: 2026-07-26
- Motivated by: the decision to keep a single monorepo
  (`docs/adr/ADR-0007-repo-distribution-strategy.md`) and the owner's plan
  to build multiple products (VTT, future ones) reusing code, including new
  domains not yet foreseen in the master source (narrative/story, session/
  campaign) and external integrations (Discord, transcription).
- Related `LOCKED` decisions: DEC-001 (Rust is the single source of logic),
  section 4.3 (future domains are born as feature slices in `libs/domains`),
  `docs/architecture/ai-control-plane.md` §16.8 (X6 is the Graph IR
  viewer/editor in the Architecture Studio)
- Authority: in case of conflict, `GRAFTING_MASTER_SOURCE.md` prevails over
  this ADR.

## Context

Section 4.3 of the master source already foresaw domains like physics,
pathfinding, and AI being born in `libs/domains` by feature slice, but it
never needed an **explicit rule** for when something is *required* to be born
there — with a single product (VTT + desktop game, both hosts of the same
core), the `libs/` vs. `apps/` boundary was never ambiguous in practice. With
multiple independent products, this ambiguity becomes a real duplication
risk.

At the same time, the owner cited new capabilities the master source never
modeled: narrative/story creation, session/campaign organization, an
interactive map (considering reusing X6, today reserved for the Architecture
Studio — `docs/architecture/ai-control-plane.md` §16.8), integration with
Discord and with transcription tools.

## Proposed boundary rule

> A capability is born in `libs/domains` (Rust) or `packages/`
> (TypeScript) — never inside an `app` — whenever **more than one product
> needs it, or it is reasonable to foresee that it will**. An `app`
> (`apps/*`) should only contain: domain composition, presentation/UI, and
> that host's specific integration. If a feature is being written inside an
> `app` and it looks like another product will need the same thing, it is
> promoted to `libs/domains` **before** it grows, not after it duplicates.

This extends DEC-001 (Rust as the single source of logic) to the
multi-product axis: today DEC-001 prevents duplicating Rust logic in
TypeScript/C#; this rule prevents duplicating domain logic across different
products.

Consistent with section 4.3: no new domain is created empty ahead of time —
only when a real feature of the first product (VTT) requires it.

## Proposed domain map

| Capability cited by the owner | Proposed classification | Where it is born | Why |
| --- | --- | --- | --- |
| Narrative / story creation | Generic domain | `libs/domains/narrative` (Rust crate) | Scene, NPC, and plot structure is not VTT-specific — a future collaborative-writing product would reuse it unchanged. |
| Session / campaign organization | Generic domain | `libs/domains/session` (Rust crate) | Campaigns, sessions, participants, and scheduling are general RPG concepts, not specific to the map or the VTT. |
| Interactive map (X6) | **VTT-specific**, with a generic piece underneath | `apps/web-vtt` consumes a new `packages/x6-canvas` package (generic X6 wrapper) | X6 today only serves the Architecture Studio (Graph IR, `docs/architecture/ai-control-plane.md` §16.8). Reusing the library is legitimate, but the "battle map" logic (grid, fog of war, tokens) belongs to the VTT — only the *canvas library* should be shared, not the map domain itself, until a second product needs a map. |
| Discord bot | External integration | new service directory (e.g., `apps/integrations/discord-bot` or `tools/integrations/discord-bot`, to be defined in Phase 1) | Not a game domain — it is a client that talks to `session`/`narrative` through the same contracts a product would use, never accessing internals directly (the same boundary principle already applied to hosts, section 15.4). |
| Session transcription | External integration, likely Python | `python/` (uv workspace already planned, DEC-005) or a dedicated service | Transcription tools tend to depend on ML/audio libraries — the master source already reserves `python/` for automation and experiments; a transcription pipeline fits there or as a dedicated service, feeding the `narrative` domain via contract, not by direct access. |

## Consequences

- `narrative` and `session` enter the section 6.1 tree as new members of
  `libs/domains/`, following the same pattern of `own contracts; Rust crate;
  tests; benchmarks; local documentation` already defined for physics/
  pathfinding (section 4.3).
- `packages/x6-canvas` is born as a generic X6 wrapper, consumed by
  `apps/architecture-studio` (usage already `LOCKED`) and by `apps/web-vtt`
  (new usage) — neither should depend directly on the raw X6 package.
- Discord and transcription do not enter `libs/` — they are external
  consumers of the domains, which keeps them replaceable (swapping the
  transcription provider, for example, does not touch `narrative`).
- Reinforces the decision in `docs/adr/ADR-0007-repo-distribution-strategy.md`:
  since reuse happens within the same workspace, the `libs/` boundary is the
  only thing preventing duplication — without separate workspaces forcing it
  through infrastructure, the discipline has to come from the rule itself.

## Risks

- Promoting something to `libs/domains` too early (before a real second use
  case) recreates the problem section 4.3 already avoids — that is why the
  map above only promotes `narrative` and `session`, which are already
  conceived for more than one product at the owner's own request; the VTT
  map deliberately stays inside the app until a second product needs a map.
- If the volume of external integrations grows (beyond Discord and
  transcription), it is worth revisiting whether they deserve a dedicated
  sibling directory (`apps/integrations/`) formalized in the section 6.1
  tree, instead of deciding case by case.

## Questions — answered by the owner on 2026-07-26

1. **Domain map**: confirmed as proposed — `narrative` and `session` generic
   in `libs/domains`; interactive map VTT-specific with only the X6 canvas
   (`packages/x6-canvas`) shared with the Architecture Studio; Discord and
   transcription as external integrations, not domains.
2. **Transcription in Python**: implicitly accepted by confirming the map
   above without reservation — `python/` or a dedicated service remains the
   default; can be revisited when the integration moves off paper, without
   needing to reopen this ADR.

## Decision

> **Accepted on 2026-07-26 by the project owner.** The `libs/` boundary rule
> and the domain map described above are recorded as
> DEC-046. `narrative` and `session` are born as generic domains in
> `libs/domains`; the VTT interactive map remains product-specific, sharing
> only the `packages/x6-canvas` wrapper with the Architecture Studio; Discord
> and transcription enter as external integrations that consume contracts,
> never as internal domains.

> **Footnote (2026-08-04, owner direction in conversation, not a re-vote on
> this ADR's original domain map):** a new capability not covered by the
> 2026-07-26 table above -- procedural terrain/heightmap generation
> (`generation-wasm`, `terrain-quantization`) -- was initially placed under a
> product-scoped `libs/vtt/` directory, then reclassified as a **generic
> domain** under `libs/domains/procgen`, matching this ADR's own boundary
> rule ("a capability is born in `libs/domains`... whenever more than one
> product needs it, or it is reasonable to foresee that it will"). See the
> updated domain-map table in `GRAFTING_MASTER_SOURCE.md` §4.4 for the
> current entry; this ADR's original table above is left as the historical
> record of the 2026-07-26 decision, not rewritten.

## Next steps

- [x] Confirm the domain map with the owner.
- [x] Add `libs/domains/narrative`, `libs/domains/session`, and
      `packages/x6-canvas` to the section 6.1 tree (as future entries, not
      empty folders created now — section 4.3).
- [x] Record the boundary rule as a new `LOCKED` decision in
      `docs/decisions/DECISION-LOG.md` §3.1.
- [ ] Decide the standard directory for external integrations
      (`apps/integrations/` vs. `tools/`) once the Discord bot or
      transcription move off paper.
