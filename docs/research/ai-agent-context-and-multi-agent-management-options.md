# AI agent context and multi-agent management: open-source options

- Research date: 2026-07-31
- Status: non-normative candidate catalog
- Decision authority: none; inclusion here does not approve or adopt a tool,
  and does not close PROV-014 or any other decision
- Scope: this document evaluates tools for (1) turning repository content into
  context an AI coding agent can consume, (2) coordinating multiple AI coding
  agents, and (3) building composable MCP-based agent-workflow orchestration
  as a feature inside Architecture Studio itself. It does **not** cover the
  Studio's own document/canvas/search/tracing integrations; see
  `docs/research/architecture-studio-open-source-options.md` for those

## Purpose

The owner looked for a ready-made "more sophisticated agent manager" to merge
into this repository, did not find one that fit as-is, and asked for an
evaluation of free/open-source alternatives instead — specifically whether any
of them can also make use of the documentation this repository already
generates (`docs/generated/api/ts/*.api.md`, `docs/generated/api/rust/*.md`,
and the Graph IR at `docs/generated/grafting.graph.json`).

This is not a first pass. Two things already exist in the repository that this
research must be read against, not in place of:

- `GRAFTING_MASTER_SOURCE.md` already carries **PROV-014** (`PROVISIONAL`, not
  yet validated): "Use Serena and ast-grep as complements to repository
  intelligence." Nobody has run the validating spike yet.
- `SPIKE-AGENT-MCP-PILOT` and `SPIKE-AGENT-MCP-PERMANENT-CLONE` (both
  `completed`, run in a separate session on 2026-07-31) already cloned, built,
  and ran `rinadelph/Agent-MCP` locally as a candidate replacement for the
  hand-rolled `.ai/state/tasks/*.json` + `agent-task-guard.mjs` coordination
  protocol. It came up cleanly: ~39 tools across agent/task management, file
  locking, messaging, and session state; RAG/shared-memory needs an
  `OPENAI_API_KEY` and was otherwise untested. Nothing in the tracked repo tree
  was touched by that pilot.

This document's job is to place the newly-suggested candidates (Serena, Kit)
next to that existing state, add the other free/OSS options that address the
same two needs, and check the one question the owner asked directly: can any
of them actually consume documentation this repository already produces,
instead of only re-deriving their own understanding from raw source.

### Hard constraint: must not block a future closed-source commercial sale

The owner flagged, after the first pass of this research, that Agent-MCP's
AGPL-3.0 license specifically is a problem: they want to preserve the option
to sell a closed-source product built in this repository later, and cannot
merge AGPL-3.0 code into it in a way that keeps that option open by default.

The mechanism, so the constraint can be checked against any future candidate,
not just Agent-MCP: AGPL-3.0 (like GPL, but closing the "SaaS loophole") only
triggers its source-disclosure obligation when the covered software, or a
work based on it, is **distributed** to a third party or **offered as a
network service** to a third party. It does not restrict private or internal
use, even modified. Two different usages of the same AGPL tool land on
opposite sides of that line:

- Run as a strictly internal, non-distributed, non-networked development-time
  tool (agents coordinate through it while building the product, but it never
  ships inside, and is never hosted as a service for, whatever gets sold) —
  AGPL's obligations never reach the shipped product.
- Forked, embedded, or otherwise merged into code that itself gets
  distributed or network-hosted for customers — AGPL requires the complete
  combined work's source to be released under AGPL to those recipients,
  which is incompatible with a closed-source sale of that combined work.

This is the same principle `docs/research/architecture-studio-open-source-options.md`
already states for copyleft candidates generally ("their source must not be
copied or linked into a distributed Grafting product without a deliberate
license and distribution review"), applied concretely to Agent-MCP. This is
not legal advice; treat it as the reasoning to bring to a real legal review
before any actual commercial-launch decision, per the adoption checklist.

## Existing architectural constraints

Any future evaluation or adoption must preserve these accepted decisions:

- canonical authored files remain authoritative; derived evidence, Graph IR,
  and any agent-facing index remain read-only, traceable consumers (DEC-050);
- reusable graph structures, algorithms, and queries remain in
  `grafting-graph-core`, not duplicated inside an adopted dependency
  (DEC-051);
- external AI integrations enter through spike, quarantine, license, security,
  and evaluation (DEC-038);
- no AI integration may create another workspace root, lockfile, or toolchain
  without an ADR (DEC-039);
- each task keeps a single executing owner at a time; parallel executors use
  distinct worktrees (DEC-032) — any coordination-layer replacement must
  preserve this invariant, not weaken it;
- `AGENTS.md` forbids introducing a tool, agent, skill, or MCP "without need
  and evaluation," and requires "a separate task and explicit owner approval"
  before changing the protocol, registries, policies, hooks, permissions,
  skills, or MCPs. This document is the evaluation; adoption itself still
  needs its own task and the owner's explicit go-ahead.

## Part 1 — Context management (turning the repo into agent-consumable context)

| Candidate | License | Maturity | Can it use our *existing* generated docs? | Recommended timing |
| --- | --- | --- | --- | --- |
| [Serena](https://github.com/oraios/serena) | MIT | Very active (v1.6.1, Jul 2026; ~27k stars) | **Yes, indirectly.** Its symbol/reference tools are LSP-derived from raw source and don't read our docs. But Serena has a separate, plain-Markdown **memory system** (`.serena/memories/*.md`, committable) that an agent reads/writes across sessions. We could pre-seed those memory files from our generated TypeDoc/Rust API Markdown and Graph IR summaries, instead of letting Serena re-derive its own understanding from scratch each session. | This is the PROV-014 spike that has never actually been run — do it next |
| [Repomix](https://github.com/yamadashy/repomix) | MIT | Very active (v1.17.0, Jul 2026; ~27.5k stars) | **Yes, for free, no integration work.** It packs whatever matches your include/ignore globs verbatim into one file (XML/MD/JSON); our generated Markdown and Graph IR JSON get swept in alongside source automatically. It's concatenation, not comprehension — no dedup or cross-referencing — but zero cost since it needs no dependency add (`npx repomix` runs standalone). | Try ad hoc, on demand; no adoption decision needed to start using it |

### Deferred / not recommended in this pass

| Candidate | License | Why deferred |
| --- | --- | --- |
| [Kit](https://github.com/cased/kit) | MIT | Smaller, less consistently versioned (~1.3k stars). Its context pipeline is one-directional: raw source → LLM-generated summary → vector index (`DocstringIndexer`/`ContextAssembler`). There is no documented path to feed our own pre-existing Markdown/JSON in; its "multi-source documentation" mode fetches *third-party dependency* docs (via Context7/Chroma), not repo-owned docs. Repomix already covers "get our docs in front of an agent" more directly and more actively. |
| [gitingest](https://github.com/cyclotruc/gitingest) | MIT | Functionally the same idea as Repomix (flatten a repo into one LLM-sized digest), but maintenance is ambiguous — latest PyPI release found was over a year stale, and the project may have moved orgs. Redundant with Repomix, which is more active. |
| Aider's repo-map (design reference only, not a candidate — [Aider-AI/aider](https://github.com/Aider-AI/aider), Apache-2.0) | — | Genuinely clever mechanism (tree-sitter tags + PageRank ranking of repo symbols under a token budget), but it lives embedded inside Aider's own CLI, not published as a reusable library — third parties have reimplemented it rather than importing it. Worth knowing the algorithm exists; not something to depend on. It also only ranks source-derived tags, the same blind spot as Kit and Aider's ranking has no concept of our generated docs at all. |

## Part 2 — Multi-agent management

The repository's real agents are independent CLI sessions (Claude Code, Codex
CLI, Gemini CLI) that read and write actual repository files directly. There
is no in-process orchestrator calling them as functions. That shape matters:
it rules out most of what "multi-agent framework" usually means today.

| Candidate | License / governance | Does it coordinate independent external CLI sessions, or author new in-process agents? |
| --- | --- | --- |
| [CrewAI](https://github.com/crewAIInc/crewAI) | MIT core; paid "AMP" control plane separate | In-process only. **Weak fit.** |
| [AutoGen](https://github.com/microsoft/autogen) | MIT + CC-BY-4.0 docs | Microsoft put it in **maintenance mode in Oct 2025**; no new features; steering users to a new "Microsoft Agent Framework." Effectively a dead end. |
| [AG2](https://github.com/ag2ai/ag2) (the community fork that continues AutoGen's actual lineage) | Apache-2.0, independent governance | In-process only, same as AutoGen. **Weak fit**, but this is the one to look at if "AutoGen" is the search term, not the frozen `microsoft/autogen`. |
| [LangGraph](https://github.com/langchain-ai/langgraph) | Core library MIT (Platform/LangSmith are separate paid layers, don't relicense the core) | In-process graph/state-machine library. **Weak fit** — nothing native spawns or supervises external CLI subprocesses. |
| [Camel-AI](https://github.com/camel-ai/camel) | Apache-2.0 | In-process only. **Weak fit.** |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) (successor to the experimental "Swarm") | MIT; genuinely model-agnostic via LiteLLM, not OpenAI-locked | In-process only. **Weak fit.** |
| [mcp-agent](https://github.com/lastmile-ai/mcp-agent) — **not to be confused with Agent-MCP below, near-identical name, different project** | Apache-2.0; ~8.5k stars, active | Implements Anthropic's "Building Effective Agents" composable patterns (router, orchestrator-workers, evaluator-optimizer) over MCP servers used as tools, inside one Python process. In-process only, same shape as CrewAI/LangGraph/AG2. **Weak fit** — no task-claiming, file-locking, or shared-coordination-state for concurrent agents on the same files, despite the name suggesting otherwise. License is fine (Apache-2.0); the shape mismatch is what rules it out, not the license. |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) (formerly OpenDevin) | MIT core (self-hosted); hosted "OpenHands-Cloud" is separately non-OSS-licensed | **The one outlier.** Its 2026 Agent Client Protocol (ACP) integration explicitly spawns **Claude Code, Codex CLI, and Gemini CLI as external subprocesses** over JSON-RPC/stdio and relays turns — architecturally the closest match to this repo's actual shape. But its documented concurrency model is one-agent-per-conversation; no file-locking, task-claiming, or `affected_paths`-style allowlist was found. It would complement, not replace, the coordination role `.ai/state/tasks` + the guard hook (or Agent-MCP) already plays. |
| [Agent-MCP](https://github.com/rinadelph/Agent-MCP) (already piloted, see above) | **AGPL-3.0 — dropped, see below** | Closest functional match to "a more sophisticated agent manager," confirmed working by the completed pilot, but its license conflicts with the owner's stated goal of keeping a future closed-source commercial sale open unless it stays a strictly internal, never-distributed tool forever — too fragile a constraint to build a decision on. |

All seven in-process frameworks (CrewAI, AutoGen, AG2, LangGraph, Camel-AI,
OpenAI Agents SDK, mcp-agent) are the wrong shape for this repository's actual
need: they assume you author agents inside their process, not that you
already have independent CLI tools touching shared files. They are listed
here as external references only, the same status Backstage/Plane/OpenProject
already have in the Studio research doc — worth knowing the design patterns,
not candidates to depend on.

### Follow-up pass: permissively-licensed alternatives to Agent-MCP

Once Agent-MCP was dropped for its AGPL-3.0 license, the open question became
whether anything else actually occupies its functional niche — task-claiming
and file-locking across concurrent CLI agents — without the same license
risk. This pass found two real candidates:

| Candidate | License | Core capability | Coordination substance |
| --- | --- | --- | --- |
| [Gas Town](https://github.com/steveyegge/gastown) | MIT | Git-backed issue tracker ("Beads") plus work-claim primitives ("Sling"/"Convoy") and a Bors-style merge queue ("Refinery"); vendor-agnostic (Claude Code, Copilot, Codex, Gemini, Cursor, custom runtimes). ~17.4k stars, very active. | Closest functional match found to what Agent-MCP provided: claims a work item to exactly one agent at a time, serializes merges through a queue instead of racing commits. Being git-backed rather than a persistent network daemon, it may also sit closer to what ADR-0010 already prefers (file/git-based coordination) than a running MCP broker would. |
| [Guild](https://github.com/mathomhaus/guild) | Apache-2.0 | Single Go binary + embedded SQLite, exposed as an MCP server; atomic task-claiming (`guild quest accept ... --owner`) that prevents double-assignment, plus shared cross-agent memory/search. ~310 stars, smaller/newer. | Purpose-built for the exact Agent-MCP use case at much smaller scale/footprint — a lighter-weight option if Gas Town turns out too opinionated or heavy for a single spike. |

Neither has been piloted yet (unlike Agent-MCP); both would need the same
disposable, outside-the-tracked-tree spike treatment before any adoption
decision, per the checklist below and consistent with how the Agent-MCP pilot
itself was run.

Everything else found in this pass was ruled out and is recorded here mainly
so it isn't re-researched later:

| Candidate | License | Why ruled out |
| --- | --- | --- |
| [Claude Squad](https://github.com/smtg-ai/claude-squad) | **AGPL-3.0** | Same problem as Agent-MCP — drop for the same commercial-sale reason. |
| [Task Master AI](https://github.com/eyaltoledano/claude-task-master) | **MIT License *with Commons Clause*** | Not a plain permissive license — Commons Clause explicitly forbids selling the software, or offering a product/service whose value substantially derives from it, for a fee. That is exactly the kind of restriction the owner is trying to avoid; treat it the same as a copyleft risk, not as "basically MIT." Also single-agent-task-breakdown oriented, no file-locking. |
| [Crystal](https://github.com/stravu/crystal) | MIT | License is fine, but the project was **deprecated in Feb 2026** in favor of a successor ("Nimbalyst") whose licensing was not verified — don't build on a discontinued tool. |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) | Apache-2.0 | License is fine and it was vendor-agnostic and well-starred (~27.6k), but its own README now announces it is **sunsetting** — same problem as Crystal, avoid depending on a wind-down. |
| Conductor (conductor.build) | **Proprietary, closed-source** | Confirmed not open source at all (Mac-only, VC-backed commercial app); excluded outright. An unrelated Apache-2.0 "Conductor OSS" exists on GitHub but is Netflix's generic workflow engine, not an AI-coding-agent tool — a name collision, not a real candidate. |
| [Shrimp Task Manager](https://github.com/cjo4m06/mcp-shrimp-task-manager) | MIT | License is fine, but it's a task-breakdown/planning MCP server with an "assign agents to tasks" concept and no verified locking or claim-arbitration under real concurrency — would likely duplicate rather than strengthen `.ai/state/tasks`. |
| [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | MIT | License is fine; it's more a CI/PR automation pipeline (spawns one agent per task in its own worktree, auto-fixes CI, dashboards results) than a peer-to-peer locking registry — a different problem than the one Agent-MCP solved. Worth remembering if a CI-automation need shows up later. |
| [code-conductor](https://github.com/ryanmac/code-conductor) | MIT | License is fine; small (~110 stars), Claude-Code-only, uses a GitHub Issues label as the task queue with no anti-collision logic beyond the label claim itself. |
| [wit](https://github.com/amaar-mc/wit) | MIT | Not a task manager — a Tree-sitter-based conflict-*warning* layer at the symbol (function/class) level rather than whole-file. Niche (~45 stars), single-machine only, warnings not hard blocks. Interesting as a future complement to the existing `affected_paths` file-level allowlist (finer granularity), not a multi-agent manager in its own right. |

## Part 3 — Building mcp-agent-style orchestration into Architecture Studio itself

`mcp-agent` was excluded above as a dependency (Python, wrong language), but
the owner's actual goal is to build the *capability* it demonstrates —
composable MCP-based agent-workflow patterns (router, orchestrator-workers,
parallel, evaluator-optimizer) — as a feature of `apps/architecture-studio`
itself. `apps/architecture-studio/project.json` confirms this app is pure
TypeScript, `platform:web`, with no backend/server target today — so the
candidates below are filtered to what actually fits that stack.

| Candidate | License | What it actually provides | Runtime requirement |
| --- | --- | --- | --- |
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) | MIT (legacy) / Apache-2.0 (new code) — the official TS SDK | Low-level client/server/transport plumbing only (stdio, Streamable HTTP, SSE, OAuth); no router/orchestrator/evaluator-optimizer patterns — you build the agent loop yourself. ~13k stars, very active, v2 tracks the current spec. | `stdio` transport (what most local MCP servers use) **requires a Node child-process host** — categorically cannot run from a pure browser SPA. HTTP/SSE transports can reach a browser in principle but aren't a first-class supported path. |
| [Vercel AI SDK `experimental_createMCPClient`](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools) | Apache-2.0 | Converts MCP tools into AI SDK `tool()` objects for `generateText`/`streamText`; stdio/SSE/HTTP transports; no built-in composable-pattern abstractions, still `experimental_`. | HTTP/SSE can work from a browser; stdio still needs Node. |
| [Mastra](https://github.com/mastra-ai/mastra) | Core Apache-2.0; **an `ee/` enterprise subtree is separately, source-available-licensed** — fine as long as nothing under `ee/` is imported | Genuine higher-level composable workflows: `.then()`/`.branch()`/`.parallel()` graph engine, human-in-the-loop suspend/resume, native MCP client *and* server support, 40+ model providers. Closest off-the-shelf match to mcp-agent's pattern set (branch≈router, parallel≈parallel, multi-step graphs≈orchestrator-workers). ~26.8k stars, very active. | Node.js-first; ships its own local dev server ("Mastra Studio," port 4111) — not a pure-browser library. |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) + [`@langchain/mcp-adapters`](https://www.npmjs.com/package/@langchain/mcp-adapters) | Both MIT | Low-level graph/state-machine primitives (arbitrary nodes/edges/conditional routing) you compose into router/orchestrator/evaluator-optimizer shapes yourself; the adapters package bridges MCP tools into LangChain tools (stdio + SSE/HTTP). ~3.2k stars, active. | Node-oriented; docs and adapters assume a Node host process. |
| [VoltAgent](https://github.com/voltagent/voltagent) | MIT | TypeScript-native framework: memory, RAG, tools, first-class MCP integration, supervisor/sub-agent multi-agent patterns — conceptually closer to mcp-agent than a raw tool-calling SDK. Actively developed. | Node.js-oriented framework, not pure-browser. |
| Other TS-native finds, not deep-dived | `@inngest/agent-kit` (MIT/Apache-ish, tied to the Inngest runtime); `openai/openai-agents-js` (MIT, has handoffs/guardrails/MCP support but assumes a server holds the API key) | — | Both Node-oriented. |

### The architectural fork this actually implies

Every candidate above needs a **Node-side host process** — none run
meaningfully in a pure browser SPA, because MCP's most common transport
(`stdio`) is a child-process protocol by definition. Architecture Studio has
no backend/server target today (`apps/architecture-studio/project.json` has
only `dev`/`build`/`test`/`check`/docs targets, all client-side). Adding this
feature is therefore not "pick a library and import it" — it is:

1. a decision to give Architecture Studio a Node-side backend/host process it
   does not have today, and
2. a decision to let the Studio actually *execute* MCP tool calls (which can
   read/write files, run code, call external services) rather than only
   *display* derived, read-only knowledge — crossing the boundary
   `docs/research/architecture-studio-open-source-options.md` already states
   explicitly: "the initial production Studio slice remains read-only. Future
   editing targets authored sources through proposal, validation, diff, and
   approval."

Neither of those is decided by this document. Both DEC-038/DEC-039 (external
AI integrations enter through spike/quarantine/license/security/evaluation;
no AI integration creates another workspace root/lockfile/toolchain without
an ADR) and the `AGENTS.md` gate on introducing a new tool "without need and
evaluation" apply here — this capability, if pursued, needs its own dedicated
task and likely its own ADR amendment to the read-only-slice constraint, not
a quiet dependency add.

If and when the owner decides to pursue this, **Mastra** is the strongest
off-the-shelf match for mcp-agent's actual pattern set (given its `ee/`
boundary is respected), with **VoltAgent** as a lighter MIT-only alternative
and `@modelcontextprotocol/sdk` + LangGraph.js as the lower-level, fully DIY
option if tighter control is preferred over adopting a full framework.

## What this means for the three live questions

**Should PROV-014 (Serena) finally get its spike?** This research didn't find
a reason not to: MIT, very active, fully local, and it has a concrete, cheap
integration point — pre-seeding `.serena/memories/*.md` from
`docs/generated/api/**/*.md` and a Graph IR summary — that was not visible
before this pass. Recommend the spike run in isolation first, the same way
the Agent-MCP pilot did (outside the tracked tree or in a disposable
worktree), before any dependency is actually added, per the adoption
checklist below.

**Should Agent-MCP replace `.ai/state/tasks`?** Given the owner's stated goal
of keeping a closed-source commercial sale open by default, **no** — drop it
from further consideration rather than merely defer it. It is fine as a
strictly internal, never-shipped, never-network-hosted development tool (as
already piloted), but maintaining that boundary forever, across every future
contributor and every future build/release/deployment path, is a fragile
constraint to depend on for a decision this consequential. It would also
still be a large architectural swap regardless of licensing — touching
DEC-032, the guard hook, and `PROTOCOL.md` — so it needs its own dedicated
task and ADR if ever revisited, not a quiet dependency add. Every other
candidate in this document (Serena, Repomix, Kit, OpenHands' self-hosted
core, and all six in-process frameworks) is MIT or Apache-2.0, so none of
them carries this problem at all — lean on those instead. The file-based
`.ai/state/tasks` protocol's plain-JSON auditability, and the fact that it is
entirely Grafting-owned code with no third-party license to track, remain
real properties worth keeping regardless.

**Is there a permissively-licensed stand-in for what Agent-MCP offered?**
Possibly — **Gas Town** (MIT) and **Guild** (Apache-2.0), found in the
follow-up pass above, are the two candidates that actually provide
task-claiming and merge serialization across concurrent agents without
Agent-MCP's license risk. Neither has been piloted; both deserve the same
disposable, isolated spike treatment the Agent-MCP pilot already got before
either is considered further. This is a genuinely new option that did not
exist in the first pass of this research, not a re-labeling of something
already ruled out.

Kit, gitingest, Aider's repo-map, all seven in-process orchestration
frameworks (including mcp-agent), Claude Squad, Task Master AI, Crystal, Vibe
Kanban, Conductor, Shrimp Task Manager, Agent Orchestrator, code-conductor,
and wit are not recommended for further evaluation in this pass; none adds a capability that Serena, Repomix,
Gas Town, or Guild doesn't already cover better for this repository's actual
shape, or each carries its own disqualifying license/viability problem
documented above.

**Should Architecture Studio gain mcp-agent-style orchestration?** Not
decided here — this is a scope-expansion decision, not a dependency pick.
Every viable building block found (Mastra, VoltAgent, LangGraph.js,
`@modelcontextprotocol/sdk`, Vercel AI SDK's MCP client) needs a Node-side
host process the Studio doesn't have today, and would let the Studio execute
tool calls rather than only display read-only derived knowledge — crossing a
boundary the Studio's own research doc already commits to explicitly. If the
owner wants to proceed, that decision (backend + read-only-boundary change)
should be made first, explicitly, before picking among Mastra/VoltAgent/
LangGraph.js as the implementation layer.

## License and governance cautions

- **Agent-MCP is AGPL-3.0**: fine for a strictly internal, never-distributed,
  never-network-hosted development tool; forking/embedding it into anything
  that gets distributed or network-hosted for customers would require
  releasing that combined work's complete source under AGPL — incompatible
  with the owner's stated goal of keeping a closed-source commercial sale
  open. Recommendation in this document: drop it, not just defer it, given
  every other candidate here carries no such risk (see above).
- **AutoGen (`microsoft/autogen`) is frozen** (maintenance mode since Oct
  2025); if the AutoGen lineage is wanted at all, evaluate **AG2**
  (`ag2ai/ag2`), not the original repository.
- **OpenHands** has a license split: the self-hosted core is MIT, but
  "OpenHands-Cloud" is a separate, non-OSS-licensed hosted product — only the
  self-hosted core is in scope here.
- **LangGraph**'s core library stays MIT; only the separate Platform/LangSmith
  layers are commercial. Watch for feature creep pushed toward those paid
  layers in future releases, not a current blocker.
- **Claude Squad is AGPL-3.0**: same disqualifying reason as Agent-MCP.
- **Task Master AI is "MIT License with Commons Clause,"** not plain MIT —
  Commons Clause forbids selling the software or a product substantially
  derived from its functionality. Treat this the same as a copyleft risk for
  the owner's stated commercial-sale goal, despite the MIT-sounding name.
- **Conductor (conductor.build) is fully proprietary**, not open source at
  all; excluded outright, not merely deferred.
- **Crystal and Vibe Kanban** are both permissively licensed (MIT /
  Apache-2.0) but both are winding down (deprecated / sunsetting per their own
  READMEs as of this research date) — a viability problem, not a license one.
- **mcp-agent (lastmile-ai) is Apache-2.0** — the license is fine, but it's a
  same-process Python agent-authoring framework, not a coordinator for
  independent CLI sessions; do not confuse it with rinadelph/Agent-MCP (the
  AGPL-3.0 project actually piloted), the names collide but the projects
  don't.
- **Mastra's core is Apache-2.0**, but it ships a separate `ee/` subtree under
  a source-available Mastra Enterprise License — fine as long as nothing
  under `ee/` is imported into anything distributed.

## Recommended evaluation order

1. Run the PROV-014 spike: pilot Serena in isolation (own worktree or outside
   the tracked tree, matching how the Agent-MCP pilot was run), confirm it
   works fully locally, and specifically test pre-seeding `.serena/memories/`
   from our generated API docs and Graph IR before concluding anything about
   whether it reduces redundant re-derivation.
2. Try Repomix ad hoc (`npx repomix`, no dependency add) the next time a task
   needs a single, large, hand-off-able context blob for an agent; note
   whether `--compress` on a generated Markdown API doc is even meaningful
   (it is grammar-aware per source extension, so plain Markdown likely passes
   through unchanged) before deciding it needs a project.json target of its
   own.
3. Drop Agent-MCP, Claude Squad, and Task Master AI given the owner's stated
   commercial-sale goal — each carries a license (AGPL-3.0, AGPL-3.0, and
   Commons Clause respectively) that conflicts with it, and permissively
   licensed alternatives now exist for the same functional need. Keep
   `.ai/state/tasks` as the coordination layer in the meantime; it is fully
   Grafting-owned with no third-party license to track.
4. If a coordination-layer complement is still wanted, spike **Gas Town**
   first (MIT, most active, closest functional match), with **Guild**
   (Apache-2.0) as a lighter-weight fallback — run both the same way the
   Agent-MCP pilot was run: isolated, outside the tracked tree, before any
   dependency is actually added. Re-verify their license, maintenance, and
   feature claims fresh at spike time, since this document's facts are dated
   2026-07-31.
5. Do not pursue Kit, gitingest, Crystal, Vibe Kanban, Conductor, Shrimp Task
   Manager, Agent Orchestrator, code-conductor, wit, or any of the seven
   in-process orchestration frameworks (CrewAI, AutoGen, AG2, LangGraph,
   Camel-AI, OpenAI Agents SDK, mcp-agent) further unless a new, concrete need
   appears that Serena, Repomix, Gas Town, or Guild cannot satisfy. If
   "mcp-agent" or "Agent-MCP" comes up again, check which one is meant first —
   the names collide but the projects don't.
6. Before adopting any MCP-orchestration library for Architecture Studio
   (Mastra, VoltAgent, LangGraph.js, or raw `@modelcontextprotocol/sdk`),
   decide explicitly whether the Studio should gain a Node-side backend and
   whether it should be allowed to execute MCP tool calls rather than only
   display read-only derived knowledge — that decision precedes and is larger
   than the library choice, and per DEC-038/DEC-039 and `AGENTS.md` needs its
   own dedicated task, not a quiet dependency add during unrelated work.

## Adoption checklist

Unchanged from `docs/research/architecture-studio-open-source-options.md`;
reproduced here so this document is self-contained. Before any candidate above
becomes a real dependency or deployed integration:

1. assign a separate task and single owner;
2. state the measured product need and rejected simpler alternative;
3. re-check current license, transitive licenses, provenance, maintenance, and
   security posture (facts in this document are dated 2026-07-31 and will
   drift);
4. identify the smallest owning boundary and Grafting-owned public contract;
5. prove that vendor types do not leak and graph calculations are not copied
   outside Rust;
6. define build, runtime, bundle, memory, and data-retention costs;
7. run a disposable spike with acceptance and rollback criteria;
8. update an ADR only when adoption changes an architectural decision.
