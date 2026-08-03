# ADR-0001: Web application host (GATE-001)

- Status: **Accepted — GATE-001 closed.**
- Proposal date: 2026-07-26
- Decision date: 2026-07-26
- Related gate: `GATE-001`
- Already-`LOCKED` decisions that constrain the choice space: DEC-002 (Nx), DEC-003 (pnpm),
  DEC-015 (Wasm/compute in a Dedicated Worker on the Web)
- Authority: in case of conflict, `GRAFTING_MASTER_SOURCE.md` prevails over this ADR.

## Context

The Web VTT is described in the master source as TypeScript + Three.js, consuming the Rust
core via Wasm inside a Dedicated Worker (DEC-015). The Web host does not yet have a defined
framework. No scaffold of `apps/web-vtt` can be created while this gate remains open
(`docs/decisions/DECISION-LOG.md` §3.3).

## Questions the gate needs to answer

1. Is the VTT a client-side SPA, or does it need SSR?
2. Will there be publicly indexable pages (SEO)?
3. Does the application need server routes from the same framework (BFF)?
4. Will the deploy be static, Node, or edge?

## Options considered

### A — React + Vite (pure SPA, separate backend)

- Pros: simple Worker/Wasm bootstrap with no coupling to a server runtime; deterministic and
  fast build; no edge-runtime assumptions that could restrict Wasm/SharedArrayBuffer; direct
  and well-documented integration with Three.js.
- Cons: no native SSR; if the need for indexable pages arises, requires standing up a
  separate service.

### B — Next.js (React + SSR/edge)

- Pros: server routes in the same framework; SSR/SSG for public pages, if any.
- Cons: couples the Worker/Wasm bootstrap to the framework's rendering model; edge runtimes
  have varying restrictions on Wasm and Workers that would need validation; larger
  configuration surface for a predominantly client-heavy app.

### C — Other (Svelte/Solid + Vite, or vanilla TypeScript)

- Pros: minimal overhead, full control over the Worker/Wasm bootstrap.
- Cons: smaller ecosystem of ready-made Three.js integration; more custom code for routing
  and state if the product grows.

## Objective decision criteria

| Criterion | Suggested weight |
| --- | --- |
| Complexity of initializing Worker + Wasm under the framework's rendering model | high |
| Real need for SSR/SEO (depends on the product, not on engineering) | high |
| Build/deploy predictability (static vs. Node vs. edge) | medium |
| Maturity of Three.js integration | medium |
| Alignment with pnpm + Nx in the monorepo | low (all options are compatible) |

## Recommendation (historical)

The master source recorded a suggested default for a predominantly client-side VTT
(React + Vite + SPA). This default **was not adopted**: the owner stated that the VTT is
just one among several planned pages of the product, which changes the dominant criterion
from "isolated client app" to "product with multiple routes," favoring a framework with
server routes in the same project.

## Consequences

- `apps/web-vtt` is born as a route within a Next.js app, not as a standalone Vite project.
  The Worker/Wasm bootstrap (DEC-015) must be done client-side within that route (e.g., a
  client-only component), avoiding any attempt to run Wasm/Worker under SSR.
- The deploy runtime (Node or edge) needs to support `SharedArrayBuffer`/Workers for the VTT
  page — this must be validated in spike A-006 (Wasm/Worker), now under Next.js rather than
  under plain Vite.
- Public/indexable pages for the rest of the product gain native SSR/SSG in the same
  framework, without needing a separate service.

## Risks

- Edge runtimes have varying restrictions on Wasm/Workers; spike A-006 must confirm which
  deploy mode (Node vs. edge) is compatible before fixing the deploy infrastructure.
- Explicit isolation must be guaranteed between the SSR routes (the rest of the pages) and
  the VTT route (client-only, no SSR), so as not to accidentally couple the Worker/Wasm
  bootstrap to the server rendering cycle.

## Decision

> **Closed on 2026-07-26 by the project owner.** Chosen framework:
> **Next.js (React + SSR/edge)**. Rationale: the VTT is just one of the product's planned
> pages; the other pages benefit from SSR/server routes in the same framework, which did not
> apply to the "VTT as a single app" scenario assumed by the original default.

## Next steps after closing

- [ ] Update `docs/decisions/DECISION-LOG.md` (record as `LOCKED`) citing this ADR. —
      done in this revision (see DEC-041).
- [ ] Enable backlog item A-001 and review A-006 (Wasm/Worker spike) to validate the Worker
      bootstrap within a Next.js client-only route.
- [ ] Define, in a spike or complementary ADR, the deploy runtime (Node vs. edge) for the
      VTT route.
