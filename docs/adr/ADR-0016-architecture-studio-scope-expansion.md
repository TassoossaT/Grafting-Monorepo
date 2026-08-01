# ADR-0016: Architecture Studio scope expansion — VTT generation-test surface and agent orchestration

- Status: Proposed
- Proposal date: 2026-08-01
- Decision date: None
- Record: None
- Backlog item: ADR-0016-ARCH-STUDIO-SCOPE-EXPANSION
- Related gate: None
- Supersedes: None
- Amends: ADR-0012
- Related: ADR-0008, ADR-0010, ADR-0011, ADR-0014
- Decision owner: repository-owner
- Source task: ADR-0016-ARCH-STUDIO-SCOPE-EXPANSION

## Summary

Add two new surfaces to `apps/architecture-studio` alongside its existing,
unchanged read-only Graph IR explorer: a VTT procedural-generation
test/visualization surface, and an agent-orchestration surface. Both execute
code — a real change from the app's current read-only-only scope — so this
amends `ADR-0012`'s "Initial Architecture Studio scope" clause for these two
surfaces specifically, leaving the existing explorer's read-only guarantee
untouched.

## Context

`apps/architecture-studio` today is a plain TypeScript/Vite single-page
application with no backend — a static site rendering a pre-generated
`docs/generated/grafting.graph.json` artifact through `@grafting/x6-canvas`.
Its scope is governed by the accepted `ADR-0012` (DEC-050) and the companion
`docs/specs/architecture-studio-read-only-v1.md`, both of which explicitly
exclude "editing workflows, autonomous maintenance, arbitrary code execution,
and provider-specific agent control" from its first slice.

Two developments make that boundary worth revisiting now:

1. `packages/ui`'s `GridLayout`, `Card`, and `Button` atoms (added
   2026-07-30) were built with a documented intent, recorded in
   `packages/ui/DECISIONS.md`'s "Grid layout decision," for a *different,
   not-yet-created* "Next.js documentation-and-tooling app" as their first
   consumer — not `apps/architecture-studio`. `GridLayout` is a generic,
   panel-content-agnostic draggable/resizable dashboard system and is not
   currently wired into `apps/architecture-studio` at all.
2. Extensive VTT product-architecture research
   (`docs/research/vtt-map-and-terrain-construction-options.md` and
   siblings) has reached the point where its single most concrete
   recommended next step — verifying that `ghx_proc_gen`,
   `fast-surface-nets-rs`, `block-mesh-rs`, and `noise-rs` actually compile to
   `wasm32-unknown-unknown` and run inside a real Worker — needs somewhere to
   run and show results. Separately, `docs/research/ai-agent-context-and-multi-agent-management-options.md`'s
   Part 3 already surveyed agent-orchestration frameworks (`@modelcontextprotocol/sdk`,
   Mastra, LangGraph.js, VoltAgent) as a *possible future Studio feature*,
   without deciding anything, explicitly flagging that pursuing it "needs its
   own dedicated task and likely its own ADR amendment" because every
   candidate requires a Node backend the Studio does not have today.

The repository owner was asked directly whether to build the VTT
test/visualization surface as that separate, already-anticipated app instead
of expanding Architecture Studio, and whether to defer agent orchestration.
The owner chose to expand Architecture Studio itself, and to bring agent
orchestration into scope now rather than defer it. This ADR records that
direction as a formal proposal for acceptance, not as an already-closed
decision — per `docs/adr/TEMPLATE.md`'s own rule, only the repository owner
may move this document's status past `Proposed` or fill in the final
`Decision` section below.

A labeling inconsistency was found while preparing this ADR and is flagged,
not resolved, here: `GRAFTING_MASTER_SOURCE.md`'s `DEC-041` states "the VTT is
a client-only route within [the Next.js Web host], not a standalone app,"
while section 4.4's domain-map table still labels the VTT's row `apps/web-vtt`
as if it were a separate application directory. This ADR does not depend on
resolving that inconsistency and does not attempt to.

## Scope

### In scope

- Adding a **VTT procedural-generation test/visualization surface** to
  `apps/architecture-studio`: hosting Rust/Wasm procedural-generation
  experiments, rendered via Three.js, laid out via `@grafting/ui`'s
  `GridLayout`.
- Adding an **agent-orchestration surface**: a Node-side backend executing
  MCP-based agent workflows, surfaced through the Studio UI.
- The explicit boundary each new surface operates under (below), including
  the license-risk policy for any agent-orchestration framework.
- Naming the existing companion documents (`ADR-0012`,
  `docs/specs/architecture-studio-read-only-v1.md`,
  `apps/architecture-studio/AGENTS.md`, `packages/ui/DECISIONS.md`,
  `GRAFTING_MASTER_SOURCE.md`) that need an amendment note so this ADR does
  not leave a silent contradiction anywhere else.

### Out of scope

- The existing **Graph IR explorer surface** — untouched. It remains exactly
  as read-only as `docs/specs/architecture-studio-read-only-v1.md` already
  requires (FR-008, FR-013, FR-023, and its full "OUT of scope" list all
  still apply to that surface verbatim).
- Picking a specific agent-orchestration framework (Mastra vs. VoltAgent vs.
  raw `@modelcontextprotocol/sdk`-only) — left to the implementation task
  that follows acceptance, using the license policy below as a constraint,
  not a pre-made choice.
- The Wasm-compile verification spike itself, the Node backend's concrete
  implementation, and the two surfaces' own detailed FR/AC specs — all
  sequenced as follow-up work (see "Follow-up work" below), not part of this
  decision.
- Resolving the `apps/web-vtt` vs. "VTT is a route, not a standalone app"
  labeling inconsistency described above.
- Any change to `GATE-001`/`DEC-041`, `GATE-002` (still open/deferred), or
  Epic J's own `Context Broker MCP` (`J-011`) scope — this ADR's agent
  orchestration surface is a Studio *product feature* using the same MCP
  protocol, not a redefinition of Epic J's provider-neutral inter-agent
  coordination effort.

## Decision drivers

- `AGENTS.md`: an agent must not "silently close an OPEN decision" or treat
  an accepted ADR's scope as something to expand without a dedicated task
  and explicit owner approval; changes must not be introduced "without need
  and evaluation."
- `ADR-0012` (DEC-050): the four authority classes and the read-only,
  traceable-to-source guarantee for *derived evidence* (Graph IR) must not be
  weakened by this change for the existing explorer surface.
- `DEC-049`/`ADR-0011` (package autonomy): no duplicated authoritative
  behavior across packages or applications — the agent-orchestration surface
  must not become a second, competing implementation of Epic J's own
  MCP-based coordination effort.
- `DEC-052`/`ADR-0014` (composable capability packages): any new reusable
  piece (a Rust generation domain crate, a Worker/Wasm boundary) must expose
  neutral mechanisms and Grafting-owned contracts, not hardcode this specific
  feature's policy into a shared package.
- The owner's explicit, standing goal of eventually selling a closed-source
  commercial product — every dependency this expansion introduces must
  permit that, matching the discipline already applied throughout this
  repository's research documents (e.g. discarding AGPL-3.0/Commons-Clause
  candidates elsewhere).
- `DEC-045`/`GATE-007` (repository distribution strategy): "selling" a
  product in this monorepo means packaging that app's own build artifact
  (`dist/<app>`), which is the concrete test the license-risk policy below is
  built around.

## Options considered

### Option A: build a new, separate app instead of expanding Architecture Studio

Matches what `packages/ui/DECISIONS.md` already anticipated (a distinct
"Next.js documentation-and-tooling app") and would leave `ADR-0012`'s
existing scope completely untouched — no amendment needed at all. Costs: a
second app to scaffold, build, and maintain; the VTT generation-visualization
and agent-orchestration features would not benefit from Architecture
Studio's existing Graph IR/entity-inspection infrastructure if that ever
becomes useful to them. **Not chosen** — the repository owner was asked
directly and chose to expand Architecture Studio instead.

### Option B: expand Architecture Studio's scope (this proposal)

Adds the two new surfaces to the existing app, sharing its build, its
`@grafting/ui`/`@grafting/x6-canvas` dependency surface, and (for the first
time) an app-level React root. Requires amending `ADR-0012`'s scope
statement and touching four companion documents to avoid leaving
contradictions. Cost: `apps/architecture-studio` stops being a single-purpose
read-only viewer and becomes a multi-surface application, which must be
named explicitly (three surfaces, not one blended scope) so the original
explorer's guarantees don't quietly erode. **Chosen**, per the owner's
explicit direction.

## Decision

Pending repository-owner decision.

The repository owner has indicated, in the conversation that produced this
ADR, a preference for Option B (expand Architecture Studio itself to add
both the VTT procedural-generation test/visualization surface and the
agent-orchestration surface, with agent orchestration in scope now rather
than deferred). This ADR records that preference as the proposed decision
for formal acceptance; it is not yet an accepted architectural decision.

When accepted, Architecture Studio's scope becomes three named surfaces:

1. **Graph IR explorer** (existing, unchanged) — governed exactly as today
   by `docs/specs/architecture-studio-read-only-v1.md`.
2. **VTT procedural-generation test/visualization surface** (new) — executes
   Rust/Wasm generation code and renders its output via Three.js inside
   `@grafting/ui`'s `GridLayout` panels; does not touch Graph IR or any
   authored repository source.
3. **Agent-orchestration surface** (new) — a Node-side backend executing
   MCP-based agent workflows through the Studio UI. Any action it takes that
   would modify a canonical authored source (an ADR, the master source, a
   schema) must still go through `ADR-0012`'s existing proposal → validation
   → plan/diff → owner-approval lifecycle; this ADR grants the surface the
   ability to *execute*, not standing write authority over canonical
   sources.

`ADR-0012`'s sentence "Editing workflows, autonomous maintenance, arbitrary
code execution, and provider-specific agent control are outside this first
slice" is superseded **only** for surfaces 2 and 3 above, and only to the
extent each surface's own later FR/AC spec (see "Follow-up work") defines.
The four authority classes and the read-only rule for surface 1 are
explicitly **not** superseded.

### License-risk policy for any agent-orchestration framework

Any framework selected for surface 3 must permit closed-source commercial
distribution of the Studio's shipped build artifact
(`dist/architecture-studio`, per `DEC-045`/`GATE-007`'s framing of what
"selling" means in this monorepo). The two live candidates from prior
research (`docs/research/ai-agent-context-and-multi-agent-management-options.md`
Part 3):

- **Mastra** — Apache-2.0 core; its `ee/` subtree is under a separate,
  source-available Enterprise License. Policy: `ee/` must never be imported,
  required, or linked into anything reachable from the Studio's shipped or
  distributed build, re-verified on every Mastra upgrade (the `ee/` boundary
  can move between releases).
- **VoltAgent** — MIT, no license ambiguity.

Whichever is chosen, the first implementation step validates raw
`@modelcontextprotocol/sdk` (MIT/Apache-2.0-family, no framework lock-in)
against one reference MCP server before committing to either framework, so
the license-sensitive choice is made against working evidence rather than
picked cold. If Mastra or VoltAgent code is ever copied or closely adapted
rather than depended on normally, the existing third-party-attribution
system (`THIRD_PARTY_NOTICES.md`, `check-third-party-notices.mjs`,
`.ai/coordination/PROTOCOL.md` rule 8) applies unchanged.

## Consequences

### Positive

- The VTT's most concrete, already-recommended next research step (the
  Wasm-compile verification spike) gets a real place to run and show
  results, using infrastructure (`@grafting/ui`'s `GridLayout`, the
  Worker/Wasm pattern already proven in `apps/architecture-studio/src/layout-client.ts`/`layout.worker.ts`)
  that already exists in this repository.
- Agent-orchestration research (previously a pure library comparison with no
  path to implementation) gets an explicit, bounded path forward instead of
  staying indefinitely deferred.
- The existing Graph IR explorer's guarantees are named and preserved
  explicitly, not left to erode by implication as the app gains new
  capabilities.

### Costs and trade-offs

- `apps/architecture-studio` goes from a single-purpose static SPA to a
  multi-surface application with (for the first time) a Node backend and an
  app-level React root — real, ongoing maintenance surface, not a one-time
  cost.
- The agent-orchestration surface is the first place in this repository
  where a Studio-owned process can execute MCP tool calls, which is a
  materially larger trust boundary than anything the Studio has had before,
  even bounded by the plan/diff/approval carve-out above.
- Four companion documents (the read-only spec, the app's own `AGENTS.md`,
  `packages/ui/DECISIONS.md`, the master source) each need an amendment note
  to stay internally consistent — skipping any one of them leaves a standing
  contradiction for the next reader or agent.

## Compatibility and migration

No persisted format changes. `docs/generated/grafting.graph.json`'s schema
and the Graph IR explorer's existing public contract
(`@grafting/x6-canvas`'s `createReadOnlyCanvas` API, `@grafting/ui`'s
`EntitySummary`) are untouched. The new surfaces are additive: a new Node
backend project and a new Rust/Wasm domain crate, neither of which the
existing explorer surface depends on. No existing consumer of
`apps/architecture-studio`'s current build output needs to change anything.

## Validation and evidence

- Acceptance criterion: this ADR's `Status` field is changed to `Accepted`
  by the repository owner, with a `Decision date` and `Record` (a `DEC-0NN`
  number) filled in — an agent must not perform this step.
- Acceptance criterion: after acceptance, the four companion-document
  amendment notes described above exist and each names this ADR by ID.
- Evidence for the underlying research this ADR builds on:
  `docs/research/vtt-map-and-terrain-construction-options.md`,
  `docs/research/ai-agent-context-and-multi-agent-management-options.md`,
  `packages/ui/DECISIONS.md`'s "Grid layout decision," and
  `docs/benchmarks/graph-ir-x6-spike-2026-07-28.md`/`docs/benchmarks/ai-control-plane-spike-2026-07-29.md`
  as the verified precedent for this repository's own "spike, then record
  evidence in `docs/benchmarks/`" convention.

## Risks

- **Scope creep back into the explorer surface.** Mitigation: the three
  surfaces are named explicitly in the Decision section precisely so a
  future change to surfaces 2 or 3 cannot be read as also loosening surface
  1's guarantees.
- **Agent-orchestration surface becoming a second, competing implementation
  of Epic J's Context Broker MCP.** Mitigation: explicitly out of scope
  above; both efforts may eventually share the same `@modelcontextprotocol/sdk`
  dependency but must not share one implementation unless a later task
  explicitly merges them (`DEC-049`).
- **License drift.** Mitigation: the `ee/`-boundary re-verification
  requirement on every Mastra upgrade, stated explicitly in the license
  policy above, not left as a one-time check.
- **This ADR is Proposed, not Accepted, and has no governing authority until
  formally accepted.** Mitigation: the task record for this ADR explicitly
  states no backend, framework, or generation-visualization code should be
  written against it until acceptance.

## Rollback

Reverting this ADR (setting `Status` back to a rejected/withdrawn state, or
simply never accepting it) leaves `apps/architecture-studio` exactly as it is
today — no code, dependency, or other document beyond this ADR and its four
companion amendment notes would exist yet, since this task deliberately
stops before any implementation. Removing the four amendment notes restores
each companion document to its pre-ADR-0016 text.

## Follow-up work

Sequenced, none started by this task:

1. Wasm-compile verification spike (`ghx_proc_gen`, `fast-surface-nets-rs`,
   `block-mesh-rs`, `noise-rs` against `wasm32-unknown-unknown` and a real
   Worker) — can run independent of this ADR's acceptance, since it is pure
   fact-finding.
2. Minimal Node/MCP backend and framework validation, as one task (raw
   `@modelcontextprotocol/sdk` baseline, then the ADR-selected framework
   layered on top) — requires this ADR's acceptance.
3. VTT generation-test surface: promote the spike's validated crates into a
   real domain crate, wire `@grafting/ui`'s `GridLayout` into Architecture
   Studio for the first time, consume the crate through an app-owned Worker
   boundary mirroring `layout-client.ts`/`layout.worker.ts` — requires this
   ADR's acceptance.
4. Agent-orchestration real feature build on the validated backend —
   requires this ADR's acceptance and step 2.
5. Author the two new surfaces' own FR/AC specs once each is concrete enough
   to specify against, mirroring how `docs/specs/architecture-studio-read-only-v1.md`
   followed `ADR-0012`, not preceded it.
